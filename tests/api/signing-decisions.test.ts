import { describe, expect, it } from "vitest";
import { POST as LINK } from "~/pages/api/offer/[token]/link";
import { POST as REVIEW } from "~/pages/api/offer/[token]/review";
import { isObject, isText } from "~/lib/type-guards";
import {
	asVisitor,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
	type Interleave,
} from "../golden/harness";
import type { Recorded } from "../golden/harness/plain";
import * as access from "../golden/areas/agreement-access";

// The decisions the signing link and the review took from a guard or a unique index of their batch, after behaviour fix
// B7 of docs/plans/2026-11-signing-conversion.md and the owner's answer to its Q1 (2026-11-23, "The real reason"):
//
// - The signing link reads what its batch's two guards re-check just before each try of the batch, and decides
//   (src/server/flows/signing-link.ts): signing off is 404 "Website signing is off.", an offer no longer open for signing
//   404 "This offer is unavailable for signing.", a link issued in the last 30 seconds the 429. When a guard raises (the
//   state changed after the read), it reads and decides again, three batches in all, and a third raise is the 429, as
//   before. A refusal the first read finds runs no batch.
// - The review reads and decides again when its batch loses the one pending MSA per client and template, or the client
//   row it chose (a foreign key failure with the evidence read after it), three tries in all; a third such failure is
//   the 409 "The agreement could not be reviewed.", as before.
//
// Each case runs on the golden harness: the real schema on SQLite, another request's change made by an interleave just
// before the statement it names.

const UNAVAILABLE = "This offer is unavailable for signing.";
const SIGNING_OFF = "Website signing is off.";
const WAIT = "Wait at least 30 seconds before requesting another link.";

const PENDING =
	"Another offer has a pending MSA for this party. Ask Kazon to resolve it.";

const NOT_REVIEWED = "The agreement could not be reviewed.";

const LINK_INSERT = /INSERT INTO software_agreement_links/;

/** The read of the offer's signable state, before each try of the link batch. */
const SIGNING_FACTS = /SELECT o\.status,o\.recipient_email_snapshot/;

const CLIENTS_INSERT = /INSERT OR IGNORE INTO software_agreement_clients/;

/** The review's read of a pending MSA of the party on another offer, just before its batch. */
const PENDING_READ =
	/SELECT \* FROM software_agreements WHERE client_id=\? AND template_id=\?/;

const RACE_LINK = `INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('link-race','agreement','o-r1','h','${access.GRACE}','race-hash','2026-11-13T11:59:59.000Z','2026-11-13T12:59:59.000Z')`;

const PROJECT = `INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')`;

const client = (id: string) =>
	`INSERT INTO software_agreement_clients VALUES('${id}','${access.GRACE}','Hopper Systems LLC','hopper systems llc','LLC','Virginia','1 Main Street, Roanoke, VA 24011','${access.GRACE}','2026-11-13T11:59:59.000Z')`;

const OTHER_OFFER = `INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r3','software','Grace','${access.GRACE}','x','reviewed','t','t'); INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('o-r3','r3',1,'sent','{}','t','t')`;

const otherMsa = (clientId: string) =>
	`INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o-r3','r3','${clientId}','tpl-msa','review','x','${"3".repeat(64)}','{}','t','2026-11-13','h')`;

const isTable = (
	value: Recorded | undefined,
): value is { [key: string]: Recorded } =>
	isObject(value) && !Array.isArray(value);

/** The rows of a music table that the step dumped. */
function dumped(record: CaseRecord, table: string): Recorded[] {
	const state = record.steps[0]?.state ?? undefined;
	const music = isTable(state) ? state.music : undefined;
	const rows = isTable(music) ? music[table] : undefined;

	return Array.isArray(rows) ? rows : [];
}

const column = (rows: Recorded[], name: string) =>
	rows.map((row) => (isTable(row) ? row[name] : null));

/** What the step answered, and every console line the case wrote. */
function seen(record: CaseRecord) {
	const answer = record.steps[0].answer;

	return {
		status: answer.outcome === "response" ? answer.status : "rejected",
		body:
			answer.outcome === "response" && isText(answer.body) ? answer.body : "",
		logs: record.effects.flatMap((effect) =>
			effect.kind === "console" ? [effect.args.map(String).join(" ")] : [],
		),
	};
}

