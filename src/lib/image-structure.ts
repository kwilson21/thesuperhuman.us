// Whether bytes are a complete image of a declared type, read in pure TypeScript with no decoder: the container is
// walked to its end and its required headers are checked, so a signature followed by anything else, a truncated file, an
// image with no data or no size, and (for PNG and WebP) bytes after the end are all refused.
//
// This is not a decoder. It proves the container is whole and that its headers describe an image with some data; it does
// not validate the compressed bitstream, so a corrupt but well-formed image is accepted and shows as a broken picture.
// The uploader is the owner, so that is not a security problem.
//
// Trailing data differs by type. PNG ends at IEND and WebP at its RIFF size: nothing may follow. A JPEG may carry more
// bytes after its first end marker, because genuine phone photos do (an Ultra HDR gain map, a multi-picture MPF image, a
// motion photo video); the first image is still checked to its end marker.

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;

	for (let bit = 0; bit < 8; bit++)
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;

	return c >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number) {
	let crc = 0xffffffff;

	for (let i = start; i < end; i++)
		crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);

	return (crc ^ 0xffffffff) >>> 0;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
	String.fromCharCode(...bytes.subarray(start, start + length));

function completePng(b: Uint8Array) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];

	if (b.length < 8 || !signature.every((value, i) => b[i] === value))
		return false;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

	let position = 8,
		first = true,
		data = 0;

	while (position + 12 <= b.length) {
		const length = view.getUint32(position),
			type = ascii(b, position + 4, 4),
			end = position + 12 + length;

		if (length > 0x7fffffff || end > b.length || !/^[A-Za-z]{4}$/.test(type))
			return false;

		if (view.getUint32(end - 4) !== crc32(b, position + 4, end - 4))
			return false;

		if (first) {
			if (type !== "IHDR" || length !== 13) return false;

			if (
				view.getUint32(position + 8) === 0 ||
				view.getUint32(position + 12) === 0
			)
				return false;
			first = false;
		} else if (type === "IHDR") return false;

		if (type === "IDAT") data += length;

		if (type === "IEND") return length === 0 && data > 0 && end === b.length;
		position = end;
	}

	return false;
}

const isFrame = (marker: number) =>
	marker >= 0xc0 &&
	marker <= 0xcf &&
	marker !== 0xc4 &&
	marker !== 0xc8 &&
	marker !== 0xcc;

function completeJpeg(b: Uint8Array) {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;

	let position = 2,
		frame = false,
		scans = 0;

	while (position < b.length) {
		if (b[position] !== 0xff) return false;

		while (b[position] === 0xff && position + 1 < b.length) position++;
		const marker = b[position++];

		// The first end marker ends the image; whatever follows is not checked.
		if (marker === 0xd9) return frame && scans > 0;

		// Markers with no length: TEM, the restart markers and a second start.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			if (marker === 0xd8) return false;
			continue;
		}

		if (marker === 0x00 || position + 2 > b.length) return false;
		const length = (b[position] << 8) | b[position + 1];

		if (length < 2 || position + length > b.length) return false;

		if (isFrame(marker)) {
			// precision, height, width, component count, then three bytes for each component.
			const components = b[position + 7];

			if (
				frame ||
				length < 8 ||
				components < 1 ||
				length !== 8 + 3 * components ||
				((b[position + 3] << 8) | b[position + 4]) === 0 ||
				((b[position + 5] << 8) | b[position + 6]) === 0
			)
				return false;
			frame = true;
		}

		if (marker === 0xda) {
			// The component count, then two bytes for each, then three more.
			const components = b[position + 2];

			if (
				!frame ||
				components < 1 ||
				components > 4 ||
				length !== 6 + 2 * components
			)
				return false;
		}

		position += length;

		if (marker === 0xda) {
			const start = position;

			// The entropy-coded data runs to the next marker that is not a stuffed zero or a restart.
			while (position < b.length) {
				if (b[position] === 0xff) {
					const next = b[position + 1];

					if (next === undefined) return false;

					if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7))
						break;
				}

				position++;
			}

			if (position === start) return false;
			scans++;
		}
	}

	return false;
}

