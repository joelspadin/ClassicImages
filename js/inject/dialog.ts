/// <reference path="../lib/chrome.d.ts" />
/// <reference path="../interfaces.ts" />
/// <reference path="filesize.d.ts" />
/// <reference path="cldr-plural.d.ts" />

chrome.runtime.onMessage.addListener((message: IDialogMessage) => {
	switch (message.action) {
		case 'image-properties':
			var port = createConnection();
			analysis.begin(message.url, port);
			break;
	}
});

function createConnection() {
	var port = chrome.runtime.connect({ name: 'image-properties' });
	port.onMessage.addListener((message: IDialogMessage) => {
		switch (message.action) {
			case 'extend-properties':
				dialog.updateImageInfo(message.data);
				break;

			case 'analysis-done':
				dialog.doneAnalyzing();
				break;

			case 'analysis-error':
				dialog.showLoadError(message.error);
				dialog.doneAnalyzing();
				break;
		}
	});
	return port;
}

window.addEventListener('keydown', (e) => {
	switch (e.which) {
		case 13: // Enter
		case 27: // Escape
			dialog.close();
			break;
	}
});

module analysis {
	var localize = chrome.i18n.getMessage;

	export function begin(url: string, port: chrome.runtime.Port) {
		dialog.show({ url: url });

		var xhr = new XMLHttpRequest();
		xhr.responseType = 'blob';

		xhr.addEventListener('readystatechange', (e: XMLHttpRequestEvent) => {
			if (xhr.readyState === 2) {
				var headerString = xhr.getAllResponseHeaders();
				var headers = {};

				headerString.split('\n').forEach((line) => {
					var split = line.indexOf(':');
					var key = line.substr(0, split).trim().toLowerCase();
					var value = line.substr(split + 1).trim();
					headers[key] = value;
				});

				dialog.updateImageInfo({ fileSize: parseInt(headers['content-length']) });
			}
		});

		xhr.addEventListener('progress', (e: XMLHttpRequestEvent) => {
			if (e.lengthComputable) {
				dialog.updateLoadProgress(e.loaded / e.total * 100);
			}
		});

		xhr.addEventListener('load', (e) => {
			// Pass the image off to the background for further processing
			port.postMessage({
				action: 'analyze-image',
				mimeType: xhr.responseType,
				filename: url.substr(url.lastIndexOf('/') + 1),
				url: URL.createObjectURL(xhr.response),
			});
		});

		xhr.addEventListener('error', (e) => {
			dialog.showLoadError(localize('error_load_failed', [e.error.toString()]));
		});

		xhr.open('get', url, true);
		xhr.send();
	}
}

module dialog {
	var localize = chrome.i18n.getMessage;

	interface HiddenEmbed {
		element: HTMLElement;
		visibility: string;
	}

	interface InfoSetup {
		name: string;
		value: (info: ImageInfo) => any;
	}

	enum Tabs {
		Main,
		Metadata
	}

	var CONTENT_ID = '__ext_classic_images_content__';
	var EXIF_TAB_ID = '__ext_classic_images_metadata__';
	var OVERLAY_ID = '__ext_classic_images_overlay__';
	var TABS_ID = '__ext_classic_images_tabs__';
	
	var ANALYZING_CLASS = '__ext_classic_images_analyzing__';
	var ERROR_CLASS = '__ext_classic_images_error__';
	var HIDDEN_TEXT_CLASS = '__ext_classic_images_hidden_text__';
	var PROGRESS_CLASS = '__ext_classic_images_progress__';
	var PULSE_CLASS = '__ext_classic_images_pulse__';
	var SELECTED_CLASS = '__ext_classic_images_selected_tab__';
	var TRANSPARENT_CLASS = '__ext_classic_images_transparent__';

	var ANIMATION_LENGTH = 200;
	var PROGRESS_BAR_DOTS = 6;

	var BUTTONS = [
		{ text: localize('close'), action: close },
	];

