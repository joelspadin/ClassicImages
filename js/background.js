/// <reference path="settings.ts" />
/// <reference path="dynamic-inject.ts" />
/// <reference path="lib/chrome.d.ts" />
/// <reference path="lib/libgif.d.ts" />
function init() {
    var MESSAGE_HANDLERS = {
        'save-image': ImageSave.onSaveMessage
    };

    var CONNECTION_HANDLERS = {
        'analyze-image': ImageProperties.onAnalyzeMessage
    };

    // Listen for context menu events
    chrome.contextMenus.onClicked.addListener(ImageProperties.onContextMenuClicked);

    // Short connection message handlers
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        var handler = MESSAGE_HANDLERS[message.action];
        if (handler) {
            handler(message, sender, sendResponse);
        } else {
            console.error('Unknown message', message);
        }
    });

    // Long-lived connection message handlers
    chrome.runtime.onConnect.addListener(function (port) {
        // Port connections should only come from the image properties pop-up for now
        console.assert(port.name === 'image-properties');
        port.onMessage.addListener(function (message) {
            var handler = CONNECTION_HANDLERS[message.action];
            if (handler) {
                handler(message, port);
            } else {
                console.error('Unknown port message', message);
            }
        });
    });

    inject.init("js/inject/dialog.js", "js/inject/filesize.js", "js/inject/cldr-plural.js");
}
;

chrome.runtime.onInstalled.addListener(function (details) {
    var CONTEXT_ID = 'image-properties';

    settings.init();
    ImageSave.rebuildActions();
    inject.clearInjectedTabs();

    chrome.contextMenus.create({
        id: CONTEXT_ID,
        title: chrome.i18n.getMessage('ctx_image_properties'),
        contexts: ['image']
    });
});

