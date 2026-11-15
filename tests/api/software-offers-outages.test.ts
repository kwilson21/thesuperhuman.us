import type { APIContext } from "astro";
import type { SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	ATTACHMENT_KEY,
	attachment,
	attachmentRow,
	details,
	EARLIER,
	executedMsa,
	linkAgo,
	liveLink,
	MSA_ID,
	MSA_PDF_KEY,
	offer,
	PDF_BYTES,
	readyArtifact,
	request,
	signingBase,
	terms,
} from "../golden/areas/software-offers";
import { freshMusicDb, seed, START, type Seed } from "../golden/harness";
import { boundStatement, preparedStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import { testRuntime } from "../helpers/runtime";
import { sqliteD1, type SqliteDatabase } from "../helpers/sqlite-d1";

// How POST /api/owner/requests/[id]/software answers when its database, R2 or mail settings fail it, when the id is
// missing, and when a send's link closes while its email fails. The owner's decisions (2026-11-14 and 2026-11-15, F1 to
// F4, F6, F8 and F9 of docs/plans/2026-11-offers-conversion.md): an unexpected store failure answers 500 with the route's
// fixed sentence and never the error's own text, and is logged once; after the client email went out (or the draft was
// saved), it says so; a missing R2 binding when a send needs it, or mail that is not configured for a question or a
// decline, is a known unavailable dependency, 503, with nothing written; a guard that refuses a batch (a lost race or a
// stale page) still answers 409. Real SQLite with the music schema; nothing is mocked.

const FAILED = "The change could not be saved. Please try again.";

const NO_MAIL =
	"Email isn’t configured. Check RESEND_API_KEY, CONTACT_FROM_EMAIL and OWNER_EMAIL. Nothing was sent or saved.";

const NO_STORAGE =
	"Attachment storage isn’t configured. Check the AUDIO binding. Nothing was sent.";

const AFTER_EMAIL =
	"The email was sent, but saving failed. Reload before you try again.";

const CHECK_AFTER_EMAIL =
	"The email was sent, but the link could not be checked. Reload before you try again.";

const AFTER_FAILED_EMAIL =
	"The offer was saved, but the email may not have been sent and the link could not be checked. Reload before you try again.";

const AFTER_DRAFT =
	"The draft was saved, but an attachment could not be cleaned up. Reload before you try again.";

/** The error text the database gives; no answer may carry it. */
const SECRET = "D1_ERROR: private details for r1";

/** A statement or batch whose SQL matches `on` fails on its `nth` match (the first by default). */
type Fault = { readonly on: RegExp; readonly nth?: number };

/** SQL run on the database just before the first statement or batch whose SQL matches `on`: another writer. */
type Race = { readonly on: RegExp; readonly sql: string };

type Bucket = {
	readonly objects?: Readonly<Record<string, Uint8Array>>;
	readonly fails?: readonly ("get" | "delete")[];
	/** get() rejects from its n-th call on (the calls before it answer). */
	readonly getFailsFrom?: number;
};

type World = {
	readonly seed: Seed;
	readonly faults?: readonly Fault[];
	readonly race?: Race;
	readonly signing?: boolean;
	/** Leave out to give the route no R2 binding. */
	readonly bucket?: Bucket;
	/** The route's params; { id: "r1" } unless given. */
	readonly params?: Readonly<Record<string, string>>;
	/** Mail settings to leave out. */
	readonly omit?: readonly (
		| "RESEND_API_KEY"
		| "CONTACT_FROM_EMAIL"
		| "OWNER_EMAIL"
	)[];
	/** The status Resend answers each email with, in order; 200 past the end. */
	readonly mail?: readonly number[];
};

/** Counts each fault's matches and says whether one of them is due on these statements. */
function faultsFor(faults: readonly Fault[]) {
	const seen = new Map<Fault, number>();

	return (queries: readonly string[]) => {
		let due = false;

		for (const fault of faults) {
			if (!queries.some((query) => fault.on.test(query))) continue;
			const count = (seen.get(fault) ?? 0) + 1;
			seen.set(fault, count);

			if (count === (fault.nth ?? 1)) due = true;
		}

		return due;
	};
}

function faultyDb(sql: SqliteDatabase, world: World): D1Database {
	const real = sqliteD1(sql);
	const due = faultsFor(world.faults ?? []);
	let raced = false;

	const before = (queries: readonly string[]) => {
		if (
			world.race &&
			!raced &&
			queries.some((query) => world.race?.on.test(query))
		) {
			raced = true;
			sql.exec(world.race.sql);
		}

		if (due(queries)) throw new Error(SECRET);
	};

	const members = (query: string, args: SQLInputValue[]) => {
		const inner = real.prepare(query).bind(...args);

		return {
			// SAFETY: first() is generic over the row type, so a non-generic function cannot be typed as the member; the double
			// returns what the real statement returns, and the route names the row type itself.
			first: (async () => {
				before([query]);

				return inner.first();
			}) as D1PreparedStatement["first"],
			// SAFETY: as for first(): all() is generic over the row type, and the double returns what the real statement does.
			all: (async () => {
				before([query]);

				return inner.all();
			}) as D1PreparedStatement["all"],
			// SAFETY: as for first().
			run: (async () => {
				before([query]);

				return inner.run();
			}) as D1PreparedStatement["run"],
		};
	};

	return double<D1Database>({
		prepare: (query: string) => preparedStatement(query, [], members),
		batch: async <T>(items: D1PreparedStatement[]) => {
			before(items.map((item) => boundStatement(item).query));

			return real.batch<T>(items);
		},
	});
}

function r2(bucket: Bucket): R2Bucket {
	const objects = new Map(Object.entries(bucket.objects ?? {}));
	let gets = 0;

	return double<R2Bucket>({
		// SAFETY: get() is overloaded (with and without conditional options), so one function cannot be typed as the member;
		// the route calls get(key) and reads only size and arrayBuffer() of the object, which the double supplies.
		get: (async (key: string) => {
			gets += 1;

			if (
				bucket.fails?.includes("get") ||
				gets >= (bucket.getFailsFrom ?? Number.POSITIVE_INFINITY)
			)
				throw new Error(SECRET);
			const bytes = objects.get(key);

			return bytes
				? partial<R2ObjectBody>({
						size: bytes.byteLength,
						arrayBuffer: async () => bytes.slice().buffer,
					})
				: null;
		}) as R2Bucket["get"],
		delete: async (key: string | string[]) => {
			if (bucket.fails?.includes("delete")) throw new Error(SECRET);

			for (const one of [key].flat()) objects.delete(one);
		},
	});
}

function setUp(world: World) {
	const sql = freshMusicDb();
	seed(sql, world.seed);

	if (world.signing)
		sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1");

	const env = {
		MUSIC_DB: faultyDb(sql, world),
		AUDIO: world.bucket ? r2(world.bucket) : undefined,
		SITE_ORIGIN: "https://thesuperhuman.us",
		RESEND_API_KEY: "resend-key",
		CONTACT_FROM_EMAIL: "site@example.test",
		OWNER_EMAIL: "owner@example.test",
	};

	for (const name of world.omit ?? []) Reflect.deleteProperty(env, name);

	const answers = [...(world.mail ?? [])];

	vi.mocked(fetch).mockImplementation(async () =>
		Response.json({ id: "em_1" }, { status: answers.shift() ?? 200 }),
	);

	const call = (body: JsonObject) =>
		POST(
			partial<APIContext>({
				params: world.params ?? { id: "r1" },
				request: new Request(
					"https://thesuperhuman.us/api/owner/requests/r1/software",
					{
						method: "POST",
						headers: {
							origin: "https://thesuperhuman.us",
							"content-type": "application/json",
						},
						body: JSON.stringify(body),
					},
				),
				locals: partial<APIContext["locals"]>({
					owner: { email: "owner@example.test" },
					runtime: testRuntime(env),
				}),
			}),
		);

	return { sql, call };
}

const emails = () =>
	vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("resend"));

