interface GifStream {
	read(length: number): string;
	readByte(): number;
	readBytes(length: number): number[];
	readUnsigned(): number;
}

interface GifParseHandler {
	app?: { [key: string]: (block: GifAppBlock) => void; };
	com?: (block: GifCommentBlock) => void;
	eof?: (block) => void;
	gce?: (block: GifGceBlock) => void;
	
	hdr?: (header: GifHeader) => void;
	img?: (block) => void;
	pte?: (block) => void;
	unknown?: (block) => void;
}

interface GifHeader {
	sig: string;
	ver: string;
	width: number;
	height: number;
	colorRes: number;
	gctFlag: boolean;
	gctSize: number;
	gct?: number[];
	sorted: number;
}

interface GifAppBlock {
	unknown?: number;
	iterations?: number;
	appData?: string;
}

interface GifCommentBlock {
	comment: string;
}

interface GifGceBlock {
	disposalMethod: number;
	userInput: number;
	transparencyGiven: boolean;
	transparencyIndex: number;
	delayTime: number;
}

interface GifImageBlock {
	leftPos: number;
	topPos: number;
	width: number;
	height: number;
	lctFlag: boolean;
	interlaced: boolean;
	sorted: boolean;
	lctSize: number;
	lzwMinCodeSize: number;
	pixels: number[];
}

declare function parseGIF(stream: GifStream, handler: GifParseHandler): void;