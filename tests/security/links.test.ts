import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	nonHttpsLinkText,
	safeHttpsUrl,
	safeReferences,
} from "~/lib/link-check";
import { validateProjectMessage } from "~/lib/audio-project-messages";
import { safeExternalUrl } from "~/lib/owner-model";

// A stored or rendered link is https only, with no credentials. Every other scheme, including one written with mixed
// case, leading whitespace or control characters, and a protocol-relative address, is refused.

const refused = [
	"javascript:alert(1)",
	"JaVaScRiPt:alert(1)",
	" javascript:alert(1)",
	"\tjavascript:alert(1)",
	"java\tscript:alert(1)",
	"java\nscript:alert(1)",
	"\u0001javascript:alert(1)",
	"data:text/html,<b>x</b>",
	"DATA:text/html,x",
	"mailto:someone@example.com",
	"vbscript:x",
	"file:///etc/passwd",
	"blob:https://example.com/id",
	"//example.com/path",
	"/relative/path",
	"example.com",
	"http://example.com",
	"ftp://example.com",
	"https://user:secret@example.com",
	"https://user@example.com",
	" https://example.com",
	"https://example.com ",
	"https://example.com\n",
	"https://exa mple.com",
	"https://exa\tmple.com",
	"https://",
	"",
	"   ",
];

describe("safeHttpsUrl", () => {
	it.each(refused)("refuses %j", (value) => {
		expect(safeHttpsUrl(value)).toBeNull();
	});

	it("refuses a value that is not text", () => {
		expect(safeHttpsUrl(undefined)).toBeNull();
		expect(safeHttpsUrl(null)).toBeNull();
		expect(safeHttpsUrl(5)).toBeNull();
		expect(safeHttpsUrl({ href: "https://example.com" })).toBeNull();
	});

	it("gives the parsed address of an https link", () => {
		expect(safeHttpsUrl("https://Example.com/a?b=1#c")).toBe(
			"https://example.com/a?b=1#c",
		);
		expect(safeHttpsUrl("HTTPS://example.com")).toBe("https://example.com/");
	});

	it("is the check the owner pages use", () => {
		for (const value of refused) expect(safeExternalUrl(value)).toBeNull();
		expect(safeExternalUrl("https://example.com/x")).toBe(
			"https://example.com/x",
		);
	});
});

describe("message text", () => {
	it.each([
		"javascript:alert(1)",
		"see JAVASCRIPT:alert(1) now",
		"java\tscript:alert(1)",
		"java\nscript:alert(1)",
		"vbscript:msgbox(1)",
		"data:text/html,hi",
		"open data:text/html;base64,AAAA please",
		"mailto:someone@example.com",
		"file:///etc/passwd",
		"blob:https://example.com/id",
		"http://example.com/files",
		"ftp://example.com/files",
		"www.example.com/files",
		"https://user:secret@example.com/files",
	])("refuses %j", (body) => {
		expect(validateProjectMessage(body)).toBeNull();
		expect(nonHttpsLinkText(body) || /:\/\/|www\./.test(body)).toBe(true);
	});

	it.each([
		"Note: the files are ready",
		"Meet at 10:30 on Friday",
		"Languages: JavaScript: yes, TypeScript: yes",
		"Data: the export finished",
		"Here is the folder: https://example.com/files.",
		"Use mailto in the footer, not a form",
	])("accepts %j", (body) => {
		expect(validateProjectMessage(body)).toBe(body);
	});
});

describe("references shown to a client", () => {
	it("keeps only labelled https links without credentials, as parsed addresses", () => {
		const references = safeReferences(
			JSON.stringify([
				{ label: "Repo", url: "https://example.com/repo" },
				{ label: "Bad", url: "javascript:alert(1)" },
				{ label: "Tab", url: "java\tscript:alert(1)" },
				{ label: "Data", url: "data:text/html,x" },
				{ label: "Mail", url: "mailto:a@example.com" },
				{ label: "Relative", url: "//example.com" },
				{ label: "Space", url: " https://example.com" },
				{ label: "Creds", url: "https://u:p@example.com" },
				{ label: "", url: "https://example.com/unlabelled" },
				{ label: "   ", url: "https://example.com/blank" },
			]),
		);

		expect(references).toEqual([
			{ label: "Repo", href: "https://example.com/repo" },
		]);
	});

	it("survives stored JSON that is missing, broken or not a list", () => {
		expect(safeReferences(undefined)).toEqual([]);
		expect(safeReferences(null)).toEqual([]);
		expect(safeReferences("{broken")).toEqual([]);
		expect(safeReferences('{"label":"x"}')).toEqual([]);
		expect(safeReferences('[null,5,{"label":1,"url":2}]')).toEqual([]);
	});
});

describe("renderers", () => {
	const source = (path: string) =>
		readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

	it.each([
		"src/components/SoftwareProjectUpdate.astro",
		"src/pages/studio/software/[id].astro",
	])("%s builds no href from a stored link or preview address", (path) => {
		const text = source(path);

		expect(text).not.toMatch(/href=\{(link|reference)\.url\}/);
		expect(text).not.toMatch(/href=\{update\.preview_url/);
		expect(text).not.toMatch(/new URL\((link|reference)\.url\)/);
	});
});
