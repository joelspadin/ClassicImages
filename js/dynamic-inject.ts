module inject {
	var INJECTED_KEY = 'injected';

	var _script: string = null;
	var _dependencies: string[] = null;

	export function init(script: string, ...dependencies: string[]) {
		chrome.tabs.onRemoved.addListener(onTabRemoved);
		chrome.tabs.onUpdated.addListener(onTabUpdated);

		_script = script;
		_dependencies = dependencies;
	}

	export function clearInjectedTabs(callback?: Function) {
		// Set the list of injected tabs to an empty array
		var items = {};
		items[INJECTED_KEY] = [];
		chrome.storage.local.set(items, () => {
			if (callback) {
				callback(null);
			}
		});
	}

	export function injectScript(tabId: number, callback?: (err: string) => void) {
		getTabInjected(tabId, (err, injected) => {
			if (injected) {
				// Script already injected. Do nothing.
				if (callback) {
					callback(null);
				}
			} else {
				// Script not injected yet. Inject it.
				doInject(tabId, callback);
			}
		});
	}

	function doInject(tabId: number, callback?: (err: string) => void) {
		var scripts = _dependencies.slice();
		scripts.push(_script);

		function injectOne() {
			if (scripts.length === 0) {
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

	function getTabInjected(tabId: number, callback: (err: string, inject: boolean) => void) {
		chrome.storage.local.get(INJECTED_KEY, (items) => {
			// Return whether tabId is found in the list of injected tabs
			var list: number[] = items[INJECTED_KEY] || [];
			callback(null, list.indexOf(tabId) >= 0);
		});
	}

	function onTabRemoved(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) {
		// Remove the tab from the injected tabs list
		setTabInjected(tabId, false);
	}

	function onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
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
	function setTabInjected(tabId: number, injected: boolean, callback?: (err: string) => void) {
		// Get the list of injected tab IDs
		chrome.storage.local.get(INJECTED_KEY, (items) => {
			var list: number[] = items[INJECTED_KEY] || [];
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
				chrome.storage.local.set(items, () => {
					if (callback) {
						callback(null);
					}
				});
			} else if (callback) {
				callback(null);
			}
		});
	}
}