/** The lines the route logged through console.error (silenced in every test). */
const logs = () => vi.mocked(console.error).mock.calls;

/** The one line a failed store logs: the route, and the error the database or R2 gave. */
const LOGGED = [
	"/api/owner/requests/[id]/software failed unexpectedly:",
	"Error",
	SECRET,
];

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ id: "em_1" })),
	);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(START));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** The answer's status and body, and whether it is private. */
async function read(response: Response) {
	return {
		status: response.status,
		body: await response.json(),
		private: response.headers.get("cache-control") === "private, no-store",
	};
}

const answer = (status: number, message: string) => ({
	status,
	body: { ok: false, message },
	private: true,
});

const fit: JsonObject = { action: "fit", label: "potential-fit", note: "x" };
const question: JsonObject = { action: "question", text: "Which users?" };
const decline: JsonObject = { action: "decline", text: "Not a fit." };

const revoke: JsonObject = {
	action: "revoke",
	expectedLinkCreatedAt: EARLIER,
};

const draft: JsonObject = {
	action: "draft",
	terms: terms(),
	expectedUpdatedAt: null,
};

const send: JsonObject = {
	action: "send",
	version: 1,
	expectedUpdatedAt: EARLIER,
};

const plain: Seed = { owner_requests: [request()] };

const withSent: Seed = {
	owner_requests: [request()],
	software_offers: [offer("sent")],
	software_offer_links: [liveLink()],
};

