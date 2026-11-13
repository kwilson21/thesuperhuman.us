import { isObject } from "../type-guards";

/** Canonical serialization for the version-1 object-only publication envelope. */
export function canonicalPublication(value: unknown): string {
	if (!isObject(value)) return JSON.stringify(value);
	const fields = new Map<string, unknown>(Object.entries(value));

	return (
		"{" +
		[...fields.keys()]
			.sort()
			.map(
				(key) =>
					JSON.stringify(key) + ":" + canonicalPublication(fields.get(key)),
			)
			.join(",") +
		"}"
	);
}