/** A VP8 or VP8L image chunk: its header parses to a size and it holds more than its header. */
function webpImage(b: Uint8Array, type: string, body: number, length: number) {
	if (type === "VP8 ") {
		return (
			length > 10 &&
			b[body + 3] === 0x9d &&
			b[body + 4] === 0x01 &&
			b[body + 5] === 0x2a &&
			(((b[body + 7] << 8) | b[body + 6]) & 0x3fff) > 0 &&
			(((b[body + 9] << 8) | b[body + 8]) & 0x3fff) > 0
		);
	}

	// VP8L: a signature byte and 14 bits each of width and height (stored less one), then the pixel data.
	return type === "VP8L" && length > 5 && b[body] === 0x2f;
}

/** The chunks of `b` from `start` to `end`, each as its type and where its data is, or null when they do not fit. */
function webpChunks(b: Uint8Array, start: number, end: number) {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
		chunks: { type: string; body: number; length: number }[] = [];

	let position = start;

	while (position < end) {
		if (position + 8 > end) return null;

		const length = view.getUint32(position + 4, true),
			next = position + 8 + length + (length & 1);

		if (next > end) return null;
		chunks.push({ type: ascii(b, position, 4), body: position + 8, length });
		position = next;
	}

	return chunks;
}

function completeWebp(b: Uint8Array) {
	if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
		return false;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

	if (view.getUint32(4, true) + 8 !== b.length) return false;
	const chunks = webpChunks(b, 12, b.length);

	if (!chunks?.length) return false;
	const [first] = chunks;

	if (!["VP8 ", "VP8L", "VP8X"].includes(first.type)) return false;

	if (first.type === "VP8X" && first.length < 10) return false;

	return chunks.some((chunk) => {
		if (webpImage(b, chunk.type, chunk.body, chunk.length)) return true;

		// An animation frame: 16 bytes of position, size and timing, then its own image chunks.
		if (chunk.type !== "ANMF" || chunk.length <= 16) return false;
		const inner = webpChunks(b, chunk.body + 16, chunk.body + chunk.length);

		return Boolean(
			inner?.some((frame) =>
				webpImage(b, frame.type, frame.body, frame.length),
			),
		);
	});
}

/** Whether `bytes` is a complete image of `type` ("image/png", "image/jpeg" or "image/webp"). */
export function isCompleteImage(bytes: Uint8Array, type: string) {
	switch (type) {
		case "image/png":
			return completePng(bytes);
		case "image/jpeg":
			return completeJpeg(bytes);
		case "image/webp":
			return completeWebp(bytes);
		default:
			return false;
	}
}

/**
 * The Orientation of the EXIF block held in `b` from `start` to `end` (the block's own bytes, with or without its
 * "Exif\0\0" prefix): the value 1 to 8, undefined when the block is readable and has no Orientation tag, and null when
 * the block cannot be read with certainty. Nothing outside `start` to `end` is read: an IFD offset or entry that falls
 * outside it makes the block unreadable. The Orientation entry must be one SHORT with a value from 1 to 8.
 */
function exifOrientation(b: Uint8Array, start: number, end: number) {
	if (start < 0 || start > end || end > b.length) return null;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

	if (
		end - start >= 6 &&
		ascii(b, start, 4) === "Exif" &&
		b[start + 4] === 0 &&
		b[start + 5] === 0
	)
		start += 6;

	if (end - start < 8) return null;
	const order = ascii(b, start, 2);

	if (order !== "II" && order !== "MM") return null;
	const little = order === "II";

	if (view.getUint16(start + 2, little) !== 42) return null;
	const offset = view.getUint32(start + 4, little);

	if (offset < 8 || offset > end - start - 2) return null;
	const ifd = start + offset,
		count = view.getUint16(ifd, little);

	if (ifd + 2 + count * 12 > end) return null;
	let found: number | undefined;

	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12;

		if (view.getUint16(entry, little) !== 0x0112) continue;
		const value = view.getUint16(entry + 8, little);

		if (
			found !== undefined ||
			view.getUint16(entry + 2, little) !== 3 ||
			view.getUint32(entry + 4, little) !== 1 ||
			value < 1 ||
			value > 8
		)
			return null;
		found = value;
	}

	return found;
}

type ImageSize = { width: number; height: number };

const sized = (width: number, height: number): ImageSize | null =>
	width > 0 && height > 0 ? { width, height } : null;