const withDraft: Seed = {
	owner_requests: [request()],
	software_offers: [offer("draft")],
};

/** Signing on, and a draft that reuses an executed MSA from another offer, with its signed copy in R2. */
const reusing = (over: Partial<World> = {}): World => ({
	signing: true,
	bucket: { objects: { [MSA_PDF_KEY]: PDF_BYTES } },
	seed: {
		...signingBase(),
		owner_requests: [request()],
		software_agreements: [executedMsa()],
		software_agreement_artifacts: [readyArtifact()],
		software_offers: [
			offer("draft", 1, {
				agreement_details_json: JSON.stringify(details()),
				reused_msa_id: MSA_ID,
			}),
		],
	},
	...over,
});

/** Every table an action of this route writes, row by row. */
const written = (sql: SqliteDatabase) =>
	Object.fromEntries(
		[
			"owner_requests",
			"owner_request_audit",
			"software_fit_reviews",
			"software_offers",
			"software_offer_links",
			"software_agreement_attachments",
		].map((table) => [table, sql.prepare(`SELECT * FROM ${table}`).all()]),
	);

describe("a store that fails answers 500 with the fixed sentence, and nothing is written or emailed", () => {
	it.each<[string, JsonObject, Seed, RegExp]>([
		["fit: the first read", fit, plain, /FROM owner_requests WHERE id=\?/],
		["fit: the batch", fit, plain, /INSERT INTO software_fit_reviews/],
		[
			"question: the project pre-check",
			question,
			plain,
			/^SELECT 1 FROM software_projects/,
		],
		[
			"question: the reservation batch",
			question,
			plain,
			/UPDATE owner_requests SET updated_at/,
		],
		["decline: the deposit read", decline, withSent, /FROM software_invoices/],
		[
			"decline: the sending read",
			decline,
			withSent,
			/^SELECT 1 FROM software_offer_links/,
		],
		[
			"decline: the first batch",
			decline,
			withSent,
			/UPDATE software_offers SET status='withdrawn'/,
		],
		[
			"revoke: the batch",
			revoke,
			withSent,
			/UPDATE software_offer_links SET revoked_at/,
		],
		["draft: the offers read", draft, plain, /^SELECT \* FROM software_offers/],
		["draft: the batch", draft, plain, /INSERT INTO software_offers/],
		[
			"send: the signing setting read",
			send,
			withDraft,
			/FROM software_signing_settings/,
		],
		["send: the batch", send, withDraft, /INSERT INTO software_offer_links/],
	])("%s", async (_name, body, rows, on) => {
		const { sql, call } = setUp({ seed: rows, faults: [{ on }] });
		const before = written(sql);

		const response = await call(body);
		const text = await response.clone().text();

		expect(await read(response)).toEqual(answer(500, FAILED));
		expect(text).not.toContain("D1_ERROR");
		expect(emails()).toEqual([]);
		expect(written(sql)).toEqual(before);
		expect(logs()).toEqual([LOGGED]);
	});

	it("a request whose stored details are not JSON answers 500 too", async () => {
		const { sql, call } = setUp({
			seed: { owner_requests: [request({ details_json: "{bad" })] },
		});

		const before = written(sql);

		expect(await read(await call(fit))).toEqual(answer(500, FAILED));
		expect(written(sql)).toEqual(before);
	});

	it("a lookup that fails after a refused batch answers 500", async () => {
		const { sql, call } = setUp({
			seed: plain,
			race: {
				on: /UPDATE owner_requests SET updated_at/,
				sql: "UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
			},
			faults: [{ on: /^SELECT 1 FROM software_projects/, nth: 2 }],
		});

		const before = written(sql);

		expect(await read(await call(question))).toEqual(answer(500, FAILED));
		expect(emails()).toEqual([]);
		// The race's own change is the only one: the refused batch wrote nothing.
		expect(written(sql)).toEqual({
			...before,
			owner_requests: [
				{
					...before.owner_requests[0],
					updated_at: "2026-11-13T11:30:00.000Z",
				},
			],
		});
	});
});

