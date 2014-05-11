/// <reference path="settings.ts" />
/// <reference path="dynamic-inject.ts" />
/// <reference path="lib/chrome.d.ts" />
function init() {
    var MESSAGE_HANDLERS = {
        'save-image': ImageSave.onSaveMessage
    };

    var CONNECTION_HANDLERS = {
        'analyze-image': ImageProperties.onAnalyzeMessage,
        'closed': ImageProperties.terminateAnalysis
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
    var currentWorker = null;

    function onAnalyzeMessage(message, port) {
        if (currentWorker !== null) {
            currentWorker.terminate();
        }

        getImageDimensions(message.url, function (err, width, height) {
            if (err) {
                postError(port, err);
            } else {
                postInfo(port, { width: width, height: height });
            }
        });

        var worker = new Worker('js/analysis.js');
        worker.postMessage(message);
        worker.addEventListener('message', function (e) {
            var message = e.data;
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

        worker.addEventListener('error', function (e) {
            var error = chrome.i18n.getMessage('error_analyze_failed', [e.message]);
            postError(port, error);
        });

        currentWorker = worker;
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

    function terminateAnalysis() {
        if (currentWorker !== null) {
            console.log('analysis cancelled');
            currentWorker.terminate();
            currentWorker = null;
        }
    }
    ImageProperties.terminateAnalysis = terminateAnalysis;

    function getImageDimensions(blobUrl, callback) {
        var image = new Image();
        image.addEventListener('load', function () {
            callback(null, image.width, image.height);
        });

        image.addEventListener('error', function (e) {
            callback(chrome.i18n.getMessage('error_analyze_failed', [e.error.toString()]), null);
        });

        image.src = blobUrl;
    }

    function postDone(port) {
        port.postMessage({
            action: 'analysis-done'
        });
    }

    function postError(port, error) {
        port.postMessage({
            action: 'analysis-error',
            error: error
        });
    }

    function postInfo(port, info) {
        port.postMessage({
            action: 'extend-properties',
            data: info
        });
    }
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
