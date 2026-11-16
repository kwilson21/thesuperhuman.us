import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/agreements";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";
import {
	act,
	CONFIG_VALUES,
	configFields,
	form,
	run,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "config": the owner records the contractor details every new
// agreement carries. Each save is a new version (max version + 1) guarded by expectedCurrentVersion, in one batch.
//
// Every response branch of the handler, readContractor (src/lib/agreement-fields.ts) and agreementRequest's flat-form branch, and
// its cases:
//
//   200 {ok:true} / form 303   the first save (version 1), a second and third in sequence, values lower-cased, trimmed and composed, text
//                              at each limit, a version given as text, a flat form (registered_agent_confirmed on), a form with a values
//                              field, another owner email
//   400 "Check required fields and limits."   each of the six text fields and the email: missing, empty, blank, over the limit, with a
//                              control character, the wrong type; email not an address, over 320; registered_agent_confirmed false, missing,
//                              "true", "on"; an unknown key (the schema is strict); values missing, null, an array, text; expectedCurrentVersion
//                              missing, negative, a fraction, text, null, huge; the flat form without the agent box, with a stray key
//   409 {error: <sqlite text>} stale expectedCurrentVersion (too low, too high), a lost race (another version inserted before the batch), a
//                              duplicate version, a failed batch; the form shows the same message as an escaped page
//   403                        a visitor

const dump = { music: ["software_contractor_config"] };

const save = (
	values: JsonValue | undefined,
	expected: JsonValue | undefined = 0,
	extra: Partial<Step> = {},
) =>
	act(
		{ action: "config", values, expectedCurrentVersion: expected },
		{ dump, ...extra },
	);

const withValue = (over: { [key: string]: JsonValue | undefined }) => ({
	...CONFIG_VALUES,
	...over,
});

const without = (key: string) =>
	Object.fromEntries(
		Object.entries(CONFIG_VALUES).filter(([name]) => name !== key),
	);

const scene = (
	name: string,
	step: Step | Step[],
	extra: Partial<Case> = {},
): Case => ({
	name,
	steps: Array.isArray(step) ? step : [step],
	...extra,
});

const seeded = (...versions: number[]) => ({
	music: {
		seed: {
			software_contractor_config: versions.map((version) => ({
				version,
				values_json: "{}",
				created_at: "2026-11-01T00:00:00.000Z",
				created_by: "earlier@example.test",
			})),
		},
	},
});

const textFields = [
	"legal_name",
	"entity_jurisdiction",
	"signer_name",
	"signer_title",
	"business_address",
] as const;

const limit = {
	legal_name: 200,
	entity_jurisdiction: 200,
	signer_name: 200,
	signer_title: 200,
	business_address: 1000,
};

const fieldCases = (key: (typeof textFields)[number]): Case[] => [
	scene(`${key} missing`, save(without(key))),
	scene(`${key} empty`, save(withValue({ [key]: "" }))),
	scene(`${key} blank`, save(withValue({ [key]: "   " }))),
	scene(`${key} not text`, save(withValue({ [key]: 7 }))),
	scene(
		`${key} at its limit`,
		save(withValue({ [key]: "x".repeat(limit[key]) })),
	),
	scene(
		`${key} over its limit`,
		save(withValue({ [key]: "x".repeat(limit[key] + 1) })),
	),
	scene(
		`${key} with a control character`,
		save(withValue({ [key]: "a\u0001b" })),
	),
];

const cases: Case[] = [
	scene("the first save is version 1", save(CONFIG_VALUES)),
	scene("three saves in sequence", [
		save(CONFIG_VALUES, 0),
		save(withValue({ signer_title: "Owner" }), 1, { advanceMs: 1000 }),
		save(withValue({ signer_title: "Member" }), 2, { advanceMs: 1000 }),
	]),
	scene("the same save twice", [
		save(CONFIG_VALUES, 0),
		save(CONFIG_VALUES, 0, { advanceMs: 1000 }),
	]),
	scene(
		"a save on top of existing versions",
		save(CONFIG_VALUES, 3),
		seeded(1, 2, 3),
	),
	scene("an expected version too low", save(CONFIG_VALUES, 0), seeded(1)),
	scene("an expected version too high", save(CONFIG_VALUES, 5), seeded(1)),
	scene(
		"an expected version on an empty table that is not zero",
		save(CONFIG_VALUES, 1),
	),
	scene("a visitor cannot save", save(CONFIG_VALUES, 0, { as: asVisitor() })),
	scene(
		"a second owner is recorded",
		save(CONFIG_VALUES, 0, { as: asOwner("second@example.test") }),
	),
	scene(
		"the email is lower-cased and trimmed",
		save(withValue({ notice_email: "  Notices@EXAMPLE.test  " })),
	),
	scene(
		"text is trimmed and composed",
		save(withValue({ legal_name: "  Café LLC  " })),
	),
	scene(
		"markup and quotes are stored as written",
		save(withValue({ business_address: "<b>1</b> & \"Main\" 'St'" })),
	),
	scene(
		"unicode is stored as written",
		save(withValue({ signer_name: "Zoë \u{1F600}" })),
	),
	scene(
		"an email that is not an address",
		save(withValue({ notice_email: "nope" })),
	),
	scene("an email missing", save(without("notice_email"))),
	scene(
		"an email over 320 characters",
		save(withValue({ notice_email: `${"a".repeat(310)}@example.test` })),
	),
	scene(
		"an email of exactly 320 characters is checked as an address",
		save(
			withValue({
				notice_email:
					`${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(57)}.test`.slice(
						0,
						320,
					),
			}),
		),
	),
	scene(
		"the agent box false",
		save(withValue({ registered_agent_confirmed: false })),
	),
	scene("the agent box missing", save(without("registered_agent_confirmed"))),
	scene(
		"the agent box as the text true",
		save(withValue({ registered_agent_confirmed: "true" })),
	),
	scene(
		"the agent box as the text on",
		save(withValue({ registered_agent_confirmed: "on" })),
	),
	scene("an unknown key", save(withValue({ extra: "x" }))),
	scene("values missing", save(undefined)),
	scene("values null", save(null)),
	scene("values an array", save([])),
	scene("values text", save("legal")),
	scene("values empty", save({})),
	scene(
		"expectedCurrentVersion missing",
		act({ action: "config", values: CONFIG_VALUES }, { dump }),
	),
	scene("expectedCurrentVersion as text", save(CONFIG_VALUES, "0")),
	scene(
		"expectedCurrentVersion empty text coerces to zero",
		save(CONFIG_VALUES, ""),
	),
	scene("expectedCurrentVersion not a number", save(CONFIG_VALUES, "abc")),
	scene("expectedCurrentVersion negative", save(CONFIG_VALUES, -1)),
	scene("expectedCurrentVersion a fraction", save(CONFIG_VALUES, 0.5)),
	scene(
		"expectedCurrentVersion null coerces to zero",
		save(CONFIG_VALUES, null),
	),
	scene(
		"expectedCurrentVersion true coerces to one",
		save(CONFIG_VALUES, true),
		seeded(1),
	),
	scene("expectedCurrentVersion huge", save(CONFIG_VALUES, 1e21)),
	scene("expectedCurrentVersion an array", save(CONFIG_VALUES, [0])),

	// outages and races
	scene("the batch fails", save(CONFIG_VALUES, 0), {
		failures: [
			{ on: /INSERT INTO software_contractor_config/, message: "d1 down" },
		],
	}),
	scene("another version lands just before the batch", save(CONFIG_VALUES, 0), {
		interleave: [
			{
				on: /INSERT INTO software_contractor_config/,
				label: "another save lands",
				run: run(
					"INSERT INTO software_contractor_config VALUES(1,'{}','2026-11-13T11:59:00.000Z','other@example.test')",
				),
			},
		],
	}),
	scene(
		"a failure reaches the form as an escaped page",
		form(configFields(), { dump }),
		{
			failures: [
				{
					on: /INSERT INTO software_contractor_config/,
					message: 'd1 <down> & "out"',
				},
			],
		},
	),

	// forms
	scene("a flat form saves", form(configFields(), { dump })),
	scene(
		"a flat form with the agent box off",
		form(configFields({ registered_agent_confirmed: "off" }), { dump }),
	),
	scene(
		"a flat form with the agent box left out",
		form({ ...configFields(), registered_agent_confirmed: "" }, { dump }),
	),
	scene(
		"a flat form with a stray key",
		form(configFields({ csrf_nonce: "n" }), { dump }),
	),
	scene(
		"a flat form with a stale version",
		form(configFields({ expectedCurrentVersion: "0" }), { dump }),
		seeded(1),
	),
	scene(
		"a flat form with a text version",
		form(configFields({ expectedCurrentVersion: "abc" }), { dump }),
	),
	scene(
		"a flat form with the email in capitals",
		form(configFields({ notice_email: "N@EXAMPLE.TEST" }), { dump }),
	),
	scene(
		"a flat form with markup in the address",
		form(configFields({ business_address: "<i>1 Main</i> & Co" }), { dump }),
	),
	scene(
		"a form with a values field",
		form(
			{
				action: "config",
				expectedCurrentVersion: "0",
				values: JSON.stringify(CONFIG_VALUES),
			},
			{ dump },
		),
	),
	scene(
		"a form with a values field that is invalid",
		form(
			{
				action: "config",
				expectedCurrentVersion: "0",
				values: JSON.stringify({ legal_name: "x" }),
			},
			{ dump },
		),
	),
	scene(
		"a form with a values field that is not JSON",
		form(
			{ action: "config", expectedCurrentVersion: "0", values: "{nope" },
			{ dump },
		),
	),
	scene("a form by a visitor", form(configFields(), { as: asVisitor() })),
	scene("a form, then another save on top", [
		form(configFields(), { dump }),
		save(withValue({ signer_name: "Next" }), 1, { advanceMs: 1000 }),
	]),
	scene(
		"the key order of the stored values follows the input",
		save(Object.fromEntries(Object.entries(CONFIG_VALUES).reverse())),
	),
	...textFields.flatMap(fieldCases),
];

defineCorpus("owner-agreements-config", POST, cases);