describe("a refused guard still answers 409", () => {
	it("fit: another change moved the request", async () => {
		const { call } = setUp({
			seed: plain,
			race: {
				on: /INSERT INTO software_fit_reviews/,
				sql: "UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
			},
		});

		expect(await read(await call(fit))).toEqual(
			answer(
				409,
				"The request changed or could not be saved. Reload and try again.",
			),
		);
	});

	it("draft: another tab saved a draft first (a unique index)", async () => {
		const { call } = setUp({
			seed: plain,
			race: {
				on: /INSERT INTO software_offers/,
				sql: `INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('other','r1',1,'draft','{}','${EARLIER}','2026-11-13T11:45:00.000Z')`,
			},
		});

		expect(await read(await call(draft))).toMatchObject({
			status: 409,
			body: { ok: false, updatedAt: "2026-11-13T11:45:00.000Z" },
			private: true,
		});
	});

	it("draft: the reused MSA was deleted before the batch (a foreign key, with the MSA gone)", async () => {
		const { call } = setUp({
			seed: {
				owner_requests: [request()],
				...signingBase(),
				software_agreements: [executedMsa()],
			},
			race: {
				on: /INSERT INTO software_offers/,
				sql: "DELETE FROM software_agreements",
			},
		});

		expect(
			await read(
				await call({ ...draft, reusedMsaId: MSA_ID, confirmMsaReuse: true }),
			),
		).toMatchObject({
			status: 409,
			body: { ok: false, updatedAt: null },
			private: true,
		});
	});

	it("revoke: the link changed (the lookups after the batch answer)", async () => {
		const { call } = setUp({ seed: withSent });

		expect(
			await read(await call({ ...revoke, expectedLinkCreatedAt: START })),
		).toEqual(
			answer(
				409,
				"The client link changed since this page loaded. Reload to see the current link.",
			),
		);
	});
});

