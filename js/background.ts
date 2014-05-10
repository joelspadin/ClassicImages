/// <reference path="settings.ts" />
/// <reference path="dynamic-inject.ts" />
/// <reference path="lib/chrome.d.ts" />
/// <reference path="lib/libgif.d.ts" />

function init() {
	var MESSAGE_HANDLERS = {
		'save-image': ImageSave.onSaveMessage,
	};

	var CONNECTION_HANDLERS = {
		'analyze-image': ImageProperties.onAnalyzeMessage,
	}

	// Listen for context menu events
	chrome.contextMenus.onClicked.addListener(ImageProperties.onContextMenuClicked);

	// Short connection message handlers
	chrome.runtime.onMessage.addListener((message: IMessage, sender, sendResponse) => {
		var handler = MESSAGE_HANDLERS[message.action];
		if (handler) {
			handler(message, sender, sendResponse);
		} else {
			console.error('Unknown message', message);
		}
	});

	// Long-lived connection message handlers
	chrome.runtime.onConnect.addListener((port) => {
		// Port connections should only come from the image properties pop-up for now
		console.assert(port.name === 'image-properties');
		port.onMessage.addListener((message: IMessage) => {
			var handler = CONNECTION_HANDLERS[message.action];
			if (handler) {
				handler(message, port);
			} else {
				console.error('Unknown port message', message);
			}
		});
	});

	inject.init("js/inject/dialog.js", "js/inject/filesize.js", "js/inject/cldr-plural.js");
};

chrome.runtime.onInstalled.addListener((details) => {
	var CONTEXT_ID = 'image-properties';

	settings.init();
	ImageSave.rebuildActions();
	inject.clearInjectedTabs();

	chrome.contextMenus.create({
		id: CONTEXT_ID,
		title: chrome.i18n.getMessage('ctx_image_properties'),
		contexts: ['image'],
	});
});

module ImageProperties {
	var MIME_TYPES: { [key: string]: string[]; } = {
		'BMP': ['image/bmp', 'image/x-windows-bmp'],
		'GIF': ['image/gif'],
		'JPEG': ['image/jpeg', 'image/pjpeg'],
		'ICO': ['image/x-icon'],
		'PGM': ['image/x-portable-graymap'],
		'PNG': ['image/png'],
		'SVG': ['image/svg+xml', 'image/svg-xml'],
		'TIFF': ['image/tiff', 'image/x-tiff'],
		'WebP': ['image/webp'],
		'XBM': ['image/x-xbitmap'],
	}

	export interface InfoCallback {
		(err: string, info: ImageInfo): void;
	}

	export function onAnalyzeMessage(message: IAnalyzeMessage, port: chrome.runtime.Port) {
		// Fetch the image
		var xhr = new XMLHttpRequest();
		xhr.responseType = 'blob';
		xhr.addEventListener('load', (e) => {
			// Parse the image and pass back any new info we get
			parseImage(xhr.response, (err, info) => {
				if (err) {
					sendErrorResponse(err, port);
				} else {
					sendInfoResponse(info, port);
				}
			});
		});

		xhr.addEventListener('error', (e) => {
			sendErrorResponse(xhr.status + ' ' + xhr.statusText, port);
		});

		xhr.addEventListener('loadend', (e) => {
			// Clean up the blob URL
			URL.revokeObjectURL(message.url);
		});
		xhr.open('get', message.url, true);
		xhr.send();
	}

	export function onContextMenuClicked(e: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) {
		inject.injectScript(tab.id, (err) => {
			if (err) {
				console.error('Failed to inject script to tab', tab);
			} else {
				// Show the image properties pop-up in the tab
				chrome.tabs.sendMessage(tab.id, {
					action: 'image-properties',
					url: e.srcUrl
				});
			}
		});
	}

	function getGenericImageData(type: string, data: ArrayBuffer, callback: InfoCallback) {
		var image = new Image();
		image.addEventListener('load', () => {
			callback(null, {
				width: image.width,
				height: image.height,
				mimeType: type,
				type: getImageType(type),
				fileSize: data.byteLength
			});
		});

		image.addEventListener('error', (e) => {
			callback(chrome.i18n.getMessage('error_analyze_failed', [e.error.toString()]), null);
		});

		image.src = 'data:' + type + ';base64,' + toBase64(data);
	}

