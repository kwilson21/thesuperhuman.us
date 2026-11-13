import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/agreements";
import {
	asClientCookie,
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import { act, form, MSA, SOW, templateRow } from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "template-version": the owner reads one stored template version with
// its label and a comparison with the version before it. Stored text is returned as it was stored (not validated again).
//
// Every response branch of the handler, templateVersion, compareWithPrevious and templateVersionLabel
// (src/lib/agreement-templates.ts, src/lib/agreement-version-label.ts), and its cases:
//
//   200 {ok:true, version, label, text, compare}   version 1 (compare null), a later version (rows against the one before), a version
//                       whose predecessor is missing (compare null), an SOW, a label, no label (v<date>), an empty label, odd dates, stored
//                       text with markup, ampersands, quotes, unicode, CRLF, 100 KiB, a diff above the table cap, identical texts, stored
//                       text that today's rules would refuse
//   404 {error:"That version was not found."}   an unknown version, the other kind's version, a very large version
//   400 "Check required fields and limits."     kind missing, unknown, in capitals; version missing, zero, negative, a fraction, text that is
//                       not a number, an empty string, null; accepted by coercion: "2", "2.0", " 2 ", [2], true, "0x10"
//   409 {error: message}    the first or the comparison read fails
//   native form         a version with text becomes an HTML page (the stored text escaped); a version with empty text stays JSON; errors become
//                       pages; a visitor
//   403                 a visitor, a studio client cookie

const dump = { music: ["software_agreement_templates"] };

const show = (
	over: { [key: string]: JsonValue | undefined } = {},
	extra: Partial<Step> = {},
) =>
	act(
		{ action: "template-version", kind: "msa", version: 1, ...over },
		{ dump, ...extra },
	);

const showForm = (
	fields: { [name: string]: string } = {},
	extra: Partial<Step> = {},
) =>
	form(
		{ action: "template-version", kind: "msa", version: "1", ...fields },
		{ dump, ...extra },
	);

const store = (...templates: SeedRow[]): Seed => ({
	software_agreement_templates: templates,
});

const scene = (
	name: string,
	step: Step | Step[],
	seed: Seed = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed },
	steps: Array.isArray(step) ? step : [step],
	...extra,
});

const day = (n: number) => `2026-10-0${n}T09:00:00.000Z`;

const v1 = await templateRow("msa-1", "msa", 1, MSA, {
	published_at: day(1),
	version_label: "2026.10",
});

const v2 = await templateRow("msa-2", "msa", 2, `${MSA}\nExtra clause.`, {
	published_at: day(2),
	version_label: null,
});

const v3 = await templateRow(
	"msa-3",
	"msa",
	3,
	`${MSA}\nExtra clause.\nAnother.`,
	{ published_at: day(3), version_label: "v3" },
);

const s1 = await templateRow("sow-1", "sow", 1, SOW, {
	published_at: day(4),
	version_label: "S1",
});

const s2 = await templateRow("sow-2", "sow", 2, `${SOW}\nMore.`, {
	published_at: day(5),
	version_label: "S2",
});

const all = store(v1, v2, v3, s1, s2);

const lines = (count: number, prefix: string) =>
	Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join("\n");

const odd = async (id: string, over: SeedRow) =>
	store(await templateRow(id, "msa", 1, MSA, over));