describe("after the client email went out, a failure says so", () => {
	it("question: the recording batch fails", async () => {
		const { sql, call } = setUp({
			seed: plain,
			faults: [{ on: /INSERT INTO owner_request_audit/ }],
		});

		expect(await read(await call(question))).toEqual(answer(500, AFTER_EMAIL));
		expect(emails()).toHaveLength(2);
		expect(sql.prepare("SELECT action FROM owner_request_audit").all()).toEqual(
			[],
		);
	});

	it("question: the recording batch is refused and the lookup after it fails", async () => {
		const { call } = setUp({
			seed: plain,
			race: {
				on: /INSERT INTO owner_request_audit/,
				sql: "UPDATE owner_requests SET updated_at='2026-11-13T12:00:30.000Z'",
			},
			faults: [{ on: /^SELECT 1 FROM software_projects/, nth: 2 }],
		});

		expect(await read(await call(question))).toEqual(answer(500, AFTER_EMAIL));
		expect(emails()).toHaveLength(2);
	});

	it("decline: the second batch fails", async () => {
		const { sql, call } = setUp({
			seed: withSent,
			faults: [{ on: /UPDATE owner_requests SET status='resolved'/ }],
		});

		expect(await read(await call(decline))).toEqual(answer(500, AFTER_EMAIL));
		expect(emails()).toHaveLength(2);
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "withdrawn",
		});
	});

	it("send: the live-link check after the email fails", async () => {
		const { sql, call } = setUp({
			seed: withDraft,
			faults: [{ on: /WHERE request_id=\? AND token_hash=\?/ }],
		});

		expect(await read(await call(send))).toEqual(
			answer(500, CHECK_AFTER_EMAIL),
		);
		expect(emails()).toHaveLength(2);
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "sent",
		});
	});

	it("send: the live-link check fails after the client email failed", async () => {
		const { sql, call } = setUp({
			seed: withDraft,
			mail: [422],
			faults: [{ on: /WHERE request_id=\? AND token_hash=\?/ }],
		});

		expect(await read(await call(send))).toEqual(
			answer(500, AFTER_FAILED_EMAIL),
		);
		// The client email was refused, so no copy was sent.
		expect(emails()).toHaveLength(1);
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "sent",
		});
	});

	it("draft: a failed R2 delete whose metadata cannot be put back", async () => {
		const { sql, call } = setUp({
			seed: {
				owner_requests: [request()],
				software_agreement_attachments: [attachmentRow()],
			},
			bucket: { objects: { [ATTACHMENT_KEY]: PDF_BYTES }, fails: ["delete"] },
			faults: [{ on: /INSERT OR IGNORE INTO software_agreement_attachments/ }],
		});

		expect(
			await read(
				await call({ ...draft, removedAttachmentKeys: [ATTACHMENT_KEY] }),
			),
		).toEqual(answer(500, AFTER_DRAFT));
		expect(
			sql.prepare("SELECT version,status FROM software_offers").all(),
		).toEqual([{ version: 1, status: "draft" }]);
	});
});

