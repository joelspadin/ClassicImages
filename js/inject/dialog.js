/// <reference path="../lib/chrome.d.ts" />
/// <reference path="../interfaces.ts" />
/// <reference path="filesize.d.ts" />
/// <reference path="cldr-plural.d.ts" />
chrome.runtime.onMessage.addListener(function (message) {
    switch (message.action) {
        case 'image-properties':
            var port = createConnection();
            analysis.begin(message.url, port);
            break;
    }
});

function createConnection() {
    var port = chrome.runtime.connect({ name: 'image-properties' });
    port.onMessage.addListener(function (message) {
        switch (message.action) {
            case 'extend-properties':
                dialog.updateImageInfo(message.data);
                break;

            case 'parse-error':
                dialog.showLoadError(message.error);
                break;
        }
    });
    return port;
}

window.addEventListener('keydown', function (e) {
    switch (e.which) {
        case 13:
        case 27:
            dialog.close();
            break;
    }
});

var analysis;
(function (analysis) {
    var localize = chrome.i18n.getMessage;

    function begin(url, port) {
        dialog.show({ url: url });

        var xhr = new XMLHttpRequest();
        xhr.responseType = 'blob';

        xhr.addEventListener('readystatechange', function (e) {
            if (xhr.readyState === 2) {
                var headerString = xhr.getAllResponseHeaders();
                var headers = {};

                headerString.split('\n').forEach(function (line) {
                    var split = line.indexOf(':');
                    var key = line.substr(0, split).trim().toLowerCase();
                    var value = line.substr(split + 1).trim();
                    headers[key] = value;
                });

                dialog.updateImageInfo({ fileSize: parseInt(headers['content-length']) });
            }
        });

        xhr.addEventListener('progress', function (e) {
            if (e.lengthComputable) {
                dialog.updateLoadProgress(e.loaded / e.total * 100);
            }
        });

        xhr.addEventListener('load', function (e) {
            // Pass the image off to the background for further processing
            port.postMessage({
                action: 'analyze-image',
                mimeType: xhr.responseType,
                filename: url.substr(url.lastIndexOf('/') + 1),
                url: URL.createObjectURL(xhr.response)
            });
        });

        xhr.addEventListener('error', function (e) {
            dialog.showLoadError(localize('error_load_failed', [e.error.toString()]));
        });

        xhr.open('get', url, true);
        xhr.send();
    }
    analysis.begin = begin;
})(analysis || (analysis = {}));

