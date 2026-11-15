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

// How POST /api/owner/requests/[id]/software answers when its database or R2 fails. The owner's decisions (2026-11-14
// and 2026-11-15, F1 to F4 of docs/plans/2026-11-offers-conversion.md): an unexpected store failure answers 500 with the
// route's fixed sentence and never the error's own text; after the client email went out (or the draft was saved), it
// says so; a missing R2 binding when a send needs it is a known unavailable dependency, 503; a guard that refuses a batch
// (a lost race or a stale page) still answers 409. Real SQLite with the music schema; nothing is mocked.

const FAILED = "The change could not be saved. Please try again.";

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
};

type World = {
	readonly seed: Seed;
	readonly faults?: readonly Fault[];
	readonly race?: Race;
	readonly signing?: boolean;
	/** Leave out to give the route no R2 binding. */
	readonly bucket?: Bucket;
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

	return double<R2Bucket>({
		// SAFETY: get() is overloaded (with and without conditional options), so one function cannot be typed as the member;
		// the route calls get(key) and reads only size and arrayBuffer() of the object, which the double supplies.
		get: (async (key: string) => {
			if (bucket.fails?.includes("get")) throw new Error(SECRET);
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

	const call = (body: JsonObject) =>
		POST(
			partial<APIContext>({
				params: { id: "r1" },
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

beforeEach(() => {
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

describe("a store that fails answers 500 with the fixed sentence, and nothing is emailed", () => {
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
		const { call } = setUp({ seed: rows, faults: [{ on }] });

		const response = await call(body);
		const text = await response.clone().text();

		expect(await read(response)).toEqual(answer(500, FAILED));
		expect(text).not.toContain("D1_ERROR");
		expect(emails()).toEqual([]);
	});

	it("a request whose stored details are not JSON answers 500 too", async () => {
		const { call } = setUp({
			seed: { owner_requests: [request({ details_json: "{bad" })] },
		});

		expect(await read(await call(fit))).toEqual(answer(500, FAILED));
	});

	it("a lookup that fails after a refused batch answers 500", async () => {
		const { call } = setUp({
			seed: plain,
			race: {
				on: /UPDATE owner_requests SET updated_at/,
				sql: "UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
			},
			faults: [{ on: /^SELECT 1 FROM software_projects/, nth: 2 }],
		});

		expect(await read(await call(question))).toEqual(answer(500, FAILED));
		expect(emails()).toEqual([]);
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

		const { status, body } = await read(await call(draft));

		expect(status).toBe(409);
		expect(body).toMatchObject({ updatedAt: "2026-11-13T11:45:00.000Z" });
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

		const { status, body } = await read(
			await call({ ...draft, reusedMsaId: MSA_ID, confirmMsaReuse: true }),
		);

		expect(status).toBe(409);
		expect(body).toMatchObject({ updatedAt: null });
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
		vi.mocked(fetch).mockImplementation(async () =>
			Response.json({ message: "refused" }, { status: 422 }),
		);

		const { sql, call } = setUp({
			seed: withDraft,
			faults: [{ on: /WHERE request_id=\? AND token_hash=\?/ }],
		});

		expect(await read(await call(send))).toEqual(
			answer(500, AFTER_FAILED_EMAIL),
		);
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

	it("a reused MSA and no R2 binding: 503 before the packet is rendered, nothing written", async () => {
		const { sql, call } = setUp({
			signing: true,
			faults: [
				// The preflight's read of the MSA would fail: it is never made.
				{ on: /FROM software_agreements WHERE id=\? AND status='executed'/ },
			],
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
		});

		expect(await read(await call(send))).toEqual(answer(503, NO_STORAGE));
		unsent(sql);
	});

	it("the reused MSA read in the preflight fails: 500", async () => {
		const world = signing();

		const { sql, call } = setUp({
			...world,
			bucket: { objects: { [MSA_PDF_KEY]: PDF_BYTES } },
			faults: [
				{ on: /FROM software_agreements WHERE id=\? AND status='executed'/ },
			],
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
		});

		expect(await read(await call(send))).toEqual(answer(500, FAILED));
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