describe("signing: preparing the agreement", () => {
	const signing = (over: Partial<World> = {}): World => ({
		signing: true,
		bucket: { objects: { [ATTACHMENT_KEY]: PDF_BYTES } },
		seed: {
			...signingBase(),
			owner_requests: [request()],
			software_agreement_attachments: [attachmentRow()],
			software_offers: [
				offer("draft", 1, {
					agreement_details_json: JSON.stringify(
						details({ attachments: [attachment()] }),
					),
				}),
			],
		},
		...over,
	});

	const unsent = (sql: SqliteDatabase) => {
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "draft",
		});
		expect(
			sql.prepare("SELECT count(*) AS links FROM software_offer_links").get(),
		).toEqual({ links: 0 });
		expect(emails()).toEqual([]);
	};

	it.each<[string, RegExp]>([
		["a template read", /FROM software_agreement_templates WHERE kind=\?/],
		["the contractor read", /FROM software_contractor_config/],
		[
			"the attachment metadata read",
			/^SELECT 1 FROM software_agreement_attachments/,
		],
	])("%s fails: 500", async (_name, on) => {
		const { sql, call } = setUp(signing({ faults: [{ on }] }));

		expect(await read(await call(send))).toEqual(answer(500, FAILED));
		unsent(sql);
	});

	it("an attachment's R2 read throws: 500", async () => {
		const { sql, call } = setUp(
			signing({ bucket: { objects: {}, fails: ["get"] } }),
		);

		expect(await read(await call(send))).toEqual(answer(500, FAILED));
		unsent(sql);
	});

	it("no R2 binding: 503, nothing written", async () => {
		const { sql, call } = setUp(signing({ bucket: undefined }));

		expect(await read(await call(send))).toEqual(answer(503, NO_STORAGE));
		unsent(sql);
	});

	it("a reused MSA with its signed copy in R2 is sent", async () => {
		const { sql, call } = setUp(reusing());

		expect(await read(await call(send))).toMatchObject({
			status: 200,
			body: { ok: true, emailSent: true },
			private: true,
		});
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "sent",
		});
	});

	it.each<[string, Partial<World>]>([
		[
			"the reused MSA read",
			{
				faults: [
					{ on: /FROM software_agreements WHERE id=\? AND status='executed'/ },
				],
			},
		],
		[
			"the signed MSA's artifact read",
			{
				faults: [
					{ on: /SELECT pdf_key,pdf_sha256 FROM software_agreement_artifacts/ },
				],
			},
		],
		[
			"the signed MSA's R2 read",
			{ bucket: { objects: { [MSA_PDF_KEY]: PDF_BYTES }, fails: ["get"] } },
		],
	])("%s in the preflight fails: 500", async (_name, over) => {
		const { sql, call } = setUp(reusing(over));

		expect(await read(await call(send))).toEqual(answer(500, FAILED));
		unsent(sql);
	});

	it("an attachment's R2 read in the preflight fails after the route's own read passed: 500", async () => {
		const { sql, call } = setUp(
			signing({
				bucket: { objects: { [ATTACHMENT_KEY]: PDF_BYTES }, getFailsFrom: 2 },
			}),
		);

		expect(await read(await call(send))).toEqual(answer(500, FAILED));
		unsent(sql);
	});

	it("a signed MSA missing from R2 is still incomplete details: 400", async () => {
		const { sql, call } = setUp(reusing({ bucket: { objects: {} } }));

		expect(await read(await call(send))).toEqual(
			answer(400, "Complete and validate Agreement details before sending."),
		);
		unsent(sql);
	});

	it("a reused MSA and no R2 binding: 503 before the packet is rendered, nothing written", async () => {
		const { sql, call } = setUp(
			reusing({
				bucket: undefined,
				// The preflight's read of the MSA would fail: it is never made.
				faults: [
					{ on: /FROM software_agreements WHERE id=\? AND status='executed'/ },
				],
			}),
		);

		expect(await read(await call(send))).toEqual(answer(503, NO_STORAGE));
		unsent(sql);
	});

	it("an attachment missing from R2 is still incomplete details: 400", async () => {
		const { sql, call } = setUp(signing({ bucket: { objects: {} } }));

		expect(await read(await call(send))).toEqual(
			answer(400, "Complete and validate Agreement details before sending."),
		);
		unsent(sql);
	});
});

describe("a link made in the last 20 seconds", () => {
	it("revoke still answers that the offer is sending", async () => {
		const { call } = setUp({
			seed: {
				owner_requests: [request()],
				software_offers: [offer("sent")],
				software_offer_links: [linkAgo(10)],
			},
		});

		expect(
			await read(
				await call({
					...revoke,
					expectedLinkCreatedAt: new Date(
						Date.parse(START) - 10_000,
					).toISOString(),
				}),
			),
		).toEqual(
			answer(409, "An offer is still being sent. Try again in a moment."),
		);
	});
});

describe("a missing or empty id answers as an unknown id does", () => {
	it.each<[string, Readonly<Record<string, string>>]>([
		["no id", {}],
		["an empty id", { id: "" }],
		["an unknown id", { id: "nope" }],
	])("%s: 404", async (_name, params) => {
		const { call } = setUp({ seed: plain, params });

		expect(await read(await call(fit))).toEqual({
			status: 404,
			body: { ok: false },
			private: true,
		});
	});
});

