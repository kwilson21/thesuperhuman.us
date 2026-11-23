import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it } from "vitest";
import { parseContractor } from "~/lib/agreement-fields";
import {
	currentTemplate,
	renderAgreement,
	sampleAgreementValues,
	templateComparison,
	templateFields,
} from "~/lib/agreement-templates";
import { hashOfferToken } from "~/lib/software-offers";
import {
	checkTemplate,
	compareTemplateVersion,
	findTemplateVersion,
	previewTemplate,
	publishFront,
	publishNewText,
	publishTemplate,
	type PublishInputs,
	saveContractor,
	type TemplatePublication,
	type TemplateRow,
} from "~/server/rules/agreement-templates";
import type { Refusal } from "~/server/terms";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The owner's templates and the contractor's details as stories, in the order POST /api/owner/agreements answers today
// (the golden corpora owner-agreements-preview, -publish, -template-version and -config record it): what a preview
// answers, every refusal of a publish and which wins when several hold, the version written and its hash, the stored
// version read with its comparison, and the contractor config saved. Then the guards that stay as the re-check, run on
// sqlite with their SQL copied as text from today's code (publishTemplate's A22 guard, insert and label read in
// src/lib/agreement-templates.ts; the config's A23 guard and insert in src/pages/api/owner/agreements.ts; the newest
// config read in src/server/offers-store.ts), held to the rules over the same rows; the kind's newest version is read with
// today's exported `currentTemplate`.

type Said = { refused: string; say: string } | { wrote: unknown };

const said = <W, E extends Refusal>(decided: Effect.Effect<W, E>): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

/** What a rule wrote, or a failed test naming the refusal it gave instead. */
function wrote<W, E extends Refusal>(decided: Effect.Effect<W, E>): W {
	return Effect.runSync(
		Effect.mapError(decided, (refusal) => new Error(refusal.say)),
	);
}

const AT = "2026-11-13T12:00:00.000Z";
const OWNER = "owner@example.test";
const ID = "00000000-0000-4000-8000-000000000001";

/** A text that passes validateTemplate: every required field once, an SOW's milestone fields inside the loop. */
function templateText(kind: "msa" | "sow", title: string) {
	const line = (field: string) => `${field}: {{${field}}}`;
	const fields = templateFields[kind];

	return kind === "msa"
		? [title, ...fields.map(line)].join("\n")
		: [
				title,
				...fields.filter((field) => !field.startsWith("milestone.")).map(line),
				"{{#milestones}}",
				...fields.filter((field) => field.startsWith("milestone.")).map(line),
				"{{/milestones}}",
			].join("\n");
}

const MSA = templateText("msa", "Master Services Agreement");
const SOW = templateText("sow", "Statement of Work");
const NEXT = `${MSA}\nA new clause.`;
const WINDOWS = MSA.replaceAll("\n", "\r\n");

/** The hash today's publish recorded for MSA (golden owner-agreements-publish, "the first MSA"). */
const MSA_SHA =
	"2c9c8bd444d9b4b01fc721ab24129d4cbfb8fcd0788ebfcf69ee7364ca2ae7e0";

const EVERY_MSA_FIELD_MISSING = `Missing required fields: ${templateFields.msa.join(", ")}.`;

async function stored(
	version: number,
	text: string,
	over: Partial<TemplateRow> = {},
): Promise<TemplateRow> {
	return {
		id: `msa-${version}`,
		kind: "msa",
		version,
		text,
		sha256: await hashOfferToken(text),
		version_label: `m${version}`,
		source_revision: null,
		published_at: `2026-10-0${version}T09:00:00.000Z`,
		...over,
	};
}

const v1 = await stored(1, MSA);
const v2 = await stored(2, `${MSA}\nExtra clause.`, { version_label: null });
const v3 = await stored(3, `${MSA}\nExtra clause.\nMore.`);
const NEXT_SHA = await hashOfferToken(NEXT);