/** How many single statements (not in a batch) `on` matches. */
const reads = (record: CaseRecord, on: RegExp) =>
	record.effects.filter((effect) => effect.kind === "d1" && on.test(effect.sql))
		.length;

/** How each batch holding a statement that `on` matches ended, in order. */
const batches = (record: CaseRecord, on: RegExp) =>
	record.effects.flatMap((effect) =>
		effect.kind === "d1-batch" &&
		effect.statements.some((statement) => on.test(statement.sql))
			? [effect.result]
			: [],
	);

const json = (error: string) => JSON.stringify({ ok: false, error });

const run = async (handler: Handler, c: Omit<Case, "name">) =>
	runCase(handler, { name: "signing decision", ...c });

const race = (
	on: RegExp,
	sql: string,
	nth = 1,
	label = `another request (${nth})`,
): Interleave => ({ on, nth, label, run: (sqlite) => sqlite.exec(sql) });

// ---- POST /api/offer/[token]/link ----

const linkCase = (
	over: Omit<Case, "name" | "steps"> = {},
	opts: access.Opts = {},
	form = false,
): Omit<Case, "name"> => ({
	...access.agreementWorld({ session: null, ...opts }),
	fetches: access.mail,
	steps: [
		{
			as: asVisitor({ ip: access.IP }),
			path: `/api/offer/${access.TOKEN}/link`,
			params: { token: access.TOKEN },
			dump: { music: access.LINK_TABLES },
			...(form
				? {
						body: access.formBody({ "cf-turnstile-response": "tok" }),
						headers: access.formHeaders(),
					}
				: { json: { turnstileToken: "tok" }, headers: access.SAME_ORIGIN }),
		},
	],
	...over,
});

