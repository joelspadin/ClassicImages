interface SettingEventDetail {
	key: string;
	oldValue: any;
	newValue: any;
}

document.addEventListener('setting', (e: CustomEvent) => {
	var detail = (<SettingEventDetail>e.detail);

	if (detail.key.toLowerCase().match(/(alt|ctrl|shift)+action/)) {
		chrome.runtime.getBackgroundPage((bg?) => {
			(<any>bg).ImageSave.rebuildActions();
		});
	}
});

window.addEventListener('DOMContentLoaded', () => {
	if (typeof chrome.downloads === 'undefined') {
		document.getElementById('no-downloads-api').removeAttribute('hidden');
	}

	// Remove this once Opera figures out how to make chrome.runtime.onInstalled work.
	if (!settings.get(settings.initSetting)) {
		settings.init();
		chrome.runtime.getBackgroundPage((bg?) => {
			(<any>bg).ImageSave.rebuildActions();
			location.reload();
		});
	}
});

// Transform functions
function linesToArray(lines: string) {
	if (lines) {
		var array = lines.split('\n').map((val) => val.trim());
		array = array.filter((line) => line !== '');
		return array.sort();
	} else {
		return [];
	}
}

function arrayToLines(array: string[]) {
	if (array) {
		return array.join('\n');
	} else {
		return '';
	}
}