const refusedText = (problem: string) => ({
	refused: "TemplateRefused",
	say: problem,
});

describe("checking a text before any read", () => {
	it("gives the canonical text, Windows line endings made Unix ones", () => {
		expect(
			said(checkTemplate.decide({ kind: "msa", text: MSA }, null)),
		).toEqual({ wrote: MSA });
		expect(
			said(checkTemplate.decide({ kind: "msa", text: WINDOWS }, null)),
		).toEqual({ wrote: MSA });
	});

	it("refuses a text with the sentence validateTemplate gives", () => {
		const check = (kind: "msa" | "sow", text: string) =>
			said(checkTemplate.decide({ kind, text }, null));

		expect(check("msa", "hello")).toEqual(refusedText(EVERY_MSA_FIELD_MISSING));
		expect(check("msa", `${MSA}\n{{foo.bar}}`)).toEqual(
			refusedText("Line 21: unknown field foo.bar. Use the field reference."),
		);
		expect(check("msa", `${MSA}\n<b>`)).toEqual(
			refusedText(
				"Use plain text up to 100 KiB, without HTML or control characters.",
			),
		);
		expect(check("msa", `${MSA}\n `)).toEqual(
			refusedText("Unsupported character. Arrange outside-site signing."),
		);
		expect(check("msa", `${MSA}\n[blank]`)).toEqual(
			refusedText("Replace every blank with a named field."),
		);
		expect(check("msa", `${MSA}\n{{#milestones}}`)).toEqual(
			refusedText("Line 21: only one non-nested milestone loop is allowed."),
		);
		expect(check("sow", SOW.replace("{{/milestones}}", ""))).toEqual(
			refusedText("Close the milestone loop."),
		);
	});
});

describe("a preview", () => {
	const preview = (
		over: { kind?: "msa" | "sow"; text?: string; versionLabel?: string } = {},
		current: TemplateRow | null = null,
	) =>
		said(previewTemplate.decide({ kind: "msa", text: MSA, ...over }, current));

	it("fills the text with sample values and has no comparison when nothing is stored", () => {
		const answer = preview();

		expect(answer).toEqual({
			wrote: {
				text: renderAgreement(
					"msa",
					MSA,
					sampleAgreementValues("msa", MSA, undefined),
				),
				compare: null,
			},
		});
		expect(JSON.stringify(answer)).toContain(
			"client.legal_name: Sample legal name\\n",
		);
		expect(JSON.stringify(answer)).toContain(
			"msa.source_revision: Sample version label\\n",
		);
	});

	it("fills an SOW's milestone loop once", () => {
		const answer = wrote(
			previewTemplate.decide({ kind: "sow", text: SOW }, null),
		);

		expect(answer.text.match(/milestone\.name: Sample name/g)).toHaveLength(1);
		expect(answer.text.endsWith("\n")).toBe(true);
	});

	it("shows the label the owner typed only when it has the label's form", () => {
		const sourceLine = (versionLabel?: string) =>
			wrote(
				previewTemplate.decide({ kind: "msa", text: MSA, versionLabel }, null),
			)
				.text.split("\n")
				.find((line) => line.startsWith("msa.source_revision:"));

		expect(sourceLine("v2.1")).toBe("msa.source_revision: v2.1");
		expect(sourceLine("v".repeat(40))).toBe(
			`msa.source_revision: ${"v".repeat(40)}`,
		);

		for (const kept of [undefined, "", "v 2", "v_2", "vé"])
			expect(sourceLine(kept)).toBe(
				"msa.source_revision: Sample version label",
			);
	});

	it("compares the canonical text with the kind's newest version, labelled or dated", () => {
		const added = `${MSA}\nAdded line.`;

		expect(preview({ text: added }, v1)).toEqual({
			wrote: expect.objectContaining({
				compare: templateComparison(v1, added),
			}),
		});
		expect(
			wrote(previewTemplate.decide({ kind: "msa", text: added }, v1)),
		).toMatchObject({ compare: { label: "m1" } });
		expect(
			wrote(previewTemplate.decide({ kind: "msa", text: added }, v2)).compare
				?.label,
		).toBe("v2026-10-02");
		expect(
			wrote(previewTemplate.decide({ kind: "msa", text: added }, v1)).compare
				?.rows,
		).toContainEqual({ kind: "added", text: "Added line." });
		// Windows line endings compare as the Unix text they are stored as: every line unchanged.
		expect(
			wrote(previewTemplate.decide({ kind: "msa", text: WINDOWS }, v1)).compare,
		).toEqual(templateComparison(v1, MSA));
		expect(
			wrote(previewTemplate.decide({ kind: "msa", text: WINDOWS }, v1)).compare
				?.rows,
		).toEqual([{ kind: "unchanged", count: 20 }]);
	});

	it("refuses a text the site does not accept, whatever is stored", () => {
		expect(preview({ text: "hello" })).toEqual(
			refusedText(EVERY_MSA_FIELD_MISSING),
		);
		expect(preview({ text: "hello" }, v1)).toEqual(
			refusedText(EVERY_MSA_FIELD_MISSING),
		);
		expect(preview({ kind: "sow", text: MSA })).toEqual(
			refusedText(
				"Line 4: unknown field msa.source_revision. Use the field reference.",
			),
		);
	});
});

