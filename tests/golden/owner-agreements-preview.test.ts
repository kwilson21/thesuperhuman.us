import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/agreements";
import {
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type Step,
} from "./harness";
import {
	act,
	form,
	harmlessTexts,
	MSA,
	SOW,
	templateProblems,
	templateRow,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "preview": the owner checks a template text and sees it filled with
// sample values and compared with the current version. Nothing is written.
//
// Every response branch of the handler, validateTemplate, renderAgreement, sampleAgreementValues, templateComparison and lineDiff
// (src/lib/agreement-templates.ts, src/lib/line-diff.ts), and its cases:
//
//   200 {ok:true, text, compare}   an MSA and an SOW with no current version (compare null), against a current version (rows of
//                                  removed, added and unchanged lines, the current version's label or v<date>), the same text as the
//                                  current version, a versionLabel used in {{msa.source_revision}} (valid, trimmed, with a space or
//                                  another bad character so the sample label is kept, 40 characters), the harmless oddities of a text
//                                  (line endings, tabs, accents, ampersand and quotes, optional fields, repeats, zero-width and no-break
//                                  spaces, a long line, the loop), a long text near the limit, a diff above the table cap
//   400 "Check required fields and limits."   kind missing, another kind or case, text missing or not text, text of 102401 characters,
//                                  expectedCurrentVersion missing, negative, a fraction, text, versionLabel over 40, sourceRevision over 120
//   409 {error: validateTemplate message}   every way a text is refused (the table of problems), a failing read of the current version
//   native form                    the preview as an HTML page (200), the same errors as pages, markup characters escaped, a visitor
//   403                            a visitor

const dump = {
	music: ["software_agreement_templates", "software_agreement_events"],
};

const preview = (
	over: { [key: string]: JsonValue | undefined } = {},
	extra: Partial<Step> = {},
) =>
	act(
		{
			action: "preview",
			kind: "msa",
			text: MSA,
			expectedCurrentVersion: 0,
			...over,
		},
		{ dump, ...extra },
	);

const previewForm = (
	fields: { [name: string]: string } = {},
	extra: Partial<Step> = {},
) =>
	form(
		{
			action: "preview",
			kind: "msa",
			text: MSA,
			expectedCurrentVersion: "0",
			...fields,
		},
		{ dump, ...extra },
	);

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

const msaV1 = await templateRow("msa-1", "msa", 1, MSA, {
	published_at: "2026-10-01T09:00:00.000Z",
	version_label: "2026.10",
});

const msaV2 = await templateRow("msa-2", "msa", 2, `${MSA}\nExtra clause.`, {
	published_at: "2026-11-01T09:00:00.000Z",
	version_label: null,
});

const sowV1 = await templateRow("sow-1", "sow", 1, SOW, {
	version_label: "S1",
});

const withMsa = (...rowsOf: Seed["x"][]) => ({
	software_agreement_templates: rowsOf.flat(),
});

const lines = (count: number, prefix: string) =>
	Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join("\n");

const cases: Case[] = [
	scene("an MSA with no current version", preview()),
	scene("an SOW with no current version", preview({ kind: "sow", text: SOW })),
	scene(
		"an MSA against a current version with a label",
		preview({ text: `${MSA}\nAdded line.` }),
		withMsa([msaV1]),
	),
	scene(
		"an MSA against a current version with no label",
		preview({ text: `${MSA}\nAdded line.` }),
		withMsa([msaV1, msaV2]),
	),
	scene("the same text as the current version", preview(), withMsa([msaV1])),
	scene(
		"a line removed and one changed",
		preview({
			text: MSA.split("\n")
				.slice(1)
				.join("\n")
				.replace("client.jurisdiction", "client.jurisdiction (changed)"),
		}),
		withMsa([msaV1]),
	),
	scene(
		"an SOW against a current SOW",
		preview({ kind: "sow", text: `${SOW}\nAdded line.` }),
		withMsa([sowV1]),
	),
	scene(
		"an MSA preview ignores the SOW's versions",
		preview(),
		withMsa([sowV1]),
	),
	scene(
		"Windows line endings against a current version with Unix ones",
		preview({ text: MSA.replaceAll("\n", "\r\n") }),
		withMsa([msaV1]),
	),
	scene(
		"a diff above the table cap changes every line",
		preview({ text: `${MSA}\n${lines(2100, "new")}` }),
		withMsa([{ ...msaV1, text: `${MSA}\n${lines(2100, "old")}` }]),
	),
	scene(
		"a text of 100000 characters",
		preview({ text: `${MSA}\n${"x".repeat(100_000 - MSA.length - 1)}` }),
	),
	scene(
		"a text of exactly 102400 characters",
		preview({ text: `${MSA}\n${"x".repeat(102_400 - MSA.length - 1)}` }),
	),

	// the label
	scene(
		"a version label shows in the preview",
		preview({ versionLabel: "v2.1" }),
	),
	scene("a version label is trimmed", preview({ versionLabel: "  v2.1  " })),
	scene(
		"a version label with a space keeps the sample",
		preview({ versionLabel: "v 2" }),
	),
	scene(
		"a version label with an underscore keeps the sample",
		preview({ versionLabel: "v_2" }),
	),
	scene(
		"a version label of 40 characters",
		preview({ versionLabel: "v".repeat(40) }),
	),
	scene(
		"a version label of 41 characters",
		preview({ versionLabel: "v".repeat(41) }),
	),
	scene(
		"an empty version label keeps the sample",
		preview({ versionLabel: "" }),
	),
	scene(
		"a version label of spaces keeps the sample",
		preview({ versionLabel: "   " }),
	),
	scene("a version label that is not text", preview({ versionLabel: 5 })),
	scene(
		"a source revision of 120 characters",
		preview({ sourceRevision: "r".repeat(120) }),
	),
	scene(
		"a source revision of 121 characters",
		preview({ sourceRevision: "r".repeat(121) }),
	),

	// the body
	scene("kind missing", preview({ kind: undefined })),
	scene("another kind", preview({ kind: "nda" })),
	scene("kind in capitals", preview({ kind: "MSA" })),
	scene("text missing", preview({ text: undefined })),
	scene("text not text", preview({ text: 5 })),
	scene("text of 102401 characters", preview({ text: "x".repeat(102_401) })),
	scene(
		"expectedCurrentVersion missing",
		preview({ expectedCurrentVersion: undefined }),
	),
	scene(
		"expectedCurrentVersion negative",
		preview({ expectedCurrentVersion: -1 }),
	),
	scene(
		"expectedCurrentVersion a fraction",
		preview({ expectedCurrentVersion: 1.5 }),
	),
	scene(
		"expectedCurrentVersion as text",
		preview({ expectedCurrentVersion: "3" }),
	),
	scene(
		"expectedCurrentVersion not a number",
		preview({ expectedCurrentVersion: "abc" }),
	),
	scene(
		"expectedCurrentVersion is not compared in a preview",
		preview({ expectedCurrentVersion: 9 }),
		withMsa([msaV1]),
	),
	scene("a visitor cannot preview", preview({}, { as: asVisitor() })),
	scene(
		"the read of the current version fails",
		preview(),
		{},
		{
			failures: [
				{
					on: /SELECT \* FROM software_agreement_templates WHERE kind=\? ORDER BY version DESC/,
					message: "d1 down",
				},
			],
		},
	),

	// forms
	scene("a form shows the preview as a page", previewForm()),
	scene(
		"a form with a text that has an ampersand and quotes",
		previewForm({ text: `${MSA}\nA & B "C" 'D'` }),
	),
	scene(
		"a form against a current version",
		previewForm({ text: `${MSA}\nAdded line.` }),
		withMsa([msaV1]),
	),
	scene(
		"a form with an invalid text shows the message as a page",
		previewForm({ text: "hello" }),
	),
	scene(
		"a form with a field name containing an ampersand",
		previewForm({ text: `${MSA}\n{{a&b}}` }),
	),
	scene(
		"a form with a quote in the unknown field",
		previewForm({ text: `${MSA}\n{{a"b'c}}` }),
	),
	scene(
		"a form with kind missing",
		form({ action: "preview", text: MSA, expectedCurrentVersion: "0" }),
	),
	scene("a form by a visitor", previewForm({}, { as: asVisitor() })),
	scene("a form with a label", previewForm({ versionLabel: "f1" })),

	// the table of problems and of harmless oddities
	...templateProblems.map(([name, kind, text]) =>
		scene(`the text is refused for ${name}`, preview({ kind, text })),
	),
	...harmlessTexts.map(([name, kind, text]) =>
		scene(`the text is accepted with ${name}`, preview({ kind, text })),
	),
];

defineCorpus("owner-agreements-preview", POST, cases);
