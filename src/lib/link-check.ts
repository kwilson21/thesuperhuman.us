import { isObject, isText } from "./type-guards";

/**
 * The one check for a link a person typed and the site stores or shows: an https address with a host and no
 * credentials, written with no space or control character. Gives the parsed address, which is what a page puts in an
 * `href`, or null. `http:`, `javascript:`, `data:`, `mailto:`, a protocol-relative `//host`, a relative path and any
 * address written with leading whitespace or a control character are all null.
 */
export function safeHttpsUrl<T>(value: T): string | null {
	if (!isText(value) || /[\u0000- \u007f-\u009f]/.test(value)) return null;

	try {
		const url = new URL(value);

		return url.protocol === "https:" &&
			url.hostname &&
			!url.username &&
			!url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}

// A URL parser drops tab, line feed and carriage return anywhere in an address, so `java<tab>script:` is `javascript:`.
const between = "[\\t\\n\\r]*";

const schemeWords = [
	"javascript",
	"vbscript",
	"data",
	"mailto",
	"file",
	"blob",
];

const schemeText = new RegExp(
	`(?<![a-z0-9+.-])(?:${schemeWords
		.map((word) => [...word].join(between))
		.join("|")})${between}:(?=\\S)`,
	"i",
);

/**
 * Whether message text holds one of these schemes written as an address (the name, a colon and then more text). A word
 * followed by a colon and a space, such as "Data: the export finished", is prose and is not caught.
 */
export function nonHttpsLinkText(body: string): boolean {
	return schemeText.test(body);
}

/**
 * The labelled references of a software update that a client may be shown, from its stored JSON: each one with a label
 * and an address that passes `safeHttpsUrl`, as that parsed address. Stored JSON that does not read gives none.
 */
export function safeReferences(
	json: string | null | undefined,
): { label: string; href: string }[] {
	let list: unknown;

	try {
		list = JSON.parse(json ?? "[]");
	} catch {
		return [];
	}

	if (!Array.isArray(list)) return [];

	return list.flatMap((item) => {
		if (!isObject(item)) return [];

		const label = "label" in item ? item.label : undefined,
			href = safeHttpsUrl("url" in item ? item.url : undefined);

		return isText(label) && label.trim() && href ? [{ label, href }] : [];
	});
}
