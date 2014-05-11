interface PNGAnimation {
	numFrames: number;
	numPlays: number;
	frames: PNGFrame[];
}

interface PNGFrame {
	width: number;
	height: number;
	xOffset: number;
	yOffset: number;
	delay: number;
	disposeOp: number;
	blendOp: number;
	data: Uint8Array;
}

declare class PNG {

	public palette: number[];
	public imgData: Uint8Array;
	public transparency: {
		indexed?: number[];
		grayscale?: number[];
		rgb?: number[];
	}
	public animation: PNGAnimation;
	public text: { [key: string]: string; };
	public hasAlphaChannel: boolean;
	public colors: number;
	public pixelBitlength: number;
	public colorSpace: string;

	static load(url: string, callback: (png: PNG) => void);
	static load(url: string, canvas: HTMLCanvasElement, callback: (png: PNG) => void);

	constructor(data: number[]);
	constructor(data: Uint8Array);

	public decode(): Uint8Array;
	public render(canvas: HTMLCanvasElement): void;
}