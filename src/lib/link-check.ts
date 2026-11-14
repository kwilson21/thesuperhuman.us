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

const spelled = (word: string) => [...word].join(between);

const script = `(?:${spelled("javascript")}|${spelled("vbscript")})${between}:(?=\\S)`;

// A media type, or the ;base64, marker, after `data:`: the shape of a data address, not of a sentence.
const dataAddress = `${spelled("data")}${between}:(?:[a-z][a-z0-9.+-]*\\/[a-z0-9.+-]+|[^,\\s]*;base64,)`;

const executable = new RegExp(
	`(?<![a-z0-9+.-])(?:${script}|${dataAddress})`,
	"i",
);

// The same pattern the message renderer links (src/components/ProjectMessages.astro).
const httpsSpan = /https:\/\/[^\s<>"']+/gi;

/**
 * Whether message text holds an address that would run code or carry data: `javascript:` or `vbscript:` followed by text,
 * or `data:` followed by a media type or `;base64,`, in any case and split by tab or line breaks. A valid https address
 * is set aside first, so `https://example.com/file:notes` is fine, and `mailto:`, `file:` and a word with a colon
 * ("Data: the export finished") are ordinary text: the renderer links only checked https addresses, so this refusal is
 * a second line of defence and must not block normal writing.
 */
export function nonHttpsLinkText(body: string): boolean {
	return executable.test(body.replace(httpsSpan, " "));
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