describe("a publish, before any read", () => {
	const front = (text: string, confirmed: boolean | undefined) =>
		said(
			publishFront.decide(
				{
					kind: "msa",
					text,
					confirmed,
					versionLabel: "m1",
					expectedVersion: 0,
				},
				null,
			),
		);

	it("gives the canonical text once the text is accepted and the publish confirmed", () => {
		expect(front(MSA, true)).toEqual({ wrote: MSA });
		expect(front(WINDOWS, true)).toEqual({ wrote: MSA });
	});

	it("refuses an unconfirmed publish", () => {
		const unconfirmed = {
			refused: "NotConfirmed",
			say: "Confirm publication of a new immutable version.",
		};

		expect(front(MSA, false)).toEqual(unconfirmed);
		expect(front(MSA, undefined)).toEqual(unconfirmed);
	});

	it("reports an invalid text before the missing confirmation", () => {
		expect(front("hello", false)).toEqual(refusedText(EVERY_MSA_FIELD_MISSING));
	});
});

const inputs = (over: Partial<PublishInputs> = {}): PublishInputs => ({
	kind: "msa",
	text: NEXT,
	confirmed: true,
	versionLabel: "m9",
	expectedVersion: 1,
	sha256: NEXT_SHA,
	id: ID,
	at: AT,
	actor: OWNER,
	...over,
});

const publish = (
	over: Partial<PublishInputs> = {},
	current: TemplateRow | null = v1,
	labelUsed = false,
) => said(publishTemplate.decide(inputs(over), { current, labelUsed }));

const NOT_SAVED = {
	refused: "VersionChanged",
	say: "The agreement could not be saved.",
};