	function getImageType(mimeType: string) {
		for (var key in MIME_TYPES) {
			if (MIME_TYPES.hasOwnProperty(key)) {
				if (MIME_TYPES[key].indexOf(mimeType.toLowerCase()) >= 0) {
					return key;
				}
			}
		}
		return null;
	}

	function parseImage(blob: Blob, callback: InfoCallback) {
		var fr = new FileReader();
		fr.addEventListener('load', (e) => {
			getGenericImageData(blob.type, fr.result, (err, info) => {
				if (err) {
					callback(chrome.i18n.getMessage('error_analyze_failed', [err]), null);
				} else {
					// Send the info we've collected up to now
					callback(null, info);

					try {
						// Pick the right parser based on the image type
						switch (info.type) {
							case 'GIF':
								GifParser.parse(fr.result, info, callback);
								break;

							case 'JPEG':
								JpegParser.parse(fr.result, info, callback);
								break;

							default:
								// No further analysis to do. Send back a 'null' to indicate we're done.
								callback(null, null);
								break;
						}
					} catch (e) {
						callback(chrome.i18n.getMessage('error_analyze_failed', [e.toString()]), null);
					}
				}
			});
		});

		fr.addEventListener('error', (e) => {
			callback(chrome.i18n.getMessage('error_analyze_failed', [fr.error.toString()]), null);
		});

		fr.readAsArrayBuffer(blob);
	}

	function sendInfoResponse(info: ImageInfo, port: chrome.runtime.Port) {
		if (info === null) {
			port.postMessage({
				action: 'analysis-done'
			});
		} else {
			port.postMessage({
				action: 'extend-properties',
				data: info
			});
		}
	}

	function sendErrorResponse(error: string, port: chrome.runtime.Port) {
		port.postMessage({
			action: 'analysis-error',
			error: error
		});
	}

	// https://gist.github.com/jonleighton/958841
	function toBase64(arrayBuffer: ArrayBuffer): string {
		var base64 = ''
		var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

		var bytes = new Uint8Array(arrayBuffer)
		var byteLength = bytes.byteLength
		var byteRemainder = byteLength % 3
		var mainLength = byteLength - byteRemainder

		var a, b, c, d
		var chunk

		// Main loop deals with bytes in chunks of 3
		for (var i = 0; i < mainLength; i = i + 3) {
			// Combine the three bytes into a single integer
			chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

			// Use bitmasks to extract 6-bit segments from the triplet
			a = (chunk & 16515072) >> 18    // 16515072 = (2^6 - 1) << 18
			b = (chunk & 258048) >> 12      // 258048   = (2^6 - 1) << 12
			c = (chunk & 4032) >> 6         // 4032     = (2^6 - 1) << 6
			d = chunk & 63                  // 63       = 2^6 - 1

			// Convert the raw binary segments to the appropriate ASCII encoding
			base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
		}

		// Deal with the remaining bytes and padding
		if (byteRemainder == 1) {
			chunk = bytes[mainLength]

			a = (chunk & 252) >> 2          // 252 = (2^6 - 1) << 2

			// Set the 4 least significant bits to zero
			b = (chunk & 3) << 4            // 3   = 2^2 - 1

			base64 += encodings[a] + encodings[b] + '=='
		} else if (byteRemainder == 2) {
			chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

			a = (chunk & 64512) >> 10      // 64512 = (2^6 - 1) << 10
			b = (chunk & 1008) >> 4        // 1008  = (2^6 - 1) << 4

			// Set the 2 least significant bits to zero
			c = (chunk & 15) << 2          // 15    = 2^4 - 1

			base64 += encodings[a] + encodings[b] + encodings[c] + '='
		}

		return base64
	}

	module GifParser {
		/** Implementation of libgif's stream class for ArrayBuffer data*/
		class BlobStream implements GifStream {
			private data: Uint8Array;
			private pos: number;

			constructor	(buffer: ArrayBuffer) {
				this.data = new Uint8Array(buffer);
				this.pos = 0;
			}

			public read(length: number): string {
				var s = '';
				for (var i = 0; i < length; i++) {
					s += String.fromCharCode(this.readByte());
				}
				return s;
			}

			public readByte(): number {
				if (this.pos >= this.data.length) {
					throw new Error('Attempted to read past end of stream.');
				}
				return this.data[this.pos++] & 0xFF;
			}

			public readBytes(length: number): number[] {
				var bytes = [];
				for (var i = 0; i < length; i++) {
					bytes.push(this.readByte());
				}
				return bytes;
			}