function pngSize(b: Uint8Array) {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
		signature = [137, 80, 78, 71, 13, 10, 26, 10];

	if (b.length < 33 || !signature.every((value, i) => b[i] === value))
		return null;

	if (ascii(b, 12, 4) !== "IHDR" || view.getUint32(8) !== 13) return null;
	let position = 8;

	while (position + 12 <= b.length) {
		const length = view.getUint32(position),
			type = ascii(b, position + 4, 4);

		// The browser turns the image by its Orientation; the size shown is not guessed here.
		if (type === "eXIf") {
			const orientation = exifOrientation(
				b,
				position + 8,
				position + 8 + length,
			);

			if (
				orientation === null ||
				(orientation !== undefined && orientation !== 1)
			)
				return null;
		}

		if (type === "IEND") break;
		position += 12 + length;
	}

	return sized(view.getUint32(16), view.getUint32(20));
}

function jpegSize(b: Uint8Array) {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;

	let position = 2,
		frame: ImageSize | null = null,
		orientation: number | undefined,
		exifSeen = false;

	while (position < b.length) {
		if (b[position] !== 0xff) return null;

		while (b[position] === 0xff && position + 1 < b.length) position++;
		const marker = b[position++];

		if (marker === 0xd9 || marker === 0xda) break;

		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;

		if (marker === 0x00 || position + 2 > b.length) return null;
		const length = (b[position] << 8) | b[position + 1];

		if (length < 2 || position + length > b.length) return null;

		if (isFrame(marker) && !frame) {
			if (length < 8) return null;
			frame = sized(
				(b[position + 5] << 8) | b[position + 6],
				(b[position + 3] << 8) | b[position + 4],
			);

			if (!frame) return null;
		}

		if (
			marker === 0xe1 &&
			length >= 8 &&
			ascii(b, position + 2, 4) === "Exif" &&
			b[position + 6] === 0 &&
			b[position + 7] === 0
		) {
			// Only one Exif block is expected; with a second, which one the browser reads is not certain.
			if (exifSeen) return null;
			exifSeen = true;
			const read = exifOrientation(b, position + 2, position + length);

			if (read === null) return null;
			orientation = read;
		}

		position += length;
	}

	if (!frame) return null;

	// Orientations 5 to 8 turn the picture a quarter turn, so the browser shows it with width and height exchanged.
	return orientation !== undefined && orientation >= 5 && orientation <= 8
		? { width: frame.height, height: frame.width }
		: frame;
}

function webpSize(b: Uint8Array) {
	if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
		return null;
	const chunks = webpChunks(b, 12, b.length);

	if (!chunks?.length) return null;

	for (const chunk of chunks) {
		if (chunk.type !== "EXIF") continue;
		const orientation = exifOrientation(
			b,
			chunk.body,
			chunk.body + chunk.length,
		);

		if (
			orientation === null ||
			(orientation !== undefined && orientation !== 1)
		)
			return null;
	}

	const [first] = chunks,
		body = first.body;

	if (first.type === "VP8X") {
		if (first.length < 10) return null;
		const le24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

		return sized(le24(body + 4) + 1, le24(body + 7) + 1);
	}

	if (first.type === "VP8 ") {
		if (
			first.length < 10 ||
			b[body + 3] !== 0x9d ||
			b[body + 4] !== 0x01 ||
			b[body + 5] !== 0x2a
		)
			return null;

		return sized(
			((b[body + 7] << 8) | b[body + 6]) & 0x3fff,
			((b[body + 9] << 8) | b[body + 8]) & 0x3fff,
		);
	}

	if (first.type === "VP8L") {
		if (first.length < 5 || b[body] !== 0x2f) return null;

		const bits =
			b[body + 1] |
			(b[body + 2] << 8) |
			(b[body + 3] << 16) |
			(b[body + 4] << 24);

		return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}

	return null;
}

/**
 * The pixel size a browser shows for `bytes`, a complete image of `type`, or null when it is not certain: an unreadable
 * header, a zero size, an EXIF block that cannot be read with certainty (it is read only inside its own segment or
 * chunk, and a second Exif segment in a JPEG counts as unreadable), or (for PNG and WebP) an Orientation other than 1,
 * which turns the picture by an amount decided in the browser. A JPEG with Orientation 5 to 8 is returned with width and
 * height exchanged. A wrong size is a defect, null is not. It never throws.
 */
export function imageSize(bytes: Uint8Array, type: string): ImageSize | null {
	try {
		switch (type) {
			case "image/png":
				return pngSize(bytes);
			case "image/jpeg":
				return jpegSize(bytes);
			case "image/webp":
				return webpSize(bytes);
			default:
				return null;
		}
	} catch {
		return null;
	}
}