describe("a publish", () => {
	it("writes the first MSA as version 1 with today's hash, the label, the owner and the time", async () => {
		const sha256 = await hashOfferToken(MSA);

		expect(sha256).toBe(MSA_SHA);
		expect(
			publish(
				{ text: MSA, sha256, versionLabel: "m1", expectedVersion: 0 },
				null,
			),
		).toEqual({
			wrote: {
				row: {
					id: ID,
					kind: "msa",
					version: 1,
					text: MSA,
					sha256: MSA_SHA,
					published_at: AT,
					published_by: OWNER,
					version_label: "m1",
					source_revision: null,
				},
				expectedVersion: 0,
				event: { action: "template-published", actor: OWNER, at: AT },
				answer: { id: ID, sha256: MSA_SHA, version: 1, versionLabel: "m1" },
			},
		});
	});

	it("answers in today's key order", () => {
		const { answer } = wrote(
			publishTemplate.decide(
				inputs({
					text: MSA,
					sha256: MSA_SHA,
					versionLabel: "m1",
					expectedVersion: 0,
				}),
				{ current: null, labelUsed: false },
			),
		);

		expect(JSON.stringify({ ok: true, ...answer })).toBe(
			`{"ok":true,"id":"${ID}","sha256":"${MSA_SHA}","version":1,"versionLabel":"m1"}`,
		);
	});

	it("stores Windows line endings as Unix ones, with the hash of the Unix text", () => {
		const { row } = wrote(
			publishTemplate.decide(
				inputs({ text: WINDOWS, sha256: MSA_SHA, expectedVersion: 0 }),
				{ current: null, labelUsed: false },
			),
		);

		expect(row.text).toBe(MSA);
		expect(row.sha256).toBe(MSA_SHA);
	});

	it("writes the version after the newest, after a gap in the numbers too", () => {
		const version = (expectedVersion: number, current: TemplateRow) =>
			wrote(
				publishTemplate.decide(inputs({ expectedVersion }), {
					current,
					labelUsed: false,
				}),
			).row.version;

		expect(version(1, v1)).toBe(2);
		expect(version(2, { ...v2, version_label: "m2" })).toBe(3);
		expect(version(3, v3)).toBe(4);
	});

	it("stores the source revision trimmed, and a blank or missing one as null", () => {
		const revision = (sourceRevision: string | undefined) =>
			wrote(
				publishTemplate.decide(inputs({ sourceRevision }), {
					current: v1,
					labelUsed: false,
				}),
			).row.source_revision;

		expect(revision("abc1234")).toBe("abc1234");
		expect(revision("  abc1234  ")).toBe("abc1234");
		expect(revision("r".repeat(120))).toBe("r".repeat(120));
		expect(revision("   ")).toBeNull();
		expect(revision("")).toBeNull();
		expect(revision(undefined)).toBeNull();
	});

	it("refuses a text that hashes to the newest version, naming its label or its date", () => {
		expect(publish({ text: MSA, sha256: MSA_SHA }, v1)).toEqual({
			refused: "NothingToPublish",
			say: "This text matches m1. Nothing to publish.",
		});
		expect(
			publish({ text: MSA, sha256: MSA_SHA }, { ...v1, version_label: null }),
		).toEqual({
			refused: "NothingToPublish",
			say: "This text matches v2026-10-01. Nothing to publish.",
		});
		expect(
			publish({ text: MSA, sha256: MSA_SHA }, { ...v1, version_label: "" }),
		).toEqual({
			refused: "NothingToPublish",
			say: "This text matches v2026-10-01. Nothing to publish.",
		});
	});

	it("allows the text of an older version", () => {
		expect(
			publish({ text: MSA, sha256: MSA_SHA, expectedVersion: 2 }, v2),
		).toMatchObject({ wrote: { row: { version: 3, text: MSA } } });
	});

	it("refuses a label the kind already uses, naming the kind in capitals", () => {
		expect(publish({ versionLabel: "m1" }, v1, true)).toEqual({
			refused: "LabelUsed",
			say: "m1 is already used for the MSA. Choose another label.",
		});
		expect(
			publish(
				{ kind: "sow", text: `${SOW}\nNew.`, versionLabel: "s1" },
				{ ...v1, kind: "sow" },
				true,
			),
		).toEqual({
			refused: "LabelUsed",
			say: "s1 is already used for the SOW. Choose another label.",
		});
	});

	it("refuses a stale expected version with the generic sentence the raised guard gives today", () => {
		expect(publish({ expectedVersion: 0 }, v1)).toEqual(NOT_SAVED);
		expect(publish({ expectedVersion: 5 }, v1)).toEqual(NOT_SAVED);
		expect(publish({ expectedVersion: 1 }, null)).toEqual(NOT_SAVED);
		expect(publish({ expectedVersion: 1e21 }, null)).toEqual(NOT_SAVED);
	});

	it("answers LabelUsed when it decides again after the label was taken between its read and its batch", () => {
		// golden "the label is taken between the check and the insert": the first read finds the label free, the batch
		// fails on the label's unique index, and the second read finds it used, with the newest version unchanged.
		const race = { expectedVersion: 3, versionLabel: "race" };

		expect(publish(race, v3, false)).toMatchObject({
			wrote: { row: { version: 4, version_label: "race" } },
		});
		expect(publish(race, v3, true)).toEqual({
			refused: "LabelUsed",
			say: "race is already used for the MSA. Choose another label.",
		});
	});

	it("refuses a label without its form", () => {
		expect(publish({ versionLabel: "v 1" })).toEqual({
			refused: "LabelInvalid",
			say: "Use letters, digits, dots and dashes for the version label, up to 40 characters.",
		});
		expect(publish({ versionLabel: "v".repeat(41) })).toMatchObject({
			refused: "LabelInvalid",
		});
		expect(publish({ versionLabel: "2026.11-rc.1" })).toMatchObject({
			wrote: { row: { version_label: "2026.11-rc.1" } },
		});
	});

	// Each condition of a publish, in the order today's code answers: the route's validateTemplate, its confirmation,
	// then publishTemplate's label form, same text, label in use, and the batch's guard.
	const ORDER = [
		["TemplateRefused", { text: "hello" }],
		["NotConfirmed", { confirmed: false }],
		["LabelInvalid", { versionLabel: "v 1" }],
		["NothingToPublish", { sha256: v1.sha256 }],
		["LabelUsed", { labelUsed: true }],
		["VersionChanged", { expectedVersion: 0 }],
	] as const;

	it("answers the first refusal in today's order, for every combination of refusals", () => {
		for (let mask = 0; mask < 2 ** ORDER.length; mask++) {
			const failing = ORDER.filter((_, index) => mask & (1 << index));
			const over = Object.assign({}, ...failing.map(([, change]) => change));
			const { labelUsed = false, ...rest } = over;
			const answer = publish(rest, v1, labelUsed);

			if (failing.length === 0) expect(answer).toHaveProperty("wrote");
			else expect(answer).toMatchObject({ refused: failing[0][0] });
		}
	});

	it("is asked between the reads with the refusals that come before the label's read, in the same order", () => {
		for (let mask = 0; mask < 2 ** 4; mask++) {
			const failing = ORDER.slice(0, 4).filter(
				(_, index) => mask & (1 << index),
			);

			const over = Object.assign({}, ...failing.map(([, change]) => change));
			const answer = said(publishNewText.decide(inputs(over), v1));

			if (failing.length === 0) expect(answer).toEqual({ wrote: {} });
			else expect(answer).toMatchObject({ refused: failing[0][0] });
		}
	});
});