	var INFO: InfoSetup[] = [
		{ name: localize('prop_imagetype'), value: (info) => (info.mimeType) ? localize('val_imagetype', [info.type || localize('unknown'), info.mimeType]) : '' },
		{ name: localize('prop_dimensions'), value: (info) => (info.width && info.height) ? localize('val_dimensions', [info.width, info.height]) : '' },
		{ name: localize('prop_bitdepth'), value: (info) => info.bitDepth ? localize('val_bitdepth', [info.bitDepth]) : null },
		{ name: localize('prop_filesize'), value: (info) => info.fileSize ? localize('val_filesize', [filesize(info.fileSize, { round: 1 }), formatLargeNumber(info.fileSize)]) : '' },
		{
			name: localize('prop_animation'),
			value: (info) => {
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
		{ name: localize('prop_address'), value: (info) => info.url ? <any>elem('a', formatUrl(info.url), { href: info.url, target: '_blank' }) : '' }
	];

	var built = false;
	var closingTimeout: number = null;
	var hiddenEmbeds: HiddenEmbed[] = [];
	var inputIndex = 0;

	export var overlay: HTMLElement = null;
	export var content: HTMLElement = null;
	export var progress: HTMLElement = null;
	export var tabSelector: HTMLElement = null;
	export var tabs: HTMLElement[] = [];
	export var info: ImageInfo = {};

	export function close() {
		if (built && !closingTimeout) {
			dialog.overlay.classList.add(TRANSPARENT_CLASS);
			closingTimeout = window.setTimeout(() => {
				closingTimeout = null;
				destroyDialog();
			}, ANIMATION_LENGTH);
		}
	}

	export function show(info: ImageInfo) {
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

		window.setTimeout(() => {
			dialog.overlay.removeAttribute('style');
			dialog.overlay.classList.remove(TRANSPARENT_CLASS);
			dialog.progress.classList.remove(TRANSPARENT_CLASS);
		}, 10);
	}

	export function showLoadError(message: string) {
		var error = elem('p', message, { 'class': ERROR_CLASS });
		dialog.content.insertBefore(error, dialog.content.querySelector('footer'));
	}

	export function doneAnalyzing() {
		dialog.progress.classList.add(TRANSPARENT_CLASS);
	}

	export function updateImageInfo(info: ImageInfo) {
		// Add keys in new data to existing data
		for (var key in info) {
			if (info.hasOwnProperty(key)) {
				dialog.info[key] = info[key];
			}
		}

		// Clear everything
		dialog.tabs[Tabs.Main].innerHTML = '';
		dialog.tabs[Tabs.Metadata].innerHTML = '';

		// Rebuild general info
		INFO.forEach((setup) => {
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

				appendTo(dialog.tabs[Tabs.Main], dt, dd);
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
			keys.forEach((key) => {
				var data = dialog.info.metadata[key];
				var dt = elem('dt', key);
				var dd = elem('dd', formatExif(data));

				// Insert some hidden characters to format nicely for copying
				insertHiddenCharacters(dt, dd);

				appendTo(dialog.tabs[Tabs.Metadata], dt, dd);
			});

			showTabs(true);
		} else {
			showTabs(false);
		}
	}

	export function updateLoadProgress(percentComplete: number) {
		// TODO: might need to do something for large images.
		// Small ones load pretty much instantly.
	}

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
		dialog.content.addEventListener('click', (e) => {
			e.stopPropagation();
		}, false);

		// Dialog header
		var header = elem('header', localize('title_image_properties'));

		progress = elem('div', { 'class': PROGRESS_CLASS });
		for (var i = 0; i < PROGRESS_BAR_DOTS; i++) {
			progress.appendChild(elem('span'));
		}

		// Tab Header
		dialog.tabSelector = elem('div', { id: TABS_ID });
		dialog.tabSelector.hidden = true;

		var mainTabSelector = elem('a', localize('tab_general'));
		mainTabSelector.addEventListener('click', selectTab.bind(null, mainTabSelector, Tabs.Main), false);		

		var metaTabSelector = elem('a', localize('tab_metadata'));
		metaTabSelector.addEventListener('click', selectTab.bind(null, metaTabSelector, Tabs.Metadata), false);

		appendTo(dialog.tabSelector, mainTabSelector, metaTabSelector);

		// Tab content
		var maintab = elem('dl');
		var metatab = elem('dl', { id: EXIF_TAB_ID });
		metatab.hidden = true;

		dialog.tabs[Tabs.Main] = maintab;
		dialog.tabs[Tabs.Metadata] = metatab;

		// Buttons
		var footer = elem('footer');

		BUTTONS.forEach((info) => {
			var button = elem('button', info.text);
			button.addEventListener('click', info.action, false);
			footer.appendChild(button);
		});

		appendTo(content, header, dialog.progress, dialog.tabSelector, maintab, metatab, footer);

		dialog.overlay.appendChild(dialog.content);
		document.body.appendChild(dialog.overlay);

		selectTab(mainTabSelector, Tabs.Main);
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
			var elem = <HTMLElement>embeds[i];
			var info: HiddenEmbed = {
				element: elem,
				visibility: elem.style.visibility || 'visible',
			}
			elem.style.visibility = 'hidden';
			hiddenEmbeds.push(info);
		}
	}

	function pulse() {
		dialog.content.classList.add(PULSE_CLASS);
	}

	function restoreEmbeds() {
		hiddenEmbeds.forEach((embed) => {
			embed.element.style.visibility = embed.visibility;
		});
		hiddenEmbeds = [];
	}

	function selectTab(button: HTMLElement, tab: Tabs) {
		var buttons = dialog.tabSelector.childNodes;
		for (var i = 0; i < buttons.length; i++) {
			(<HTMLElement>buttons[i]).classList.remove(SELECTED_CLASS);
		}

		button.classList.add(SELECTED_CLASS);

		dialog.tabs[tab].hidden = false;
		dialog.tabs.forEach((element, i) => {
			if (i !== tab) {
				element.hidden = true;
			}
		});
	}

	function showTabs(show: boolean) {
		tabSelector.hidden = !show;
	}

	// HTML helper methods
	function elem(tag: string, text?: string, attribs?: { [key: string]: string; }): HTMLElement;
	function elem(tag: string, attribs?: { [key: string]: string; }): HTMLElement;
	function elem(tag: string, text?: any, attribs?: { [key: string]: string; }): HTMLElement {
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

	function appendTo(parent: HTMLElement, ...children: HTMLElement[]) {
		children.forEach((child) => parent.appendChild(child));
	}

	function formatUrl(url: string): string {
		var a = document.createElement('a');
		a.href = url;
		return a.host + a.pathname;
	}

	function formatNumber(n: number): string {
		var s = n.toFixed(1);
		return s.replace(/\.0$/, '');
	}

	function formatLargeNumber(n: number): string {
		var sep = localize('thousands_separator');
		return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
	}

	function formatExif(data: ExifTag): string {
		var parts = [];
		
		var addParts = (obj) => {
			if (Array.isArray(obj)) {
				parts = parts.concat(obj);
			} else {
				parts.push(obj);
			}
		}
		var filter = (part) => part !== null && part !== '' && part !== null && part !== undefined; 
		var toString = (part) => {
			try {
				return part.toString();
			} catch (e) {
				return '';
			}
		}

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

	function insertHiddenCharacters(dt: HTMLElement, dd: HTMLElement) {
		dt.appendChild(elem('span', ': ', { 'class': HIDDEN_TEXT_CLASS }));
		dd.appendChild(elem('br', { 'class': HIDDEN_TEXT_CLASS }));
	}
}

module styles {
	var injected = false;
	var element: HTMLLinkElement = null;

	export function inject() {
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

	export function remove() {
		if (injected) {
			document.head.removeChild(element);
			injected = false;
		}
	}
}

module plural {
	var localize = chrome.i18n.getMessage;
	export var RULES = [
		localize('plural_rule_zero'),
		localize('plural_rule_one'),
		localize('plural_rule_two'),
		localize('plural_rule_few'),
		localize('plural_rule_many'),
		localize('plural_rule_other'),
	].filter((rule) => rule !== '');

	export function get(message: string, n: string)
	export function get(message: string, n: number);
	export function get(message: string, n: any) {
		var forms = localize(message).split(';');

		if (typeof n === 'string') {
			n = parseFloat(n);
		}

		for (var i = 0; i <= RULES.length; i++) {
			if (pluralRuleParser(RULES[i], n)) {
				return forms[i];
			}
		}
		console.error('Failed to find plural for', message, n);
		return forms[0];
	}
}