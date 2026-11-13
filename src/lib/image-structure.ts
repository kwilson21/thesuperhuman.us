// Whether bytes are a complete image of a declared type, read in pure TypeScript with no decoder: the structure is
// walked to its end, so a signature followed by anything else, a truncated file or bytes after the end are all refused.
// This does not decode pixels; it proves the container is whole and holds nothing after the image.

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;

	for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;

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
		data = false;

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

			if (view.getUint32(position + 8) === 0 || view.getUint32(position + 12) === 0)
				return false;
			first = false;
		} else if (type === "IHDR") return false;

		if (type === "IDAT") data = true;

		if (type === "IEND") return length === 0 && data && end === b.length;
		position = end;
	}

	return false;
}

function completeJpeg(b: Uint8Array) {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
	let position = 2,
		frame = false,
		scan = false;

	while (position < b.length) {
		if (b[position] !== 0xff) return false;

		while (b[position] === 0xff && position + 1 < b.length) position++;
		const marker = b[position++];

		if (marker === 0xd9) return frame && scan && position === b.length;

		// Markers with no length: TEM, the restart markers and a second start.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			if (marker === 0xd8) return false;
			continue;
		}

		if (marker === 0x00 || position + 2 > b.length) return false;
		const length = (b[position] << 8) | b[position + 1];

		if (length < 2 || position + length > b.length) return false;

		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		)
			frame = true;
		position += length;

		if (marker === 0xda) {
			if (!frame) return false;
			scan = true;

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
		}
	}

	return false;
}

function completeWebp(b: Uint8Array) {
	if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
		return false;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

	if (view.getUint32(4, true) + 8 !== b.length) return false;
	let position = 12,
		first = true,
		image = false;

	while (position < b.length) {
		if (position + 8 > b.length) return false;
		const type = ascii(b, position, 4),
			length = view.getUint32(position + 4, true),
			end = position + 8 + length + (length & 1);

		if (end > b.length) return false;

		if (first) {
			if (!["VP8 ", "VP8L", "VP8X"].includes(type)) return false;

			if (type === "VP8X" && length < 10) return false;
			first = false;
		}

		const body = position + 8;

		if (type === "VP8 ") {
			image = true;

			if (length < 10 || b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a)
				return false;
		}

		if (type === "VP8L") {
			image = true;

			if (length < 5 || b[body] !== 0x2f) return false;
		}

		if (type === "ANMF") image = true;
		position = end;
	}

	return image;
}

/** Whether `bytes` is a complete image of `type` ("image/png", "image/jpeg" or "image/webp"), and nothing else. */
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