describe("a stored version", () => {
	it("is refused when the kind has no version with that number", () => {
		expect(
			said(findTemplateVersion.decide({ kind: "msa", version: 9 }, null)),
		).toEqual({
			refused: "VersionNotFound",
			say: "That version was not found.",
		});
	});

	it("names the version before it to read", () => {
		expect(
			said(findTemplateVersion.decide({ kind: "msa", version: 2 }, v2)),
		).toEqual({ wrote: { row: v2, previous: { kind: "msa", version: 1 } } });
		expect(
			wrote(findTemplateVersion.decide({ kind: "msa", version: 1 }, v1))
				.previous,
		).toEqual({ kind: "msa", version: 0 });
	});

	it("is shown as stored, with its label or date and its comparison with the version before it", () => {
		const answer = wrote(compareTemplateVersion.decide(v2, v1));

		expect(answer).toEqual({
			version: 2,
			label: "v2026-10-02",
			text: v2.text,
			compare: templateComparison(v1, v2.text),
		});
		expect(answer.compare?.label).toBe("m1");
		expect(Object.keys(answer)).toEqual([
			"version",
			"label",
			"text",
			"compare",
		]);
	});

	it("has no comparison when the version before it is not stored", () => {
		expect(wrote(compareTemplateVersion.decide(v3, null))).toEqual({
			version: 3,
			label: "m3",
			text: v3.text,
			compare: null,
		});
	});

	it("is not validated again, and an empty label falls back to the date", () => {
		const odd = {
			...v1,
			text: "hello <world> [blank] ____",
			version_label: "",
		};

		expect(wrote(compareTemplateVersion.decide(odd, null))).toEqual({
			version: 1,
			label: "v2026-10-01",
			text: "hello <world> [blank] ____",
			compare: null,
		});
	});
});

