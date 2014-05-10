interface ExifTag {
	description: any;
	value: any;
}

declare class ExifReader {
	constructor();
	load(data: ArrayBuffer): void;
	getTagValue(name: string): string;
	getTagDescription(name: string): string;
	getAllTags(): { [key: string]: ExifTag; };
}