var dialog;
(function (dialog) {
    var localize = chrome.i18n.getMessage;

    var Tabs;
    (function (Tabs) {
        Tabs[Tabs["Main"] = 0] = "Main";
        Tabs[Tabs["Metadata"] = 1] = "Metadata";
    })(Tabs || (Tabs = {}));

    var OVERLAY_ID = '__ext_classic_images_overlay__';
    var CONTENT_ID = '__ext_classic_images_content__';
    var TABS_ID = '__ext_classic_images_tabs__';
    var EXIF_TAB_ID = '__ext_classic_images_metadata__';
    var SELECTED_CLASS = '__ext_classic_images_selected_tab__';
    var PULSE_CLASS = '__ext_classic_images_pulse__';
    var TRANSPARENT_CLASS = '__ext_classic_images_transparent__';
    var HIDDEN_TEXT_CLASS = '__ext_classic_images_hidden_text__';
    var ANALYZING_CLASS = '__ext_classic_images_analyzing__';
    var ERROR_CLASS = '__ext_classic_images_error__';

    var ANIMATION_LENGTH = 200;

    var BUTTONS = [
        { text: localize('close'), action: close }
    ];

    var INFO = [
        { name: localize('prop_imagetype'), value: function (info) {
                return (info.mimeType) ? localize('val_imagetype', [info.type || localize('unknown'), info.mimeType]) : '';
            } },
        { name: localize('prop_dimensions'), value: function (info) {
                return (info.width && info.height) ? localize('val_dimensions', [info.width, info.height]) : '';
            } },
        { name: localize('prop_bitdepth'), value: function (info) {
                return info.bitDepth ? localize('val_bitdepth', [info.bitDepth]) : null;
            } },
        { name: localize('prop_filesize'), value: function (info) {
                return info.fileSize ? localize('val_filesize', [filesize(info.fileSize, { round: 1 }), formatLargeNumber(info.fileSize)]) : '';
            } },
        {
            name: localize('prop_animation'),
            value: function (info) {
                if (info.frames) {
                    if (info.duration && info.framerate) {
                        // If duration and framerate, use "## frames in ## seconds (## fps)"
                        var duration = formatNumber(info.duration);
                        var framerate = formatNumber(info.framerate);

                        return localize('val_animation_duration', [
                            info.frames,
                            plural.get('cnt_frames', info.frames),
                            duration,
                            plural.get('cnt_seconds', duration),
                            framerate]);
                    } else {
                        // Else use "## frames"
                        return localize('val_animation', [info.frames, plural.get('cnt_frames', info.frames)]);
                    }
                } else {
                    return null;
                }
            }
        },
        { name: localize('prop_address'), value: function (info) {
                return info.url ? elem('a', formatUrl(info.url), { href: info.url, target: '_blank' }) : '';
            } }
    ];

    var built = false;
    var closingTimeout = null;
    var hiddenEmbeds = [];
    var inputIndex = 0;

    dialog.overlay = null;
    dialog.content = null;
    dialog.tabSelector = null;
    dialog.tabs = [];
    dialog.info = {};

    function close() {
        if (built && !closingTimeout) {
            dialog.overlay.classList.add(TRANSPARENT_CLASS);
            closingTimeout = window.setTimeout(function () {
                closingTimeout = null;
                destroyDialog();
            }, ANIMATION_LENGTH);
        }
    }
    dialog.close = close;

    function show(info) {
        if (dialog.content && !dialog.content.classList.contains(TRANSPARENT_CLASS)) {
            pulse();
        }

        if (!built) {
            buildDialog();
        }

        if (closingTimeout) {
            window.clearTimeout(closingTimeout);
        }

        updateImageInfo(info);

        window.setTimeout(function () {
            dialog.overlay.removeAttribute('style');
            dialog.overlay.classList.remove(TRANSPARENT_CLASS);
        }, 10);
    }
    dialog.show = show;

    function showLoadError(message) {
        var error = elem('p', message, { 'class': ERROR_CLASS });
        dialog.content.insertBefore(error, dialog.content.querySelector('footer'));
    }
    dialog.showLoadError = showLoadError;

    function updateImageInfo(info) {
        for (var key in info) {
            if (info.hasOwnProperty(key)) {
                dialog.info[key] = info[key];
            }
        }

        // Clear everything
        dialog.tabs[0 /* Main */].innerHTML = '';
        dialog.tabs[1 /* Metadata */].innerHTML = '';

        // Rebuild general info
        INFO.forEach(function (setup) {
            var value = setup.value(dialog.info);
            if (value !== null) {
                var dt = elem('dt', setup.name);
                var dd = elem('dd');

                dt.textContent = setup.name;
                if (value instanceof HTMLElement) {
                    dd.appendChild(value);
                } else if (value === '') {
                    dd.textContent = localize('analyzing');
                    dd.classList.add(ANALYZING_CLASS);
                } else {
                    dd.textContent = value.toString();
                }

                // Insert some hidden characters to format nicely for copying
                insertHiddenCharacters(dt, dd);

                appendTo(dialog.tabs[0 /* Main */], dt, dd);
            }
        });

        // Rebuild metadata if available
        if (dialog.info.metadata) {
            var keys = [];
            for (var key in dialog.info.metadata) {
                if (info.metadata.hasOwnProperty(key)) {
                    keys.push(key);
                }
            }

            keys.sort();
            keys.forEach(function (key) {
                var data = dialog.info.metadata[key];
                var dt = elem('dt', key);
                var dd = elem('dd', formatExif(data));

                // Insert some hidden characters to format nicely for copying
                insertHiddenCharacters(dt, dd);

                appendTo(dialog.tabs[1 /* Metadata */], dt, dd);
            });

            showTabs(true);
        } else {
            showTabs(false);
        }
    }
    dialog.updateImageInfo = updateImageInfo;

    function updateLoadProgress(percentComplete) {
        // TODO: might need to do something for large images.
        // Small ones load pretty much instantly.
    }
    dialog.updateLoadProgress = updateLoadProgress;

    function buildDialog() {
        built = true;
        styles.inject();
        hideEmbeds();

        dialog.overlay = elem('div', { 'class': TRANSPARENT_CLASS, id: OVERLAY_ID });
        dialog.overlay.style.opacity = '0';
        dialog.overlay.addEventListener('click', close, false);
        dialog.overlay.addEventListener('animationend', endPulse, false);
        dialog.overlay.addEventListener('webkitAnimationEnd', endPulse, false);

        dialog.content = elem('div', { id: CONTENT_ID });
        dialog.content.addEventListener('click', function (e) {
            e.stopPropagation();
        }, false);

        // Dialog header
        var header = elem('header', localize('title_image_properties'));

        // Tab Header
        dialog.tabSelector = elem('div', { id: TABS_ID });
        dialog.tabSelector.hidden = true;

        var mainTabSelector = elem('a', localize('tab_general'));
        mainTabSelector.addEventListener('click', selectTab.bind(null, mainTabSelector, 0 /* Main */), false);

        var metaTabSelector = elem('a', localize('tab_metadata'));
        metaTabSelector.addEventListener('click', selectTab.bind(null, metaTabSelector, 1 /* Metadata */), false);

        appendTo(dialog.tabSelector, mainTabSelector, metaTabSelector);

        // Tab content
        var maintab = elem('dl');
        var metatab = elem('dl', { id: EXIF_TAB_ID });
        metatab.hidden = true;

        dialog.tabs[0 /* Main */] = maintab;
        dialog.tabs[1 /* Metadata */] = metatab;

        // Buttons
        var footer = elem('footer');

        BUTTONS.forEach(function (info) {
            var button = elem('button', info.text);
            button.addEventListener('click', info.action, false);
            footer.appendChild(button);
        });

        appendTo(dialog.content, header, dialog.tabSelector, maintab, metatab, footer);

        dialog.overlay.appendChild(dialog.content);
        document.body.appendChild(dialog.overlay);

        selectTab(mainTabSelector, 0 /* Main */);
    }

    function destroyDialog() {
        styles.remove();
        restoreEmbeds();

        document.body.removeChild(dialog.overlay);
        dialog.overlay = null;
        dialog.content = null;
        dialog.tabSelector = null;
        dialog.tabs = [];
        dialog.info = {};

        built = false;
    }

    function endPulse() {
        if (dialog.content.classList.contains(PULSE_CLASS)) {
            dialog.content.classList.remove(PULSE_CLASS);
        }
    }

    function hideEmbeds() {
        var embeds = document.querySelectorAll('embed, object');
        for (var i = 0; i < embeds.length; i++) {
            var elem = embeds[i];
            var info = {
                element: elem,
                visibility: elem.style.visibility || 'visible'
            };
            elem.style.visibility = 'hidden';
            hiddenEmbeds.push(info);
        }
    }

    function pulse() {
        dialog.content.classList.add(PULSE_CLASS);
    }

    function restoreEmbeds() {
        hiddenEmbeds.forEach(function (embed) {
            embed.element.style.visibility = embed.visibility;
        });
        hiddenEmbeds = [];
    }

    function selectTab(button, tab) {
        var buttons = dialog.tabSelector.childNodes;
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.remove(SELECTED_CLASS);
        }

        button.classList.add(SELECTED_CLASS);

        dialog.tabs[tab].hidden = false;
        dialog.tabs.forEach(function (element, i) {
            if (i !== tab) {
                element.hidden = true;
            }
        });
    }

    function showTabs(show) {
        dialog.tabSelector.hidden = !show;
    }

    

    function elem(tag, text, attribs) {
        var e = document.createElement(tag);

        if (typeof arguments[1] === 'object') {
            attribs = arguments[1];
            text = null;
        }

        if (text) {
            e.textContent = text;
        }

        if (attribs) {
            for (var key in attribs) {
                if (attribs.hasOwnProperty(key)) {
                    e.setAttribute(key, attribs[key]);
                }
            }
        }
        return e;
    }

    function appendTo(parent) {
        var children = [];
        for (var _i = 0; _i < (arguments.length - 1); _i++) {
            children[_i] = arguments[_i + 1];
        }
        children.forEach(function (child) {
            return parent.appendChild(child);
        });
    }

    function formatUrl(url) {
        var a = document.createElement('a');
        a.href = url;
        return a.host + a.pathname;
    }

    function formatNumber(n) {
        var s = n.toFixed(1);
        return s.replace(/\.0$/, '');
    }

    function formatLargeNumber(n) {
        var sep = localize('thousands_separator');
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    }

    function formatExif(data) {
        var parts = [];

        var addParts = function (obj) {
            if (Array.isArray(obj)) {
                parts = parts.concat(obj);
            } else {
                parts.push(obj);
            }
        };
        var filter = function (part) {
            return part !== null && part !== '' && part !== null && part !== undefined;
        };
        var toString = function (part) {
            try  {
                return part.toString();
            } catch (e) {
                return '';
            }
        };

        addParts(data.description);
        parts = parts.filter(filter);

        if (parts.length === 0) {
            addParts(data.value);
            parts = parts.filter(filter);
        }

        if (parts.length === 0) {
            return '';
        } else {
            return parts.map(toString).join(', ');
        }
    }

    function insertHiddenCharacters(dt, dd) {
        dt.appendChild(elem('span', ': ', { 'class': HIDDEN_TEXT_CLASS }));
        dd.appendChild(elem('br', { 'class': HIDDEN_TEXT_CLASS }));
    }
})(dialog || (dialog = {}));

