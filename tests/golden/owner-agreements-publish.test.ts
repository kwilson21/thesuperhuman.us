import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/agreements";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	act,
	form,
	MSA,
	run,
	SOW,
	templateProblems,
	templateRow,
	twoVersions,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "publish": the owner publishes a new immutable template version. One
// batch checks that nobody published in between (max version equals expectedCurrentVersion), inserts version expected + 1 and
// writes a template-published event. A native form post answers a 303 redirect.
//
// Every response branch of the handler and publishTemplate (src/lib/agreement-templates.ts), and its cases:
//
//   200 {ok:true, id, sha256, version, versionLabel}   the first MSA, the first SOW, a second version, a third in sequence, a text with
//                       Windows line endings (stored with Unix ones, hashed after), a source revision stored, trimmed, blank (null), at 120,
//                       a label of 40 characters, with dots and dashes, trimmed; both kinds side by side; the same label on the other kind;
//                       a version after a gap; every harmless oddity of a text
//   400 "Check required fields and limits."   kind, text, expectedCurrentVersion (missing, negative, a fraction, text that is not a number),
//                       versionLabel (missing, empty, spaces, over 40, a space, an underscore, a non-ASCII letter), confirmed not a boolean,
//                       sourceRevision over 120, text over 102400 characters, a visitor's body
//   400 "Confirm publication of a new immutable version."   confirmed missing or false (checked after the text is validated)
//   409 {error: message}   every way a text is refused (the table of problems), the text matches the current version (with its label, with the
//                       date fallback), a label already used for this kind, a stale expectedCurrentVersion (too low, too high, on an empty
//                       table; sqlite's own text), a version that lands before the batch, a label taken between the check and the insert
//                       (reachable only through a gap in the versions), a failed batch, a failed read of the current version or of the label
//   events              a template-published event with the owner's email and time on each success
//   native form         a 303 for a success; a page for each error, the message escaped (a stored label with markup shows escaped)
//   403                 a visitor, a studio client cookie
//   sequences           publish then preview then version; publish twice; publish, publish the same text again, publish with a new label

const dump = {
	music: ["software_agreement_templates", "software_agreement_events"],
};

const publish = (
	over: { [key: string]: JsonValue | undefined } = {},
	extra: Partial<Step> = {},
) =>
	act(
		{
			action: "publish",
			kind: "msa",
			text: MSA,
			expectedCurrentVersion: 0,
			versionLabel: "m1",
			confirmed: true,
			...over,
		},
		{ dump, ...extra },
	);