describe("POST /api/offer/[token]/link: a guard of the link batch raises (Q1)", () => {
	it("reads the signing state once, before the batch, when the batch commits", async () => {
		const record = await run(LINK, linkCase());

		expect(seen(record).status).toBe(200);
		expect(batches(record, LINK_INSERT)).toEqual(["committed"]);
		expect(reads(record, SIGNING_FACTS)).toBe(1);
	});

	it.each([
		[
			"the request is withdrawn",
			"UPDATE owner_requests SET status='withdrawn'",
			UNAVAILABLE,
		],
		[
			"the request is resolved",
			"UPDATE owner_requests SET status='resolved'",
			UNAVAILABLE,
		],
		[
			"the offer link is revoked",
			"UPDATE software_offer_links SET revoked_at='2026-11-13T11:59:59.000Z'",
			UNAVAILABLE,
		],
		[
			"signing is switched off",
			"UPDATE software_signing_settings SET software_signing_enabled=0",
			SIGNING_OFF,
		],
		["the owner starts the project", PROJECT, UNAVAILABLE],
		[
			"the offer is superseded",
			"UPDATE software_offers SET status='superseded'",
			UNAVAILABLE,
		],
	])(
		"%s between the read and the batch: the guard raises, the read after it decides, 404 with the real reason",
		async (_name, sql, sentence) => {
			const record = await run(
				LINK,
				linkCase({ interleave: [race(LINK_INSERT, sql)] }),
			);

			expect(seen(record)).toEqual({
				status: 404,
				body: json(sentence),
				logs: [],
			});
			expect(batches(record, LINK_INSERT)).toEqual(["rolled-back"]);
			expect(reads(record, SIGNING_FACTS)).toBe(2);
			expect(dumped(record, "software_agreement_links")).toEqual([]);
		},
	);

	it("renders the real reason of a native form post as its page", async () => {
		const record = await run(
			LINK,
			linkCase(
				{
					interleave: [
						race(
							LINK_INSERT,
							"UPDATE software_signing_settings SET software_signing_enabled=0",
						),
					],
				},
				{},
				true,
			),
		);

		const answer = seen(record);

		expect(answer.status).toBe(404);
		expect(answer.body).toContain(SIGNING_OFF);
		expect(answer.body).not.toContain(WAIT);
	});

	it("refuses an offer whose project already exists: the read before the batch decides, 404, and no batch runs", async () => {
		const record = await run(
			LINK,
			linkCase({}, { extra: access.startedProject() }),
		);

		expect(seen(record)).toEqual({
			status: 404,
			body: json(UNAVAILABLE),
			logs: [],
		});
		expect(batches(record, LINK_INSERT)).toEqual([]);
		expect(reads(record, SIGNING_FACTS)).toBe(1);
		expect(dumped(record, "software_agreement_links")).toEqual([]);
	});

	it("keeps the 429 for a link issued 20 seconds ago, decided by the read before the batch", async () => {
		const record = await run(
			LINK,
			linkCase(
				{},
				{
					extra: {
						software_agreement_links: [
							{
								id: "link-recent",
								purpose: "agreement",
								offer_id: "o-r1",
								link_hash: "hash-of-the-offer-link",
								recipient_email: access.GRACE,
								token_hash: "token-hash-of-a-recent-agreement-link",
								issued_at: "2026-11-13T11:59:40.000Z",
								expires_at: "2026-11-13T12:59:40.000Z",
								used_at: null,
							},
						],
					},
				},
			),
		);

		expect(seen(record)).toEqual({
			status: 429,
			body: json(WAIT),
			logs: [],
		});
		expect(batches(record, LINK_INSERT)).toEqual([]);
		expect(reads(record, SIGNING_FACTS)).toBe(1);
	});

	it("keeps the 429 when another request issues a link between the read and the batch", async () => {
		const record = await run(
			LINK,
			linkCase({ interleave: [race(LINK_INSERT, RACE_LINK)] }),
		);

		expect(seen(record)).toEqual({
			status: 429,
			body: json(WAIT),
			logs: [],
		});
		expect(batches(record, LINK_INSERT)).toEqual(["rolled-back"]);
		expect(reads(record, SIGNING_FACTS)).toBe(2);
		expect(column(dumped(record, "software_agreement_links"), "id")).toEqual([
			"link-race",
		]);
	});

	it("answers a read after a raised guard that fails with the route's 500, logged once", async () => {
		const record = await run(
			LINK,
			linkCase({
				interleave: [race(LINK_INSERT, RACE_LINK)],
				failures: [
					{ on: SIGNING_FACTS, nth: 2, message: "D1_ERROR: the read fails" },
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json("Agreement sign-in is temporarily unavailable."),
			logs: [
				"Agreement link failed unexpectedly: Error D1_ERROR: the read fails",
			],
		});
	});

	it("stores the link on the second try when the change that raised the guard is gone by then", async () => {
		const record = await run(
			LINK,
			linkCase({
				interleave: [
					race(LINK_INSERT, RACE_LINK),
					race(
						SIGNING_FACTS,
						"DELETE FROM software_agreement_links WHERE id='link-race'",
						2,
					),
				],
			}),
		);

		const answer = seen(record);

		expect(answer.status).toBe(200);
		expect(JSON.parse(answer.body)).toMatchObject({ ok: true });
		expect(answer.logs).toEqual([]);
		expect(batches(record, LINK_INSERT)).toEqual(["rolled-back", "committed"]);

		const links = dumped(record, "software_agreement_links");

		expect(column(links, "issued_at")).toEqual([access.NOW]);
	});

	it("answers the 429 after a guard raised on each of three batches, with a read before each and none after the third", async () => {
		const gone = "DELETE FROM software_agreement_links WHERE id='link-race'";

		const record = await run(
			LINK,
			linkCase({
				interleave: [
					race(LINK_INSERT, RACE_LINK, 1),
					race(SIGNING_FACTS, gone, 2),
					race(LINK_INSERT, RACE_LINK, 2),
					race(SIGNING_FACTS, gone, 3),
					race(LINK_INSERT, RACE_LINK, 3),
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 429,
			body: json(WAIT),
			logs: [],
		});
		expect(batches(record, LINK_INSERT)).toEqual([
			"rolled-back",
			"rolled-back",
			"rolled-back",
		]);
		expect(reads(record, SIGNING_FACTS)).toBe(3);
	});
});

// ---- POST /api/offer/[token]/review ----

const reviews = access.wireKit(
	`/api/offer/${access.TOKEN}/review`,
	access.REVIEW_TABLES,
);

const reviewCase = (over: Partial<Case>, opts: access.Opts = {}) => {
	const [one] = reviews.scenario("review", { wires: ["json"], opts, over });

	return one;
};

/** The world in which the party's client row exists, with another sent offer of the same party and no MSA yet. */
const partyKnown: access.Opts = {
	extra: { software_agreement_clients: [access.clientRow()] },
	sql: [OTHER_OFFER],
};

describe("POST /api/offer/[token]/review: a fact the review decided from changes before its batch (B7)", () => {
	it("reviews with the other tab's client when the same legal party is created before the batch: 200", async () => {
		const record = await run(
			REVIEW,
			reviewCase({ interleave: [race(CLIENTS_INSERT, client("client-race"))] }),
		);

		const answer = seen(record);

		expect(answer.status).toBe(200);
		expect(JSON.parse(answer.body)).toMatchObject({
			ok: true,
			reused_msa: null,
		});
		expect(answer.logs).toEqual([]);
		expect(batches(record, CLIENTS_INSERT)).toEqual([
			"rolled-back",
			"committed",
		]);
		expect(column(dumped(record, "software_agreement_clients"), "id")).toEqual([
			"client-race",
		]);
		expect(column(dumped(record, "software_agreements"), "client_id")).toEqual([
			"client-race",
			"client-race",
		]);
	});

	it("names the other offer's pending MSA when the party and that MSA appear before the batch: 409", async () => {
		const record = await run(
			REVIEW,
			reviewCase({
				interleave: [
					race(
						CLIENTS_INSERT,
						`${client("client-1")}; ${OTHER_OFFER}; ${otherMsa("client-1")}`,
					),
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(PENDING),
			logs: [],
		});
		expect(batches(record, CLIENTS_INSERT)).toEqual(["rolled-back"]);
	});

	it("names the other offer's pending MSA when it is inserted after the pending check: 409", async () => {
		const record = await run(
			REVIEW,
			reviewCase(
				{ interleave: [race(CLIENTS_INSERT, otherMsa("client-1"))] },
				partyKnown,
			),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(PENDING),
			logs: [],
		});
		expect(batches(record, CLIENTS_INSERT)).toEqual(["rolled-back"]);
	});

	it("answers the 409 it always gave once the pending MSA is taken on each of three tries", async () => {
		const gone = "DELETE FROM software_agreements WHERE id='ag-race'";

		const record = await run(
			REVIEW,
			reviewCase(
				{
					interleave: [
						race(CLIENTS_INSERT, otherMsa("client-1"), 1),
						race(PENDING_READ, gone, 2),
						race(CLIENTS_INSERT, otherMsa("client-1"), 2),
						race(PENDING_READ, gone, 3),
						race(CLIENTS_INSERT, otherMsa("client-1"), 3),
					],
				},
				partyKnown,
			),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(NOT_REVIEWED),
			logs: [],
		});
		expect(batches(record, CLIENTS_INSERT)).toEqual([
			"rolled-back",
			"rolled-back",
			"rolled-back",
		]);
	});

	it("answers the 409 it always gave once the client row changes on each of three tries", async () => {
		const replaced = (id: string) =>
			`DELETE FROM software_agreement_clients; ${client(id)}`;

		const record = await run(
			REVIEW,
			reviewCase({
				interleave: [
					race(CLIENTS_INSERT, replaced("client-race-1"), 1),
					race(CLIENTS_INSERT, replaced("client-race-2"), 2),
					race(CLIENTS_INSERT, replaced("client-race-3"), 3),
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(NOT_REVIEWED),
			logs: [],
		});
		expect(batches(record, CLIENTS_INSERT)).toEqual([
			"rolled-back",
			"rolled-back",
			"rolled-back",
		]);
	});

	it("does not retry a foreign key failure with no evidence of a race: the logged 500, one batch", async () => {
		const record = await run(
			REVIEW,
			reviewCase({
				interleave: [
					race(
						CLIENTS_INSERT,
						"PRAGMA foreign_keys=OFF; DELETE FROM software_agreement_templates WHERE id='tpl-sow'; PRAGMA foreign_keys=ON",
					),
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(NOT_REVIEWED),
			logs: [
				"Agreement review failed unexpectedly: Error FOREIGN KEY constraint failed",
			],
		});
		expect(batches(record, CLIENTS_INSERT)).toEqual(["rolled-back"]);
	});
});