const cases: Case[] = [
	scene("version 1 has no previous version", show({ version: 1 }), all),
	scene(
		"version 2 is compared with version 1 and has no label",
		show({ version: 2 }),
		all,
	),
	scene("version 3 is compared with version 2", show({ version: 3 }), all),
	scene("an SOW version 1", show({ kind: "sow", version: 1 }), all),
	scene("an SOW version 2", show({ kind: "sow", version: 2 }), all),
	scene(
		"a version whose predecessor is missing has no comparison",
		show({ version: 3 }),
		store(v1, v3),
	),
	scene(
		"identical texts compare as unchanged",
		show({ version: 2 }),
		store(v1, { ...v2, text: MSA }),
	),
	scene("an unknown version", show({ version: 9 }), all),
	scene("the other kind's version", show({ kind: "sow", version: 3 }), all),
	scene("a very large version", show({ version: 1e15 }), all),
	scene("nothing stored", show()),

	// the body
	scene("kind missing", show({ kind: undefined }), all),
	scene("another kind", show({ kind: "nda" }), all),
	scene("kind in capitals", show({ kind: "MSA" }), all),
	scene("version missing", show({ version: undefined }), all),
	scene("version zero", show({ version: 0 }), all),
	scene("version negative", show({ version: -1 }), all),
	scene("version a fraction", show({ version: 1.5 }), all),
	scene("version not a number", show({ version: "abc" }), all),
	scene("version an empty string", show({ version: "" }), all),
	scene("version null", show({ version: null }), all),
	scene("version as the text 2", show({ version: "2" }), all),
	scene("version as the text 2.0", show({ version: "2.0" }), all),
	scene("version with spaces around it", show({ version: " 2 " }), all),
	scene("version as an array of one number", show({ version: [2] }), all),
	scene("version true coerces to 1", show({ version: true }), all),
	scene("version as hexadecimal text", show({ version: "0x2" }), all),
	scene("extra fields are ignored", show({ text: "x", confirmed: true }), all),
	scene("a visitor is refused", show({}, { as: asVisitor() }), all),
	scene(
		"a studio client cookie is refused",
		show({}, { as: asClientCookie("a".repeat(72)) }),
		all,
	),

	// stored values
	scene(
		"an empty label falls back to the date",
		show(),
		await odd("t", { version_label: "" }),
	),
	scene(
		"no label falls back to the date",
		show(),
		await odd("t", { version_label: null }),
	),
	scene(
		"an unreadable published date",
		show(),
		await odd("t", { version_label: null, published_at: "x" }),
	),
	scene(
		"an empty published date",
		show(),
		await odd("t", { version_label: null, published_at: "" }),
	),
	scene(
		"a label with markup is returned as stored",
		show(),
		await odd("t", { version_label: "<b>&\"'" }),
	),
	scene(
		"a source revision is not returned",
		show(),
		await odd("t", { source_revision: "abc123" }),
	),
	scene(
		"stored text with markup is returned as stored",
		show(),
		await odd("t", { text: `${MSA}\n<script>alert(1)</script> & "q" 'a'` }),
	),
	scene(
		"stored text with unicode",
		show(),
		await odd("t", { text: `${MSA}\nZoë \u{1F600} 日本` }),
	),
	scene(
		"stored text with Windows line endings",
		show(),
		await odd("t", { text: MSA.replaceAll("\n", "\r\n") }),
	),
	scene(
		"stored text of 100 KiB",
		show(),
		await odd("t", { text: `${MSA}\n${"x".repeat(102_400 - MSA.length - 1)}` }),
	),
	scene(
		"stored text that today's rules would refuse",
		show(),
		await odd("t", { text: "hello <world> [blank] ____" }),
	),
	scene("stored text that is empty", show(), await odd("t", { text: "" })),
	scene(
		"a diff above the table cap changes every line",
		show({ version: 2 }),
		store(
			await templateRow("a", "msa", 1, `${MSA}\n${lines(2100, "old")}`, {
				version_label: "A",
			}),
			await templateRow("b", "msa", 2, `${MSA}\n${lines(2100, "new")}`, {
				version_label: "B",
			}),
		),
	),
	scene(
		"a diff with CRLF on one side",
		show({ version: 2 }),
		store(
			await templateRow("a", "msa", 1, MSA.replaceAll("\n", "\r\n"), {
				version_label: "A",
			}),
			await templateRow("b", "msa", 2, MSA, { version_label: "B" }),
		),
	),
	scene(
		"a previous version with no label",
		show({ version: 3 }),
		store(v2, v3),
	),

	// outages
	scene("the read of the version fails", show(), all, {
		failures: [
			{
				on: /SELECT \* FROM software_agreement_templates WHERE kind=\? AND version=\?/,
				message: "d1 down",
			},
		],
	}),
	scene("the read of the previous version fails", show({ version: 2 }), all, {
		failures: [
			{
				on: /SELECT \* FROM software_agreement_templates WHERE kind=\? AND version=\?/,
				nth: 2,
				message: "d1 down",
			},
		],
	}),

	// forms
	scene("a form shows version 1 as a page", showForm(), all),
	scene("a form shows version 2 as a page", showForm({ version: "2" }), all),
	scene(
		"a form shows stored markup escaped",
		showForm(),
		await odd("t", { text: `${MSA}\n<script>alert(1)</script> & "q" 'a'` }),
	),
	scene(
		"a form with empty stored text stays JSON",
		showForm(),
		await odd("t", { text: "" }),
	),
	scene(
		"a form for an unknown version shows the error page",
		showForm({ version: "9" }),
		all,
	),
	scene(
		"a form with a version that is not a number",
		showForm({ version: "abc" }),
		all,
	),
	scene(
		"a form with kind missing",
		form({ action: "template-version", version: "1" }),
		all,
	),
	scene("a form by a visitor", showForm({}, { as: asVisitor() }), all),
	scene("a form whose read fails", showForm(), all, {
		failures: [
			{
				on: /SELECT \* FROM software_agreement_templates WHERE kind=\? AND version=\?/,
				message: 'd1 <down> & "out"',
			},
		],
	}),
];

defineCorpus("owner-agreements-template-version", POST, cases);