const CONFIG_VALUES = {
	legal_name: "The Superhuman Group LLC",
	entity_jurisdiction: "Wyoming limited liability company",
	signer_name: "Kazon Wilson",
	signer_title: "Manager",
	notice_email: "Notices@Example.test",
	business_address: "30 N Gould St, Sheridan, WY",
	registered_agent_confirmed: true,
};

/** The values JSON today's route stored for CONFIG_VALUES (golden owner-agreements-config, "the first save is version 1"). */
const STORED_VALUES =
	'{"legal_name":"The Superhuman Group LLC","entity_jurisdiction":"Wyoming limited liability company","signer_name":"Kazon Wilson","signer_title":"Manager","notice_email":"notices@example.test","business_address":"30 N Gould St, Sheridan, WY","registered_agent_confirmed":true}';

const values = parseContractor(CONFIG_VALUES);

const saveConfig = (
	expectedVersion: number,
	newest: { version: number } | null,
	input = values,
) =>
	said(
		saveContractor.decide(
			{ values: input, expectedVersion, at: AT, actor: OWNER },
			newest,
		),
	);

describe("the contractor's details", () => {
	it("are saved as version 1 with the values the reader gave, the time and the owner", () => {
		expect(saveConfig(0, null)).toEqual({
			wrote: {
				row: {
					version: 1,
					values_json: STORED_VALUES,
					created_at: AT,
					created_by: OWNER,
				},
				expectedVersion: 0,
			},
		});
	});

	it("keep the reader's key order whatever the input's order", () => {
		const reversed = parseContractor(
			Object.fromEntries(Object.entries(CONFIG_VALUES).reverse()),
		);

		expect(saveConfig(0, null, reversed)).toMatchObject({
			wrote: { row: { values_json: STORED_VALUES } },
		});
	});

	it("are saved as the version after the newest", () => {
		expect(saveConfig(3, { version: 3 })).toMatchObject({
			wrote: { row: { version: 4 }, expectedVersion: 3 },
		});
	});

	it("are refused when the newest version is not the one the page expected", () => {
		expect(saveConfig(0, { version: 1 })).toEqual(NOT_SAVED);
		expect(saveConfig(5, { version: 1 })).toEqual(NOT_SAVED);
		expect(saveConfig(1, null)).toEqual(NOT_SAVED);
		expect(saveConfig(1e21, null)).toEqual(NOT_SAVED);
	});
});

// The guards that stay as the re-check, on sqlite.

const TEMPLATE_GUARD = `SELECT CASE WHEN COALESCE((SELECT max(version) FROM software_agreement_templates WHERE kind=?),0)=? THEN 1 ELSE json_extract('Template changed','$') END`;

const TEMPLATE_INSERT =
	"INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label,source_revision) VALUES(?,?,?,?,?,?,?,?,?)";

const LABEL_USE =
	"SELECT 1 FROM software_agreement_templates WHERE kind=? AND version_label=? LIMIT 1";

const CONFIG_GUARD = `SELECT CASE WHEN COALESCE((SELECT max(version) FROM software_contractor_config),0)=? THEN 1 ELSE json_extract('Config changed','$') END`;

const CONFIG_INSERT = "INSERT INTO software_contractor_config VALUES(?,?,?,?)";