var styles;
(function (styles) {
    var injected = false;
    var element = null;

    function inject() {
        if (!injected) {
            var path = chrome.extension.getURL('css/inject/dialog.css');
            element = document.createElement('link');
            element.rel = 'stylesheet';
            element.type = 'text/css';
            element.href = path;
            document.head.appendChild(element);

            injected = true;
        }
    }
    styles.inject = inject;

    function remove() {
        if (injected) {
            document.head.removeChild(element);
            injected = false;
        }
    }
    styles.remove = remove;
})(styles || (styles = {}));

var plural;
(function (plural) {
    var localize = chrome.i18n.getMessage;
    plural.RULES = [
        localize('plural_rule_zero'),
        localize('plural_rule_one'),
        localize('plural_rule_two'),
        localize('plural_rule_few'),
        localize('plural_rule_many'),
        localize('plural_rule_other')
    ].filter(function (rule) {
        return rule !== '';
    });

    function get(message, n) {
        var forms = localize(message).split(';');

        if (typeof n === 'string') {
            n = parseFloat(n);
        }

        for (var i = 0; i <= plural.RULES.length; i++) {
            if (pluralRuleParser(plural.RULES[i], n)) {
                return forms[i];
            }
        }
        console.error('Failed to find plural for', message, n);
        return forms[0];
    }
    plural.get = get;
})(plural || (plural = {}));
