/// <reference path="interfaces.ts" />
/// <reference path="lib/png.d.ts" />
/// <reference path="lib/libgif.d.ts" />
/// <reference path="lib/ExifReader.d.ts" />
var MIME_TYPES = {
    'BMP': ['image/bmp', 'image/x-windows-bmp'],
    'GIF': ['image/gif'],
    'JPEG': ['image/jpeg', 'image/pjpeg'],
    'ICO': ['image/x-icon'],
    'PGM': ['image/x-portable-graymap'],
    'PNG': ['image/png'],
    'SVG': ['image/svg+xml', 'image/svg-xml'],
    'TIFF': ['image/tiff', 'image/x-tiff'],
    'WebP': ['image/webp'],
    'XBM': ['image/x-xbitmap']
};

onmessage = function (event) {
    var message = event.data;

    var xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.addEventListener('load', function (e) {
        // Parse the image and pass back any new info we get
        parseImage(xhr.response, function (err, info) {
            if (err) {
                throw new Error(err);
            } else if (info === null) {
                endAnalysis();
            } else {
                sendInfo(info);
            }
        });
    });

    xhr.addEventListener('error', function (e) {
        throw new Error(xhr.status + ' ' + xhr.statusText);
    });

    xhr.addEventListener('loadend', function (e) {
        // Clean up the blob URL
        URL.revokeObjectURL(message.url);
    });
    xhr.open('get', message.url, true);
    xhr.send();
};

function getGenericImageData(type, data) {
    return {
        mimeType: type,
        type: getImageType(type),
        fileSize: data.byteLength
    };
}

function getImageType(mimeType) {
    for (var key in MIME_TYPES) {
        if (MIME_TYPES.hasOwnProperty(key)) {
            if (MIME_TYPES[key].indexOf(mimeType.toLowerCase()) >= 0) {
                return key;
            }
        }
    }
    return null;
}

function parseImage(blob, callback) {
    var fr = new FileReader();
    fr.addEventListener('load', function (e) {
        var info = getGenericImageData(blob.type, fr.result);

        // Send the info we've collected up to now
        callback(null, info);

        try  {
            switch (info.type) {
                case 'GIF':
                    GifParser.parse(fr.result, info, callback);
                    break;

                case 'JPEG':
                    JpegParser.parse(fr.result, info, callback);
                    break;

                case 'PNG':
                    PngParser.parse(fr.result, info, callback);
                    break;

                default:
                    // No further analysis to do. Send back a 'null' to indicate we're done.
                    callback(null, null);
                    break;
            }
        } catch (e) {
            callback(e.toString(), null);
        }
    });

    fr.addEventListener('error', function (e) {
        callback(fr.error.toString(), null);
    });

    fr.readAsArrayBuffer(blob);
}

function endAnalysis() {
    postMessage({
        action: 'done'
    });
    close();
}

function sendInfo(info) {
    postMessage({
        action: 'info',
        data: info
    });
}

var GifParser;
(function (GifParser) {
    /** Implementation of libgif's stream class for ArrayBuffer data*/
    var BlobStream = (function () {
        function BlobStream(buffer) {
            this.data = new Uint8Array(buffer);
            this.pos = 0;
        }
        BlobStream.prototype.read = function (length) {
            var s = '';
            for (var i = 0; i < length; i++) {
                s += String.fromCharCode(this.readByte());
            }
            return s;
        };

        BlobStream.prototype.readByte = function () {
            if (this.pos >= this.data.length) {
                throw new Error('Attempted to read past end of stream.');
            }
            return this.data[this.pos++] & 0xFF;
        };

        BlobStream.prototype.readBytes = function (length) {
            var bytes = [];
            for (var i = 0; i < length; i++) {
                bytes.push(this.readByte());
            }
            return bytes;
        };

        BlobStream.prototype.readUnsigned = function () {
            var a = this.readBytes(2);
            return (a[1] << 8) + a[0];
        };

        BlobStream.prototype.skip = function (length) {
            this.pos += length;
        };
        return BlobStream;
    })();

    var Handler = (function () {
        function Handler(info, callback) {
            this.callback = callback;
            this.animated = false;
            this.info = info;

            this.info.frames = 0;
            this.info.framerate = 0;
            this.info.duration = 0;
        }
        Handler.prototype.gce = function (block) {
            this.info.frames += 1;
            this.info.duration += block.delayTime / 100;
        };

        Handler.prototype.eof = function (block) {
            if (this.info.duration > 0) {
                this.info.framerate = this.info.frames / this.info.duration;
            } else {
                delete this.info.framerate;
                delete this.info.duration;
            }

            this.callback(null, this.info);
            this.callback(null, null);
        };
        return Handler;
    })();

    function parse(buffer, info, callback) {
        importScripts('lib/libgif.js');
        var stream = new BlobStream(buffer);
        var handler = new Handler(info, callback);
        parseGIF(stream, handler);
    }
    GifParser.parse = parse;
})(GifParser || (GifParser = {}));

var JpegParser;
(function (JpegParser) {
    function parse(buffer, info, callback) {
        importScripts('lib/ExifReader.js');
        try  {
            var exif = new ExifReader();
            exif.load(buffer);

            var metadata = exif.getAllTags();

            for (var key in metadata) {
                if (metadata.hasOwnProperty(key)) {
                    info.metadata = metadata;
                    break;
                }
            }

            callback(null, info);
            callback(null, null);
        } catch (e) {
            if (e instanceof Error && e.message === 'No Exif data') {
                // Image doesn't have exif data. Ignore.
                callback(null, null);
            } else {
                throw e;
            }
        }
    }
    JpegParser.parse = parse;
})(JpegParser || (JpegParser = {}));

var PngParser;
(function (PngParser) {
    function parse(buffer, info, callback) {
        importScripts('lib/zlib.js');
        importScripts('lib/png.js');

        var info = {};
        var data = new Uint8Array(buffer);
        var png = new PNG(data);

        info.bitDepth = png.pixelBitlength;

        if (png.animation) {
            info.frames = png.animation.numFrames;

            var duration = 0;
            png.animation.frames.forEach(function (frame) {
                duration += frame.delay;
            });

            info.duration = duration / 1000;
            info.framerate = info.frames / info.duration;
        }

        for (var key in png.text) {
            if (png.text.hasOwnProperty(key)) {
                info.metadata = info.metadata || {};
                info.metadata[key] = {
                    description: png.text[key],
                    value: null
                };
            }
        }

        callback(null, info);
        callback(null, null);
    }
    PngParser.parse = parse;
})(PngParser || (PngParser = {}));
