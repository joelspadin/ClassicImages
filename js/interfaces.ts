interface ImageInfo {
	element?: HTMLImageElement;
	url?: string;
	type?: string;
	mimeType?: string;
	fileSize?: number;
	width?: number;
	height?: number;
	bitDepth?: number;
	frames?: number;
	framerate?: number;
	duration?: number;

	metadata?: { [key: string]: { description: any; value: any; }; };
}

interface InfoCallback {
	(err: string, info: ImageInfo): void;
}

interface IMessage {
	action: string;
}

interface IAnalyzeMessage extends IMessage {
	filename: string;
	mimeType: string;
	url: string;
}

interface IDialogMessage extends IMessage {
	data?: ImageInfo;
	url?: string;
	error?: string;
}

interface ISaveMessage extends IMessage {
	filename?: string;
	force?: boolean;
	saveAs: boolean;
	url: string;
}

interface IWorkerResponse {
	action: string;
	data?: ImageInfo;
}