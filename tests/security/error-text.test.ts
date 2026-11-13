import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { templateFields } from "~/lib/agreement-templates";
import { POST as agreements } from "~/pages/api/owner/agreements";
import { partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1 } from "../helpers/sqlite-d1";

// Only a sentence the code wrote for the reader may reach a response. Database, parser and runtime messages never do.
// The review and invoice routes are held to the same rule by their golden fixtures (offer-review, owner-request-invoices).

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;
let logged: unknown[][];

beforeEach(() => {
	sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(readFileSync("db/music.sql", "utf8"));
	db = sqliteD1(sql, /^SELECT|RETURNING/);
	logged = [];
	vi.spyOn(console, "error").mockImplementation((...args) => {
		logged.push(args);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const secrets =
	/malformed JSON|FOREIGN KEY|UNIQUE constraint|Cannot read properties|Unexpected token/;

type Body = Record<string, string | number | boolean | undefined>;

const callAgreements = (body: Body, extra: Partial<TestRuntime["env"]> = {}) =>
	agreements(
		partial<APIContext>({
			request: new Request("https://thesuperhuman.us/api/owner/agreements", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://thesuperhuman.us",
				},
				body: JSON.stringify(body),
			}),
			locals: {
				owner: { email: "owner@example.test" },
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>({ MUSIC_DB: db, ...extra }),
				}),
			},
		}),
	);

const template = (kind: "msa" | "sow") =>
	templateFields[kind]
		.filter((f) => !f.startsWith("milestone."))
		.map((f) => `${f}: {{${f}}}`)
		.join("\n") +
	(kind === "sow"
		? "\n{{#milestones}}\n" +
			templateFields.sow
				.filter((f) => f.startsWith("milestone."))
				.map((f) => `${f}: {{${f}}}`)
				.join("\n") +
			"\n{{/milestones}}"
		: "");

const publish = (expectedCurrentVersion: number, versionLabel: string) =>
	callAgreements({
		action: "publish",
		kind: "msa",
		text: `${template("msa")}\n${versionLabel}`,
		expectedCurrentVersion,
		versionLabel,
		confirmed: true,
	});

it("owner agreements answers a stale version with its fixed sentence at 409", async () => {
	expect((await publish(0, "v1")).status).toBe(200);
	const response = await publish(0, "v2");
	const text = await response.text();

	expect(response.status).toBe(409);
	expect(JSON.parse(text)).toEqual({
		ok: false,
		error: "The agreement could not be saved.",
	});
	expect(text).not.toMatch(secrets);
});

it("owner agreements answers a database fault with its fixed sentence at 500 and logs it", async () => {
	sql.exec("DROP TABLE software_agreement_templates");
	const response = await publish(0, "v1");
	const text = await response.text();

	expect(response.status).toBe(500);
	expect(JSON.parse(text)).toEqual({
		ok: false,
		error: "The agreement could not be saved.",
	});
	expect(text).not.toMatch(/no such table|SQLITE/);
	// The log says what failed, so an outage can be diagnosed; the response does not.
	expect(JSON.stringify(logged)).toMatch(/no such table/);
	expect(logged).toHaveLength(1);
});

it("owner agreements keeps a template sentence word for word", async () => {
	const response = await callAgreements({
		action: "preview",
		kind: "msa",
		text: "Nothing to fill in here.",
		expectedCurrentVersion: 0,
	});

	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		ok: false,
		error: expect.stringMatching(/^Missing required fields: /),
	});
});

it("retention apply with no manifest answers the stale-review sentence, not a JavaScript error", async () => {
	const response = await callAgreements(
		{ action: "retention-apply", confirmed: true },
		{ AUDIO: partial<R2Bucket>({}), AGREEMENT_RETENTION_BINDING_ID: "binding" },
	);

	const text = await response.text();

	expect(response.status).toBe(409);
	expect(JSON.parse(text)).toEqual({
		ok: false,
		error: "Review is stale or belongs to different storage.",
	});
	expect(text).not.toMatch(secrets);
});
