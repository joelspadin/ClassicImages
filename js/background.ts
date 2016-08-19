function init() {
	var MESSAGE_HANDLERS = {
		'save-image': ImageSave.onSaveMessage,
	};

	var CONNECTION_HANDLERS = {
		'analyze-image': ImageProperties.onAnalyzeMessage,
		'closed': ImageProperties.terminateAnalysis,
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
		console.assert(port.name === 'image-properties', 'Port connections should only come from the image properties pop-up');
		port.onMessage.addListener((message: IMessage) => {
			var handler = CONNECTION_HANDLERS[message.action];
			if (handler) {
				handler(message, port);
			} else {
				console.error('Unknown port message', message);
			}
		});
	});

	inject.init('js/inject/dialog.js', 'js/inject/filesize.js', 'js/inject/cldr-plural.js');
}

// Because Opera doesn't seem to fire runtime.onInstalled or runtime.onStartup
// when the browser starts any more, this will re-register the context menu
// each and every time the extension gets loaded. I shouldn't have to do this,
// but at least this fixes the issue where the context menu doesn't appear
// until you reload the extension.
function stupidWorkaroundToCreateContextMenus() {
	var CONTEXT_ID = 'image-properties';

	chrome.contextMenus.removeAll();
	chrome.contextMenus.create({
		id: CONTEXT_ID,
		title: chrome.i18n.getMessage('ctx_image_properties'),
		contexts: ['image'],
	});
}

chrome.runtime.onInstalled.addListener((details) => {
	settings.init();
	ImageSave.rebuildActions();
	inject.clearInjectedTabs();

	stupidWorkaroundToCreateContextMenus();
});

stupidWorkaroundToCreateContextMenus();

module ImageProperties {
	var currentWorker: Worker = null;

	export function onAnalyzeMessage(message: IAnalyzeMessage, port: chrome.runtime.Port) {
		if (currentWorker !== null) {
			currentWorker.terminate();
		}

		getImageDimensions(message.url, (err, width, height) => {
			if (err) {
				postError(port, err);
			} else {
				postInfo(port, { width: width, height: height });
			}
		});

		var worker = new Worker('js/analysis.js');
		worker.postMessage(message);
		worker.addEventListener('message', (e) => {
			var message = <IWorkerResponse>e.data;
			switch (message.action) {
				case 'info':
					postInfo(port, message.data);
					break;

				case 'done':
					postDone(port);
					break;

				default:
					console.error('unknown message from worker', message);
					break;
			}
		});

		worker.addEventListener('error', (e) => {
			var error = chrome.i18n.getMessage('error_analyze_failed', [e.message]);
			postError(port, error);
		});

		currentWorker = worker;
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

	export function terminateAnalysis() {
		if (currentWorker !== null) {
			console.log('analysis cancelled');
			currentWorker.terminate();
			currentWorker = null;
		}
	}

	function getImageDimensions(blobUrl: string, callback: (err: string, width?: number, height?: number) => void) {
		var image = new Image();
		image.addEventListener('load', () => {
			callback(null, image.width, image.height);
		});

		image.addEventListener('error', (e) => {
			callback(chrome.i18n.getMessage('error_analyze_failed', [e.error.toString()]), null);
		});

		image.src = blobUrl;
	}

	function postDone(port: chrome.runtime.Port) {
		port.postMessage({
			action: 'analysis-done',
		});
	}

	function postError(port: chrome.runtime.Port, error: string) {
		port.postMessage({
			action: 'analysis-error',
			error: error
		});
	}

	function postInfo(port: chrome.runtime.Port, info: ImageInfo) {
		port.postMessage({
			action: 'extend-properties',
			data: info
		});
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