			public readUnsigned(): number {
				var a = this.readBytes(2);
				return (a[1] << 8) + a[0];
			}
		}

		class Handler implements GifParseHandler {
			callback: Function;
			info: ImageInfo;
			animated: boolean;

			constructor(info: ImageInfo, callback: (err, info) => void) {
				this.callback = callback;
				this.animated = false;
				this.info = info;

				this.info.frames = 0;
				this.info.framerate = 0;
				this.info.duration = 0;
			}

			hdr(header: GifHeader) {
				console.log('HEADER', header);
			}

			gce(block: GifGceBlock) {
				this.info.frames += 1;
				this.info.duration += block.delayTime / 100;
			}

			eof(block) {
				if (this.info.duration > 0) {
					this.info.framerate = this.info.frames / this.info.duration;
				} else {
					delete this.info.framerate;
					delete this.info.duration;
				}

				this.callback(null, this.info);
				this.callback(null, null);
			}
		}

		export function parse(buffer: ArrayBuffer, info: ImageInfo, callback: (err, info) => void) {
			var stream = new BlobStream(buffer);
			var handler = new Handler(info, callback);
			parseGIF(stream, handler);
		}
	}

	module JpegParser {
		export function parse(buffer: ArrayBuffer, info: ImageInfo, callback: (err, info) => void) {
			try {
				console.log('parsing exif');
				var exif = new ExifReader();
				exif.load(buffer);
				
				info.metadata = exif.getAllTags();
				console.log(info.metadata);
				
				callback(null, info);
				callback(null, null);
			} catch (e) {
				if (e instanceof Error && (<Error>e).message === 'No Exif data') {
					// Image doesn't have exif data. Ignore.
					callback(null, null);
				} else {
					throw e;
				}
			}
		}
	}
}

module ImageSave {
	export function onSaveMessage(message: ISaveMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
		if (chrome.downloads) {
			var options: chrome.downloads.DownloadOptions = {
				url: message.url,
				saveAs: message.saveAs,
			};

			if (message.filename) {
				options.filename = message.filename;
			}

			var a = document.createElement('a');
			a.href = message.url;
			if (message.force
				|| a.protocol === 'blob:'
				|| settings.restrictedDomains.every((pattern) => !isHostnamePatternMatch(pattern, a.hostname))) {
				// If this is not a restricted domain, or we failed to download via XHR,
				// download it normally.
				chrome.downloads.download(options);

				// If this is a blob, clean up afterwards.
				if (a.protocol === 'blob:') {
					URL.revokeObjectURL(message.url);
				}
			} else {
				// If this site restricts downloads by referrer, cookie or some other means,
				// have the tab download the image via XHR and pass it to us as a data URI.
				sendResponse({
					action: 'xhr-download',
					url: message.url,
					saveAs: message.saveAs,
				});
			}
		} else {
			chrome.tabs.create({ url: 'options-page.html' });
		}
	}

	export function rebuildActions() {
		var ALT = 0x1;
		var CTRL = 0x2;
		var SHIFT = 0x4;
		var map = {
			none: 0,
			save: 1,
			saveas: 2,
		};

		var actions = [0, 0, 0, 0, 0, 0, 0, 0];
		actions[0] = 0;
		actions[ALT] = 0;
		actions[CTRL] = map[settings.ctrlAction] || 0;
		actions[CTRL | ALT] = map[settings.ctrlAltAction] || 0;
		actions[SHIFT] = map[settings.shiftAction] || 0;
		actions[SHIFT | ALT] = map[settings.shiftAltAction] || 0;
		actions[SHIFT | CTRL] = map[settings.ctrlShiftAction] || 0;
		actions[SHIFT | CTRL | ALT] = 0;

		chrome.storage.local.set({ actions: actions }, () => {
			chrome.tabs.query({}, (tabs) => {
				tabs.forEach((tab) => {
					chrome.tabs.sendMessage(tab.id, { action: 'update' });
				});
			});
		});
	}

	function isHostnamePatternMatch(pattern: string, hostname: string): boolean {
		pattern = pattern.replace(/\[(.+?)\]/g, '($1)');
		pattern = pattern.replace(/\./g, '\\.');
		pattern = pattern.replace(/\*/g, '.*');

		var regex = new RegExp(pattern);
		return regex.test(hostname);
	}
}

init();