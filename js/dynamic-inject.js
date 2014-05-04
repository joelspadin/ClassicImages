/// <reference path="lib/chrome.d.ts" />
var inject;
(function (_inject) {
    var INJECTED_KEY = 'injected';

    var _script = null;
    var _dependencies = null;

    function init(script) {
        var dependencies = [];
        for (var _i = 0; _i < (arguments.length - 1); _i++) {
            dependencies[_i] = arguments[_i + 1];
        }
        chrome.tabs.onRemoved.addListener(onTabRemoved);
        chrome.tabs.onUpdated.addListener(onTabUpdated);

        _script = script;
        _dependencies = dependencies;
    }
    _inject.init = init;

    function clearInjectedTabs(callback) {
        // Set the list of injected tabs to an empty array
        var items = {};
        items[INJECTED_KEY] = [];
        chrome.storage.local.set(items, function () {
            if (callback) {
                callback(null);
            }
        });
    }
    _inject.clearInjectedTabs = clearInjectedTabs;

    function injectScript(tabId, callback) {
        getTabInjected(tabId, function (err, injected) {
            if (injected) {
                // script already injected. do nothing.
                if (callback) {
                    callback(null);
                }
            } else {
                // script not injected yet. inject it.
                doInject(tabId, callback);
            }
        });
    }
    _inject.injectScript = injectScript;

    function doInject(tabId, callback) {
        var scripts = _dependencies.slice();
        scripts.push(_script);

        function injectOne() {
            if (scripts.length == 0) {
                setTabInjected(tabId, true, callback);
            } else {
                var next = scripts.shift();
                chrome.tabs.executeScript(tabId, { file: next }, injectOne);
            }
        }

        if (scripts.length > 0) {
            injectOne();
        } else {
            throw new Error('No script to inject');
        }
    }

    function getTabInjected(tabId, callback) {
        chrome.storage.local.get(INJECTED_KEY, function (items) {
            // Return whether tabId is found in the list of injected tabs
            var list = items[INJECTED_KEY] || [];
            callback(null, list.indexOf(tabId) >= 0);
        });
    }

    function onTabRemoved(tabId, removeInfo) {
        // Remove the tab from the injected tabs list
        setTabInjected(tabId, false);
    }

    function onTabUpdated(tabId, changeInfo) {
        // Remove the tab from the injected tabs list
        // if it has navigated to a new URL.
        if (changeInfo.url || changeInfo.status === 'complete') {
            setTabInjected(tabId, false);
        }
    }

    /**
    * Sets whether we have injected code into a tab
    * @param tabId		The ID of the tab
    * @param injected	Is code injected into the tab?
    * @param callback  Called when finished
    */
    function setTabInjected(tabId, injected, callback) {
        // Get the list of injected tab IDs
        chrome.storage.local.get(INJECTED_KEY, function (items) {
            var list = items[INJECTED_KEY] || [];
            var changed = false;

            // Update the list of tabs
            if (injected) {
                list.push(tabId);
                changed = true;
            } else {
                var index = list.indexOf(tabId);
                if (index >= 0) {
                    list.splice(index, 1);
                    changed = true;
                }
            }

            // If the list changed, put it back into storage
            if (changed) {
                items[INJECTED_KEY] = list;
                chrome.storage.local.set(items, function () {
                    if (callback) {
                        callback(null);
                    }
                });
            } else if (callback) {
                callback(null);
            }
        });
    }
})(inject || (inject = {}));