describe("a question or a decline with mail not configured answers 503 and writes nothing", () => {
	it.each<
		[
			string,
			JsonObject,
			"RESEND_API_KEY" | "CONTACT_FROM_EMAIL" | "OWNER_EMAIL",
		]
	>([
		["question, no Resend key", question, "RESEND_API_KEY"],
		["question, no sender address", question, "CONTACT_FROM_EMAIL"],
		["question, no owner address", question, "OWNER_EMAIL"],
		["decline, no Resend key", decline, "RESEND_API_KEY"],
		["decline, no sender address", decline, "CONTACT_FROM_EMAIL"],
		["decline, no owner address", decline, "OWNER_EMAIL"],
	])("%s", async (_name, body, setting) => {
		const { sql, call } = setUp({ seed: withSent, omit: [setting] });

		expect(await read(await call(body))).toEqual(answer(503, NO_MAIL));
		expect(sql.prepare("SELECT updated_at FROM owner_requests").get()).toEqual({
			updated_at: EARLIER,
		});
		expect(
			sql.prepare("SELECT count(*) AS rows FROM owner_request_audit").get(),
		).toEqual({ rows: 0 });
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "sent",
		});
		expect(
			sql.prepare("SELECT revoked_at FROM software_offer_links").get(),
		).toEqual({ revoked_at: null });
		expect(emails()).toEqual([]);
	});
});

describe("a send whose link closes while its email is sent", () => {
	const closing: Race = {
		on: /WHERE request_id=\? AND token_hash=\?/,
		sql: `UPDATE software_offer_links SET revoked_at='${START}'`,
	};

	it.each<[string, readonly number[]]>([
		["the client email is refused", [422]],
		["Resend fails on the client email", [503]],
	])(
		"%s: 409, and the answer does not say the email went out",
		async (_name, mail) => {
			const { call } = setUp({ seed: withDraft, mail, race: closing });

			expect(await read(await call(send))).toEqual(
				answer(
					409,
					"The link was closed while the offer was being sent. Send the offer again for a working link.",
				),
			);
		},
	);

	it("an accepted email keeps its own sentence", async () => {
		const { call } = setUp({ seed: withDraft, race: closing });

		expect(await read(await call(send))).toEqual(
			answer(
				409,
				"The email went out, but the link was closed while it was sending. Send the offer again for a working link.",
			),
		);
	});
});

describe("what failed is logged once, and never answered", () => {
	it.each<[string, World, JsonObject, string]>([
		[
			"a batch that fails",
			{ seed: plain, faults: [{ on: /INSERT INTO software_fit_reviews/ }] },
			fit,
			FAILED,
		],
		[
			"a record that fails after the email",
			{ seed: plain, faults: [{ on: /INSERT INTO owner_request_audit/ }] },
			question,
			AFTER_EMAIL,
		],
		[
			"a lookup that fails after a refused batch (the refusal is not logged)",
			{
				seed: plain,
				race: {
					on: /UPDATE owner_requests SET updated_at/,
					sql: "UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
				},
				faults: [{ on: /^SELECT 1 FROM software_projects/, nth: 2 }],
			},
			question,
			FAILED,
		],
		[
			"a read in the preflight that fails (the rejection itself, not its name)",
			reusing({
				faults: [
					{ on: /SELECT pdf_key,pdf_sha256 FROM software_agreement_artifacts/ },
				],
			}),
			send,
			FAILED,
		],
	])("%s", async (_name, world, body, sentence) => {
		const { call } = setUp(world);

		expect(await read(await call(body))).toEqual(answer(500, sentence));
		expect(logs()).toEqual([LOGGED]);
	});

	it.each<[string, World, JsonObject, number]>([
		[
			"a refused guard",
			{
				seed: plain,
				race: {
					on: /INSERT INTO software_fit_reviews/,
					sql: "UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
				},
			},
			fit,
			409,
		],
		[
			"a send that needs R2 with no R2 binding",
			reusing({ bucket: undefined }),
			send,
			503,
		],
	])("%s logs nothing", async (_name, world, body, status) => {
		const { call } = setUp(world);

		expect(await read(await call(body))).toMatchObject({
			status,
			body: { ok: false },
			private: true,
		});
		expect(logs()).toEqual([]);
	});
});
