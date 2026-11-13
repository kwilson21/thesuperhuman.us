import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { templateFields } from "~/lib/agreement-templates";

// Only a sentence the code wrote for the reader may reach a response. Database, parser and runtime messages never do.

const hoisted = vi.hoisted(() => ({
	reviewAgreements: vi.fn(),
	saveAgreementDraft: vi.fn(),
	reserveSoftwareInvoice: vi.fn(),
}));

vi.mock("~/lib/agreement-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/agreement-access")>()),
	agreementSession: async () => ({
		token_hash: "t",
		csrf_nonce: "n",
		recipient_email: "a@example.test",
		link_hash: "l",
	}),
	signingEnabled: async () => true,
}));

vi.mock("~/lib/software-offers", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/software-offers")>()),
	getLinkedOffer: async () => ({ id: "o1" }),
}));

vi.mock("~/lib/agreement-draft-fields", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/agreement-draft-fields")>()),
	resolveClientDetails: () => ({ ok: true, client: {} }),
}));

vi.mock("~/lib/agreement-draft", () => ({
	saveAgreementDraft: hoisted.saveAgreementDraft,
}));

vi.mock("~/lib/software-agreements", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/software-agreements")>()),
	reviewAgreements: hoisted.reviewAgreements,
}));

vi.mock("~/lib/software-invoices", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/software-invoices")>()),
	reserveSoftwareInvoice: hoisted.reserveSoftwareInvoice,
}));

vi.mock("~/lib/stripe-invoicing", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/stripe-invoicing")>()),
	stripeAvailable: () => true,
}));

const { POST: review } = await import("~/pages/api/offer/[token]/review");
const { POST: invoices } = await import(
	"~/pages/api/owner/requests/[id]/invoices"
);
const { POST: agreements } = await import("~/pages/api/owner/agreements");
const { ReaderMessage } = await import("~/lib/reader-message");

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
	hoisted.reviewAgreements.mockReset();
	hoisted.saveAgreementDraft.mockReset();
	hoisted.reserveSoftwareInvoice.mockReset();
});

const json = (url: string, body: unknown) =>
	new Request(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://thesuperhuman.us",
		},
		body: JSON.stringify(body),
	});

const env = (extra: Partial<TestRuntime["env"]> = {}) =>
	partial<TestRuntime["env"]>({
		MUSIC_DB: db,
		AUDIO_CLIENT_PORTAL_ENABLED: "true",
		...extra,
	});

const callReview = () =>
	review(
		partial<APIContext>({
			request: json("https://thesuperhuman.us/api/offer/tok/review", {
				csrf_nonce: "n",
				values: {},
			}),
			params: { token: "tok" },
			locals: { runtime: partial<TestRuntime>({ env: env() }) },
		}),
	);

const callInvoices = () =>
	invoices(
		partial<APIContext>({
			request: json("https://thesuperhuman.us/api/owner/requests/r1/invoices", {
				offer_id: "o1",
				milestone_index: 0,
				kind: "deposit",
				allow_card: true,
			}),
			params: { id: "r1" },
			locals: {
				owner: { email: "owner@example.test" },
				runtime: partial<TestRuntime>({ env: env() }),
			},
		}),
	);

const callAgreements = (
	body: unknown,
	extra: Partial<TestRuntime["env"]> = {},
) =>
	agreements(
		partial<APIContext>({
			request: json("https://thesuperhuman.us/api/owner/agreements", body),
			locals: {
				owner: { email: "owner@example.test" },
				runtime: partial<TestRuntime>({ env: env(extra) }),
			},
		}),
	);

const guardError = () =>
	new Error("D1_ERROR: malformed JSON: SQLITE_ERROR", {
		cause: new Error("malformed JSON"),
	});

const secrets =
	/malformed JSON|FOREIGN KEY|UNIQUE constraint|Cannot read properties|Unexpected token/;

it("review keeps a sentence the code wrote for the client, word for word", async () => {
	hoisted.reviewAgreements.mockRejectedValue(
		new ReaderMessage("The reviewed documents changed. Review them again."),
	);
	const response = await callReview();

	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		ok: false,
		error: "The reviewed documents changed. Review them again.",
	});
});

it.each([
	["a stale guard", guardError(), 409],
	["a database error", new Error("FOREIGN KEY constraint failed"), 500],
	["a unique violation", new Error("UNIQUE constraint failed: t.c"), 500],
	[
		"a JavaScript error",
		new TypeError("Cannot read properties of undefined"),
		500,
	],
	[
		"a parser error",
		new SyntaxError("Unexpected token } in JSON at position 3"),
		500,
	],
])("review answers its fixed sentence for %s", async (_name, error, status) => {
	hoisted.reviewAgreements.mockRejectedValue(error);
	const response = await callReview();
	const text = await response.text();

	expect(response.status).toBe(status);
	expect(JSON.parse(text)).toEqual({
		ok: false,
		error: "The agreement could not be reviewed.",
	});
	expect(text).not.toMatch(secrets);
});

it("review logs an unexpected fault without its message", async () => {
	hoisted.reviewAgreements.mockRejectedValue(
		new Error("FOREIGN KEY constraint failed"),
	);
	await callReview();

	expect(logged).toHaveLength(1);
	expect(JSON.stringify(logged)).not.toMatch(secrets);
});

it("invoices keeps a reservation sentence and hides database text", async () => {
	hoisted.reserveSoftwareInvoice.mockRejectedValueOnce(
		new ReaderMessage("This installment is already paid."),
	);
	const refused = await callInvoices();

	expect(refused.status).toBe(409);
	expect(await refused.json()).toEqual({
		ok: false,
		error: "This installment is already paid.",
	});

	hoisted.reserveSoftwareInvoice.mockRejectedValueOnce(guardError());
	const stale = await callInvoices();

	expect(stale.status).toBe(409);
	expect(await stale.json()).toEqual({
		ok: false,
		error: "Could not reserve invoice.",
	});

	hoisted.reserveSoftwareInvoice.mockRejectedValueOnce(
		new Error("FOREIGN KEY constraint failed"),
	);
	const fault = await callInvoices();
	const text = await fault.text();

	expect(fault.status).toBe(500);
	expect(JSON.parse(text)).toEqual({
		ok: false,
		error: "Could not reserve invoice.",
	});
	expect(text).not.toMatch(secrets);
});

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
	expect(JSON.stringify(logged)).not.toMatch(/no such table|SQLITE/);
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