const NEWEST_CONFIG =
	"SELECT version,values_json FROM software_contractor_config ORDER BY version DESC LIMIT 1";

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	// The two tables as migrations/music/0023_software_signing.sql and 0026_agreement_template_labels.sql make them.
	database.exec(
		`DROP TABLE IF EXISTS software_agreement_templates; DROP TABLE IF EXISTS software_contractor_config;
		CREATE TABLE software_contractor_config (version INTEGER PRIMARY KEY CHECK(version>0), values_json TEXT NOT NULL CHECK(json_valid(values_json)), created_at TEXT NOT NULL, created_by TEXT NOT NULL);
		CREATE TABLE software_agreement_templates (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('msa','sow')), version INTEGER NOT NULL CHECK(version>0), text TEXT NOT NULL CHECK(length(CAST(text AS BLOB))<=102400), sha256 TEXT NOT NULL CHECK(length(sha256)=64), field_schema_version INTEGER NOT NULL DEFAULT 1 CHECK(field_schema_version=1), published_at TEXT NOT NULL, published_by TEXT NOT NULL, UNIQUE(kind,version));
		ALTER TABLE software_agreement_templates ADD COLUMN version_label TEXT;
		ALTER TABLE software_agreement_templates ADD COLUMN source_revision TEXT;
		CREATE UNIQUE INDEX software_agreement_templates_label ON software_agreement_templates(kind,version_label) WHERE version_label IS NOT NULL;`,
	);
});

function storeTemplates(
	rows: readonly { kind: string; version: number; label: string | null }[],
) {
	database.exec("DELETE FROM software_agreement_templates");

	for (const row of rows)
		database
			.prepare(
				"INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label) VALUES(?,?,?,?,?,?,?,?)",
			)
			.run(
				`${row.kind}-${row.version}`,
				row.kind,
				row.version,
				`text ${row.version}`,
				"0".repeat(64),
				"2026-10-01T09:00:00.000Z",
				OWNER,
				row.label,
			);
}

const raises = (work: Promise<unknown>) =>
	work.then(
		() => false,
		() => true,
	);

/** The batch publishTemplate runs today (without its event), with what the rule wrote. */
const publishBatch = (publication: TemplatePublication) =>
	db.batch([
		db.prepare(TEMPLATE_GUARD).bind("msa", publication.expectedVersion),
		db
			.prepare(TEMPLATE_INSERT)
			.bind(
				publication.row.id,
				publication.row.kind,
				publication.row.version,
				publication.row.text,
				publication.row.sha256,
				publication.row.published_at,
				publication.row.published_by,
				publication.row.version_label,
				publication.row.source_revision,
			),
	]);

const VERSION_SETS = [[], [1], [1, 2], [1, 3], [2], [1, 2, 3, 4, 5]];

describe("A22, the publish batch's version guard, and the rule", () => {
	it("refuse exactly together over the kind's stored versions, the other kind's ignored", async () => {
		let refused = 0;

		for (const versions of VERSION_SETS)
			for (const expectedVersion of [0, 1, 2, 3, 4, 5, 6, 1e21]) {
				storeTemplates([
					...versions.map((version) => ({
						kind: "msa",
						version,
						label: null,
					})),
					{ kind: "sow", version: 7, label: null },
				]);

				const current = await currentTemplate(db, "msa");

				const decided = publishTemplate.decide(
					inputs({ expectedVersion, versionLabel: "fresh" }),
					{ current, labelUsed: false },
				);

				const answer = said(decided);

				const guardRaises = await raises(
					db.prepare(TEMPLATE_GUARD).bind("msa", expectedVersion).first(),
				);

				const where = JSON.stringify({ versions, expectedVersion });

				expect("refused" in answer && answer.refused, where).toBe(
					guardRaises ? "VersionChanged" : false,
				);

				if (guardRaises) {
					refused += 1;
					continue;
				}

				const publication = wrote(decided);

				await publishBatch(publication);
				expect(
					database
						.prepare(
							"SELECT id,kind,version,text,sha256,published_at,published_by,version_label,source_revision FROM software_agreement_templates WHERE id=?",
						)
						.get(ID),
					where,
				).toEqual({ ...publication.row });
			}

		expect(refused).toBeGreaterThan(0);
	});
});

