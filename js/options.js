/// <reference path="lib/chrome.d.ts" />
/// <reference path="lib/options-page.ts" />
/// <reference path="settings.ts" />

document.addEventListener('setting', function (e) {
    var detail = e.detail;

    if (detail.key.toLowerCase().match(/(alt|ctrl|shift)+action/)) {
        chrome.runtime.getBackgroundPage(function (bg) {
            bg.ImageSave.rebuildActions();
        });
    }
});

window.addEventListener('DOMContentLoaded', function () {
    if (typeof chrome.downloads === 'undefined') {
        document.getElementById('no-downloads-api').removeAttribute('hidden');
    }

    // Remove this once Opera figures out how to make chrome.runtime.onInstalled work.
    if (!settings.get(settings.initSetting)) {
        settings.init();
        chrome.runtime.getBackgroundPage(function (bg) {
            bg.ImageSave.rebuildActions();
            location.reload();
        });
    }
});

// Transform functions
function linesToArray(lines) {
    if (lines) {
        var array = lines.split('\n').map(function (val) {
            return val.trim();
        });
        array = array.filter(function (line) {
            return line !== '';
        });
        return array.sort();
    } else {
        return [];
    }
}

function arrayToLines(array) {
    if (array) {
        return array.join('\n');
    } else {
        return '';
    }
}
