interface FilesizeOptions {
	bits?: boolean;
	unix?: boolean;
	base?: number;
	round?: number;
	spacer?: string;
}

declare function filesize(arg: string, descriptor?: FilesizeOptions): string;
declare function filesize(arg: number, descriptor?: FilesizeOptions): string;