describe("the label's unique index and LabelUsed", () => {
	it("fail exactly together: a label the read finds used is refused by the index, and decided again it is LabelUsed", async () => {
		const rows = [
			{ kind: "msa", version: 1, label: "m1" },
			{ kind: "msa", version: 2, label: null },
			{ kind: "msa", version: 3, label: "M1" },
			{ kind: "sow", version: 1, label: "s1" },
		];

		const outcomes: boolean[] = [];

		for (const versionLabel of ["m1", "M1", "s1", "m2", "fresh"]) {
			storeTemplates(rows);

			const current = await currentTemplate(db, "msa");

			const used =
				(await db.prepare(LABEL_USE).bind("msa", versionLabel).first()) !==
				null;

			// The first try, as if the label were still free when it was read.
			const first = wrote(
				publishTemplate.decide(inputs({ expectedVersion: 3, versionLabel }), {
					current,
					labelUsed: false,
				}),
			);

			const failure = await publishBatch(first).then(
				() => null,
				(error: Error) => error.message,
			);

			expect(failure !== null, versionLabel).toBe(used);
			outcomes.push(used);

			if (failure !== null) {
				// Today's recogniser of the lost label (publishTemplate's catch).
				expect(failure).toMatch(/UNIQUE constraint failed.*version_label/);
				expect(
					said(
						publishTemplate.decide(
							inputs({ expectedVersion: 3, versionLabel }),
							{ current: await currentTemplate(db, "msa"), labelUsed: used },
						),
					),
				).toEqual({
					refused: "LabelUsed",
					say: `${versionLabel} is already used for the MSA. Choose another label.`,
				});
			}
		}

		// "m1" and "M1" are used for the MSA; "s1" only for the SOW; "m2" and "fresh" by none.
		expect(outcomes).toEqual([true, true, false, false, false]);
	});
});

function storeConfigs(versions: readonly number[]) {
	database.exec("DELETE FROM software_contractor_config");

	for (const version of versions)
		database
			.prepare("INSERT INTO software_contractor_config VALUES(?,?,?,?)")
			.run(version, "{}", "2026-11-01T00:00:00.000Z", "earlier@example.test");
}

describe("A23, the config batch's version guard, and the rule", () => {
	it("refuse exactly together over the stored versions, and a save the rule allows is stored as written", async () => {
		let refused = 0;

		for (const versions of VERSION_SETS)
			for (const expectedVersion of [0, 1, 2, 3, 4, 5, 6, 1e21]) {
				storeConfigs(versions);

				const newest = await db
					.prepare(NEWEST_CONFIG)
					.first<{ version: number; values_json: string }>();

				const decided = saveContractor.decide(
					{ values, expectedVersion, at: AT, actor: OWNER },
					newest,
				);

				const answer = said(decided);

				const guardRaises = await raises(
					db.prepare(CONFIG_GUARD).bind(expectedVersion).first(),
				);

				const where = JSON.stringify({ versions, expectedVersion });

				expect("refused" in answer && answer.refused, where).toBe(
					guardRaises ? "VersionChanged" : false,
				);

				if (guardRaises) {
					refused += 1;
					continue;
				}

				const { row } = wrote(decided);

				await db.batch([
					db.prepare(CONFIG_GUARD).bind(expectedVersion),
					db
						.prepare(CONFIG_INSERT)
						.bind(row.version, row.values_json, row.created_at, row.created_by),
				]);
				expect(
					database
						.prepare(
							"SELECT version,values_json,created_at,created_by FROM software_contractor_config WHERE version=?",
						)
						.get(row.version),
					where,
				).toEqual({ ...row });
			}

		expect(refused).toBeGreaterThan(0);
	});
});
