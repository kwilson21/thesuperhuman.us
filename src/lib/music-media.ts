/** The bytes a Range header names in a file of `size` bytes: none when there is no header, "invalid" when it cannot be served. Shared by the music, link preview and studio file routes. */
export function mediaRange(
	header: string | null,
	size: number,
): { offset: number; length: number } | null | "invalid" {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header);

	if (!m || (!m[1] && !m[2]) || size < 1) return "invalid";
	const suffix = !m[1];
	const start = suffix ? Math.max(0, size - Number(m[2])) : Number(m[1]);
	const end = suffix || !m[2] ? size - 1 : Math.min(size - 1, Number(m[2]));

	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start > end ||
		start >= size
	)
		return "invalid";

	return { offset: start, length: end - start + 1 };
}
