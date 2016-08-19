interface SettingStorage {
	ctrlAction: string;
	ctrlAltAction: string;
	ctrlShiftAction: string;
	shiftAction: string;
	shiftAltAction: string;
	restrictedDomains: string[];
}

var settings = CreateSettings({
	ctrlAction: 'none',
	ctrlAltAction: 'saveas',
	ctrlShiftAction: 'none',
	shiftAction: 'none',
	shiftAltAction: 'none',
	restrictedDomains: [
		'[*.]pixiv.net',
	],
});