var ImageProperties;
(function (ImageProperties) {
    var MIME_TYPES = {
        'BMP': ['image/bmp', 'image/x-windows-bmp'],
        'GIF': ['image/gif'],
        'JPEG': ['image/jpeg', 'image/pjpeg'],
        'ICO': ['image/x-icon'],
        'PGM': ['image/x-portable-graymap'],
        'PNG': ['image/png'],
        'SVG': ['image/svg+xml', 'image/svg-xml'],
        'TIFF': ['image/tiff', 'image/x-tiff'],
        'WebP': ['image/webp'],
        'XBM': ['image/x-xbitmap']
    };

    function onAnalyzeMessage(message, port) {
        // Fetch the image
        var xhr = new XMLHttpRequest();
        xhr.responseType = 'blob';
        xhr.addEventListener('load', function (e) {
            // Parse the image and pass back any new info we get
            parseImage(xhr.response, function (err, info) {
                if (err) {
                    sendErrorResponse(err, port);
                } else {
                    sendInfoResponse(info, port);
                }
            });
        });

        xhr.addEventListener('error', function (e) {
            sendErrorResponse(xhr.status + ' ' + xhr.statusText, port);
        });

        xhr.addEventListener('loadend', function (e) {
            // Clean up the blob URL
            URL.revokeObjectURL(message.url);
        });
        xhr.open('get', message.url, true);
        xhr.send();
    }
    ImageProperties.onAnalyzeMessage = onAnalyzeMessage;

    function onContextMenuClicked(e, tab) {
        inject.injectScript(tab.id, function (err) {
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
    ImageProperties.onContextMenuClicked = onContextMenuClicked;

    function getGenericImageData(type, data, callback) {
        var image = new Image();
        image.addEventListener('load', function () {
            callback(null, {
                width: image.width,
                height: image.height,
                mimeType: type,
                type: getImageType(type),
                fileSize: data.byteLength
            });
        });

        image.addEventListener('error', function (e) {
            callback(chrome.i18n.getMessage('error_analyze_failed', [e.error.toString()]), null);
        });

        image.src = 'data:' + type + ';base64,' + toBase64(data);
    }

    function getImageType(mimeType) {
        for (var key in MIME_TYPES) {
            if (MIME_TYPES.hasOwnProperty(key)) {
                if (MIME_TYPES[key].indexOf(mimeType.toLowerCase()) >= 0) {
                    return key;
                }
            }
        }
        return null;
    }

    function parseImage(blob, callback) {
        var fr = new FileReader();
        fr.addEventListener('load', function (e) {
            getGenericImageData(blob.type, fr.result, function (err, info) {
                if (err) {
                    callback(chrome.i18n.getMessage('error_analyze_failed', [err]), null);
                } else {
                    // Send the info we've collected up to now
                    callback(null, info);

                    try  {
                        switch (info.type) {
                            case 'GIF':
                                GifParser.parse(fr.result, info, callback);
                                break;

                            case 'JPEG':
                                JpegParser.parse(fr.result, info, callback);
                                break;
                        }
                    } catch (e) {
                        callback(chrome.i18n.getMessage('error_analyze_failed', [e.toString()]), null);
                    }
                }
            });
        });

        fr.addEventListener('error', function (e) {
            callback(chrome.i18n.getMessage('error_analyze_failed', [fr.error.toString()]), null);
        });

        fr.readAsArrayBuffer(blob);
    }

    function sendInfoResponse(info, port) {
        port.postMessage({
            action: 'extend-properties',
            data: info
        });
    }

    function sendErrorResponse(error, port) {
        port.postMessage({
            action: 'parse-error',
            error: error
        });
    }

    // https://gist.github.com/jonleighton/958841
    function toBase64(arrayBuffer) {
        var base64 = '';
        var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

        var bytes = new Uint8Array(arrayBuffer);
        var byteLength = bytes.byteLength;
        var byteRemainder = byteLength % 3;
        var mainLength = byteLength - byteRemainder;

        var a, b, c, d;
        var chunk;

        for (var i = 0; i < mainLength; i = i + 3) {
            // Combine the three bytes into a single integer
            chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

            // Use bitmasks to extract 6-bit segments from the triplet
            a = (chunk & 16515072) >> 18;
            b = (chunk & 258048) >> 12;
            c = (chunk & 4032) >> 6;
            d = chunk & 63;

            // Convert the raw binary segments to the appropriate ASCII encoding
            base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
        }

        // Deal with the remaining bytes and padding
        if (byteRemainder == 1) {
            chunk = bytes[mainLength];

            a = (chunk & 252) >> 2;

            // Set the 4 least significant bits to zero
            b = (chunk & 3) << 4;

            base64 += encodings[a] + encodings[b] + '==';
        } else if (byteRemainder == 2) {
            chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

            a = (chunk & 64512) >> 10;
            b = (chunk & 1008) >> 4;

            // Set the 2 least significant bits to zero
            c = (chunk & 15) << 2;

            base64 += encodings[a] + encodings[b] + encodings[c] + '=';
        }

        return base64;
    }

    var GifParser;
    (function (GifParser) {
        /** Implementation of libgif's stream class for ArrayBuffer data*/
        var BlobStream = (function () {
            function BlobStream(buffer) {
                this.data = new Uint8Array(buffer);
                this.pos = 0;
            }
            BlobStream.prototype.read = function (length) {
                var s = '';
                for (var i = 0; i < length; i++) {
                    s += String.fromCharCode(this.readByte());
                }
                return s;
            };

            BlobStream.prototype.readByte = function () {
                if (this.pos >= this.data.length) {
                    throw new Error('Attempted to read past end of stream.');
                }
                return this.data[this.pos++] & 0xFF;
            };

            BlobStream.prototype.readBytes = function (length) {
                var bytes = [];
                for (var i = 0; i < length; i++) {
                    bytes.push(this.readByte());
                }
                return bytes;
            };

            BlobStream.prototype.readUnsigned = function () {
                var a = this.readBytes(2);
                return (a[1] << 8) + a[0];
            };
            return BlobStream;
        })();

        var Handler = (function () {
            function Handler(info, callback) {
                this.callback = callback;
                this.animated = false;
                this.info = info;

                this.info.frames = 0;
                this.info.framerate = 0;
                this.info.duration = 0;
            }
            Handler.prototype.hdr = function (header) {
                console.log('HEADER', header);
            };

            Handler.prototype.gce = function (block) {
                this.info.frames += 1;
                this.info.duration += block.delayTime / 100;
            };

            Handler.prototype.eof = function (block) {
                if (this.info.duration > 0) {
                    this.info.framerate = this.info.frames / this.info.duration;
                } else {
                    delete this.info.framerate;
                    delete this.info.duration;
                }

                this.callback(null, this.info);
            };
            return Handler;
        })();

        function parse(buffer, info, callback) {
            var stream = new BlobStream(buffer);
            var handler = new Handler(info, callback);
            parseGIF(stream, handler);
        }
        GifParser.parse = parse;
    })(GifParser || (GifParser = {}));

    var JpegParser;
    (function (JpegParser) {
        function parse(buffer, info, callback) {
            try  {
                console.log('parsing exif');
                var exif = new ExifReader();
                exif.load(buffer);

                info.metadata = exif.getAllTags();
                console.log(info.metadata);

                callback(null, info);
            } catch (e) {
                if (e instanceof Error && e.message === 'No Exif data') {
                    // Image doesn't have exif data. Ignore.
                    console.log('no exif data');
                } else {
                    throw e;
                }
            }
        }
        JpegParser.parse = parse;
    })(JpegParser || (JpegParser = {}));
})(ImageProperties || (ImageProperties = {}));

var ImageSave;
(function (ImageSave) {
    function onSaveMessage(message, sender, sendResponse) {
        if (chrome.downloads) {
            var options = {
                url: message.url,
                saveAs: message.saveAs
            };

            if (message.filename) {
                options.filename = message.filename;
            }

            var a = document.createElement('a');
            a.href = message.url;
            if (message.force || a.protocol === 'blob:' || settings.restrictedDomains.every(function (pattern) {
                return !isHostnamePatternMatch(pattern, a.hostname);
            })) {
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
                    saveAs: message.saveAs
                });
            }
        } else {
            chrome.tabs.create({ url: 'options-page.html' });
        }
    }
    ImageSave.onSaveMessage = onSaveMessage;

    function rebuildActions() {
        var ALT = 0x1;
        var CTRL = 0x2;
        var SHIFT = 0x4;
        var map = {
            none: 0,
            save: 1,
            saveas: 2
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

        chrome.storage.local.set({ actions: actions }, function () {
            chrome.tabs.query({}, function (tabs) {
                tabs.forEach(function (tab) {
                    chrome.tabs.sendMessage(tab.id, { action: 'update' });
                });
            });
        });
    }
    ImageSave.rebuildActions = rebuildActions;

    function isHostnamePatternMatch(pattern, hostname) {
        pattern = pattern.replace(/\[(.+?)\]/g, '($1)');
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');

        var regex = new RegExp(pattern);
        return regex.test(hostname);
    }
})(ImageSave || (ImageSave = {}));

init();