const publishForm = (
	fields: { [name: string]: string } = {},
	extra: Partial<Step> = {},
) =>
	form(
		{
			action: "publish",
			kind: "msa",
			text: MSA,
			expectedCurrentVersion: "0",
			versionLabel: "m1",
			confirmed: "on",
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

const stored = (...templates: SeedRow[]): Seed => ({
	software_agreement_templates: templates,
});

const v1 = await templateRow("msa-1", "msa", 1, MSA, {
	version_label: "m1",
	published_at: "2026-10-01T09:00:00.000Z",
});

const v2 = await templateRow("msa-2", "msa", 2, `${MSA}\nExtra clause.`, {
	version_label: "m2",
	published_at: "2026-10-02T09:00:00.000Z",
});

const v3 = await templateRow(
	"msa-3",
	"msa",
	3,
	`${MSA}\nExtra clause.\nMore.`,
	{ version_label: "m3", published_at: "2026-10-03T09:00:00.000Z" },
);

const unlabelled = await templateRow("msa-1", "msa", 1, MSA, {
	version_label: null,
	published_at: "2026-10-01T09:00:00.000Z",
});

const markup = await templateRow("msa-1", "msa", 1, MSA, {
	version_label: "<b>&\"'",
	published_at: "2026-10-01T09:00:00.000Z",
});

const [sowV1] = await twoVersions("sow");
const next = `${MSA}\nA new clause.`;

const cases: Case[] = [
	scene("the first MSA", publish()),
	scene(
		"the first SOW",
		publish({ kind: "sow", text: SOW, versionLabel: "s1" }),
	),
	scene(
		"a second MSA version",
		publish({ expectedCurrentVersion: 1, text: next, versionLabel: "m2" }),
		stored(v1),
	),
	scene(
		"a third version after two",
		publish({ expectedCurrentVersion: 2, text: next, versionLabel: "m3" }),
		stored(v1, v2),
	),
	scene(
		"a version after a gap in the numbers",
		publish({ expectedCurrentVersion: 3, text: next, versionLabel: "m4" }),
		stored(v1, v3),
	),
	scene("an MSA and an SOW side by side", [
		publish(),
		publish(
			{ kind: "sow", text: SOW, versionLabel: "m1", expectedCurrentVersion: 0 },
			{ advanceMs: 1000 },
		),
	]),
	scene(
		"a SOW version is independent of the MSA's",
		publish({
			kind: "sow",
			text: `${SOW}\nNew.`,
			versionLabel: "s2",
			expectedCurrentVersion: 1,
		}),
		stored(v1, sowV1),
	),
	scene("three versions in sequence", [
		publish(),
		publish(
			{ expectedCurrentVersion: 1, text: next, versionLabel: "m2" },
			{ advanceMs: 1000 },
		),
		publish(
			{
				expectedCurrentVersion: 2,
				text: `${next}\nAnd more.`,
				versionLabel: "m3",
			},
			{ advanceMs: 1000 },
		),
	]),
	scene(
		"a second owner is recorded in the event",
		publish({}, { as: asOwner("second@example.test") }),
	),
	scene("a visitor cannot publish", publish({}, { as: asVisitor() })),
	scene(
		"a studio client cookie cannot publish",
		publish({}, { as: asClientCookie("a".repeat(72)) }),
	),

	// the text matches or the label is used
	scene(
		"the same text as the current version, with its label",
		publish({ expectedCurrentVersion: 1, versionLabel: "m9" }),
		stored(v1),
	),
	scene(
		"the same text as the current version, with no label",
		publish({ expectedCurrentVersion: 1, versionLabel: "m9" }),
		stored(unlabelled),
	),
	scene(
		"the same text as an older version is allowed",
		publish({ expectedCurrentVersion: 2, text: MSA, versionLabel: "m3" }),
		stored(v1, v2),
	),
	scene(
		"the same text with Windows line endings matches the current version",
		publish({
			expectedCurrentVersion: 1,
			text: MSA.replaceAll("\n", "\r\n"),
			versionLabel: "m9",
		}),
		stored(v1),
	),
	scene(
		"a label already used for the MSA",
		publish({ expectedCurrentVersion: 1, text: next, versionLabel: "m1" }),
		stored(v1),
	),
	scene(
		"a label used by an older version",
		publish({ expectedCurrentVersion: 2, text: next, versionLabel: "m1" }),
		stored(v1, v2),
	),
	scene(
		"the label of the other kind may be reused",
		publish({ expectedCurrentVersion: 1, text: next, versionLabel: "S1" }),
		stored(v1, { ...sowV1, version_label: "S1" }),
	),
	scene(
		"labels are compared exactly, case included",
		publish({ expectedCurrentVersion: 1, text: next, versionLabel: "M1" }),
		stored(v1),
	),
	scene(
		"a stored label with markup shows escaped on a form page",
		publishForm({ expectedCurrentVersion: "1" }),
		stored(markup),
	),

	// expectedCurrentVersion
	scene(
		"an expected version too low",
		publish({ expectedCurrentVersion: 0, text: next, versionLabel: "m2" }),
		stored(v1),
	),
	scene(
		"an expected version too high",
		publish({ expectedCurrentVersion: 5, text: next, versionLabel: "m2" }),
		stored(v1),
	),
	scene(
		"an expected version on an empty table that is not zero",
		publish({ expectedCurrentVersion: 1 }),
	),
	scene(
		"an expected version as text",
		publish({ expectedCurrentVersion: "1", text: next, versionLabel: "m2" }),
		stored(v1),
	),
	scene(
		"an expected version missing",
		publish({ expectedCurrentVersion: undefined }),
	),
	scene(
		"an expected version negative",
		publish({ expectedCurrentVersion: -1 }),
	),
	scene(
		"an expected version a fraction",
		publish({ expectedCurrentVersion: 0.5 }),
	),
	scene(
		"an expected version not a number",
		publish({ expectedCurrentVersion: "abc" }),
	),

	// confirmation
	scene("confirmed missing", publish({ confirmed: undefined })),
	scene("confirmed false", publish({ confirmed: false })),
	scene("confirmed as the text true", publish({ confirmed: "true" })),
	scene("confirmed as the number one", publish({ confirmed: 1 })),
	scene("confirmed null", publish({ confirmed: null })),
	scene(
		"an invalid text is reported before the missing confirmation",
		publish({ confirmed: false, text: "hello" }),
	),

	// labels
	scene("a label missing", publish({ versionLabel: undefined })),
	scene("an empty label", publish({ versionLabel: "" })),
	scene("a label of spaces", publish({ versionLabel: "   " })),
	scene("a label of 40 characters", publish({ versionLabel: "v".repeat(40) })),
	scene("a label of 41 characters", publish({ versionLabel: "v".repeat(41) })),
	scene("a label with a space inside", publish({ versionLabel: "v 1" })),
	scene("a label with an underscore", publish({ versionLabel: "v_1" })),
	scene("a label with a non-ASCII letter", publish({ versionLabel: "vé" })),
	scene(
		"a label with dots and dashes",
		publish({ versionLabel: "2026.11-rc.1" }),
	),
	scene(
		"a label with spaces around it is trimmed",
		publish({ versionLabel: "  m7  " }),
	),
	scene("a label that is not text", publish({ versionLabel: 5 })),
	scene("a source revision is stored", publish({ sourceRevision: "abc1234" })),
	scene(
		"a source revision is trimmed",
		publish({ sourceRevision: "  abc1234  " }),
	),
	scene(
		"a blank source revision is stored as null",
		publish({ sourceRevision: "   " }),
	),
	scene(
		"a source revision of 120 characters",
		publish({ sourceRevision: "r".repeat(120) }),
	),
	scene(
		"a source revision of 121 characters",
		publish({ sourceRevision: "r".repeat(121) }),
	),

	// the text
	scene(
		"Windows line endings are stored as Unix ones",
		publish({ text: MSA.replaceAll("\n", "\r\n") }),
	),
	scene("a text of 102401 characters", publish({ text: "x".repeat(102_401) })),
	scene("another kind", publish({ kind: "nda" })),
	scene("kind missing", publish({ kind: undefined })),
	scene("text missing", publish({ text: undefined })),

	// outages and races
	scene(
		"the read of the current version fails",
		publish(),
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
	scene(
		"the label check fails",
		publish(),
		{},
		{
			failures: [
				{
					on: /SELECT 1 FROM software_agreement_templates WHERE kind=\? AND version_label=\?/,
					message: "d1 down",
				},
			],
		},
	),
	scene(
		"the batch fails",
		publish(),
		{},
		{
			failures: [
				{ on: /INSERT INTO software_agreement_templates/, message: "d1 down" },
			],
		},
	),
	scene(
		"another version lands just before the batch",
		publish(),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_agreement_templates/,
					label: "another publish lands",
					run: run(
						"INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label) VALUES('x','msa',1,'other','" +
							"1".repeat(64) +
							"','2026-11-13T11:59:00.000Z','other@example.test','other')",
					),
				},
			],
		},
	),
	scene(
		"the label is taken between the check and the insert",
		publish({ expectedCurrentVersion: 3, text: next, versionLabel: "race" }),
		stored(v1, v3),
		{
			interleave: [
				{
					on: /INSERT INTO software_agreement_templates/,
					label: "another publish takes the label with the missing version 2",
					run: run(
						"INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label) VALUES('x','msa',2,'other','" +
							"1".repeat(64) +
							"','2026-11-13T11:59:00.000Z','other@example.test','race')",
					),
				},
			],
		},
	),

	// forms
	scene("a form publishes and redirects", publishForm()),
	scene("a form with confirmed true", publishForm({ confirmed: "true" })),
	scene(
		"a form without confirmed",
		form(
			{
				action: "publish",
				kind: "msa",
				text: MSA,
				expectedCurrentVersion: "0",
				versionLabel: "m1",
			},
			{ dump },
		),
	),
	scene("a form with confirmed false", publishForm({ confirmed: "false" })),
	scene(
		"a form with an invalid text shows the page",
		publishForm({ text: "hello" }),
	),
	scene(
		"a form whose text has an ampersand and quotes",
		publishForm({ text: `${MSA}\nA & B "C" 'D'` }),
	),
	scene(
		"a form with a stale version",
		publishForm({
			expectedCurrentVersion: "0",
			versionLabel: "m2",
			text: next,
		}),
		stored(v1),
	),
	scene(
		"a form with a label already used",
		publishForm({ expectedCurrentVersion: "1", text: next }),
		stored(v1),
	),
	scene(
		"a form with the same text",
		publishForm({ expectedCurrentVersion: "1" }),
		stored(v1),
	),
	scene(
		"a form with a label that is not valid",
		publishForm({ versionLabel: "v 1" }),
	),
	scene("a form by a visitor", publishForm({}, { as: asVisitor() })),
	scene(
		"a form whose batch fails shows the page",
		publishForm(),
		{},
		{
			failures: [
				{
					on: /INSERT INTO software_agreement_templates/,
					message: 'd1 <down> & "out"',
				},
			],
		},
	),

	// sequences
	scene("publish, then the same text again", [
		publish(),
		publish(
			{ expectedCurrentVersion: 1, versionLabel: "m2" },
			{ advanceMs: 1000 },
		),
	]),
	scene("publish, then a new text with the old label", [
		publish(),
		publish({ expectedCurrentVersion: 1, text: next }, { advanceMs: 1000 }),
	]),
	scene("publish twice with the same expected version", [
		publish(),
		publish({ text: next, versionLabel: "m2" }, { advanceMs: 1000 }),
	]),
	scene("publish, then preview against it, then read it", [
		publish(),
		act(
			{ action: "preview", kind: "msa", text: next, expectedCurrentVersion: 1 },
			{ advanceMs: 1000 },
		),
		act(
			{ action: "template-version", kind: "msa", version: 1 },
			{ advanceMs: 1000, dump },
		),
	]),
	scene("a refusal, then the corrected publish", [
		publish({ text: "hello" }),
		publish(),
	]),

	...templateProblems.map(([name, kind, text], index) =>
		scene(
			`a text refused for ${name}`,
			publish({ kind, text, versionLabel: `p${index}` }),
		),
	),
	...[0, 1].map((index) =>
		scene(
			`a harmless text published as version ${index}`,
			publish({ text: `${MSA}\n\tTabbed ${index}`, versionLabel: `h${index}` }),
		),
	),
];

defineCorpus("owner-agreements-publish", POST, cases);
