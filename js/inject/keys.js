/// <reference path="../lib/chrome.d.ts" />
/// <reference path="../interfaces.ts" />

var SAVEAS = 2;

var ALT = 0x1;
var CTRL = 0x2;
var SHIFT = 0x4;

var actions = [0, 0, 0, 0, 0, 0, 0, 0];
var suspended = false;

//var lastDownloaded: HTMLImageElement = null;
//var progressElement: HTMLDivElement = null;
function loadActions() {
    chrome.storage.local.get('actions', function (result) {
        actions = result['actions'];
    });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.action) {
        case 'update':
            loadActions();
            break;

        case 'xhr-download':
            // Only the top-level script should handle this. Iframes should ignore it.
            if (window.top !== window.self) {
                break;
            }

            var xhr = new XMLHttpRequest();
            xhr.responseType = 'blob';

            //xhr.addEventListener('progress', (e: XMLHttpRequestEvent) => {
            //	if (e.lengthComputable) {
            //		console.log('Downloaded', e.loaded, 'of', e.total);
            //	} else {
            //		console.log('Downloaded', e.loaded);
            //	}
            //});
            xhr.addEventListener('load', function (e) {
                chrome.runtime.sendMessage({
                    action: 'save-image',
                    url: URL.createObjectURL(xhr.response),
                    saveAs: message.saveAs,
                    filename: message.url.substr(message.url.lastIndexOf('/') + 1)
                });
            });

            xhr.addEventListener('error', function (e) {
                // The XHR method failed. Force an attempt using the
                // downloads API.
                chrome.runtime.sendMessage({
                    action: 'save-image',
                    url: message.url,
                    saveAs: message.saveAs,
                    force: true
                });
            });

            xhr.open('get', message.url, true);
            xhr.send();
            break;
    }
});

window.addEventListener('click', function (e) {
    if (suspended) {
        return;
    }

    if (e.target.nodeName === 'IMG') {
        var keymask = 0;
        if (e.altKey) {
            keymask |= ALT;
        }
        if (e.ctrlKey) {
            keymask |= CTRL;
        }

        if (e.shiftKey) {
            keymask |= SHIFT;
        }

        if (actions[keymask] !== 0) {
            // This can trigger for multiple elements, so disable it
            // for a moment so we don't download multiple times at once.
            suspended = true;
            window.setTimeout(function () {
                suspended = false;
            }, 500);

            // Prevent this from triggering links
            e.preventDefault();
            e.stopImmediatePropagation();

            if (actions[keymask] !== SAVEAS) {
                var a = document.createElement('a');
                a.href = e.target.src;
                a.target = '_blank';
                a.download = a.href.substring(a.href.lastIndexOf('/') + 1);
                a.click();
            } else {
                chrome.runtime.sendMessage({
                    action: 'save-image',
                    url: e.target.src,
                    saveAs: true
                });
            }
            // Remember the last-saved image to show a progress bar
            // for the XHR workaround method.
            //lastDownloaded = <HTMLImageElement>e.target;
        }
    }
}, true);

loadActions();
