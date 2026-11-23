import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { statementOf } from "../../scripts/sql-effects.mjs";
import { getLinkedOffer, hashOfferToken } from "../../src/lib/software-offers";
import {
	AgreementStoreFailed,
	consumeLinks,
	readBriefName,
	readDraftFacts,
	readLinkByKey,
	readLinkedOffer,
	readSigningEnabled,
	readSigningFacts,
	readRecentSigningLinks,
	readSigningLinks,
	redeemLinkBatch,
	removeRefusedLink,
	type SigningLinkRow,
	saveDraftBatch,
	storeSigningLink,
} from "../../src/server/agreement-store";
import {
	alwaysDecideAndSave,
	ChangedSinceRead,
	GuardRefused,
} from "../../src/server/guarded-save";
import type { DraftWrite } from "../../src/server/rules/signing-draft";
import {
	issueSigningLink,
	type SigningLinkRequest,
} from "../../src/server/rules/signing-link";
import { linkedOffer } from "../../src/server/rules/signing-offer";
import type { RedeemSession } from "../../src/server/rules/signing-redeem";
import { MusicDb } from "../../src/server/services";
import { double } from "../helpers/doubles";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";
import {
	freshMusicDb,
	type Seed,
	type SeedRow,
	seed,
} from "../golden/harness/db";
import * as rows from "../golden/harness/rows";

// The signing link's, the redeem's and the draft's store functions (src/server/agreement-store.ts, the block "the signing
// link, the redeem and the draft") against the real schema on node:sqlite: what each read finds, what each batch writes,
// and how each fails (a raised guard of the link batch is ChangedSinceRead, of the redeem and the draft GuardRefused, and
// any other rejection AgreementStoreFailed, with nothing written). Then the store's SQL against the signing corpora
// (tests/golden/offer-*.test.ts, agreements-*.test.ts and their fixtures): each statement that replaces one of today's
// runs a text the fixtures recorded, each batch in a recorded order; the two reads whose filter moved into a rule keep
// every hook pattern their old text matched; the two statements whose hook pattern PR 4 re-points are listed; and the
// added reads match no hook pattern.

const GRACE = "grace@example.test";
const EARLIER = "2026-11-23T11:00:00.000Z";
const SINCE = "2026-11-23T11:59:30.000Z";
const AT = "2026-11-23T12:00:00.000Z";
const HOUR_LATER = "2026-11-23T13:00:00.000Z";
const LATER = "2026-11-23T14:00:00.000Z";

/** The offer link's token hash of brief r1 (rows.offerLink's default). */
const LINK_HASH = "hash-r1";

/** The tables this block writes. */
const WRITTEN = [
	"software_agreement_links",
	"software_agreement_events",
	"software_agreement_sessions",
	"software_agreement_drafts",
	"audio_client_allowances",
] as const;

/**
 * A world: the real schema, every SQL text the store prepares recorded in order, one statement failing when asked to, and
 * SQL run just before the first batch (another request's change between a read and the batch, outside the batch).
 */
function signingWorld(
	options: {
		readonly fail?: { readonly on: RegExp; readonly message: string };
		readonly beforeFirstBatch?: string;
	} = {},
) {
	const sql = freshMusicDb();
	const executed: string[] = [];
	let pending = options.beforeFirstBatch;

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (options.fail?.on.test(query)) throw new Error(options.fail.message);

			return sql.prepare(query);
		},
		exec: (query: string) => {
			if (query === "BEGIN" && pending !== undefined) {
				sql.exec(pending);
				pending = undefined;
			}

			sql.exec(query);
		},
	});

	const db = sqliteD1(recording);

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		executed,
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		seed: (tables: Seed) => seed(sql, tables),
		all: (query: string, ...args: string[]) => sql.prepare(query).all(...args),
		/** Every row of the tables this block writes, to show a refused or failed batch wrote nothing. */
		written: () =>
			WRITTEN.map((table) => sql.prepare(`SELECT * FROM ${table}`).all()),
	};
}

type World = ReturnType<typeof signingWorld>;

/** The cause a store failure carries, as text; anything else says so. */
const causeOf = <Failure>(failed: Failure) =>
	failed instanceof AgreementStoreFailed
		? String(failed.failure)
		: "not an AgreementStoreFailed";

/** A signing link of brief r1's offer to Grace, issued an hour ago and unused. */
const signingLink = (id: string, over: SeedRow = {}) => ({
	id,
	purpose: "agreement",
	offer_id: "o1",
	link_hash: LINK_HASH,
	recipient_email: GRACE,
	token_hash: `key-${id}`,
	issued_at: EARLIER,
	expires_at: HOUR_LATER,
	...over,
});

/** A signing session made from link-1, open until LATER. */
const signingSession = (tokenHash: string, over: SeedRow = {}) => ({
	token_hash: tokenHash,
	purpose: "agreement",
	offer_id: "o1",
	link_hash: LINK_HASH,
	recipient_email: GRACE,
	link_id: "link-1",
	verified_at: EARLIER,
	expires_at: LATER,
	csrf_nonce: "nonce",
	...over,
});

/** Brief r1 with its sent offer o1 to Grace, its live offer link, and signing switched on. */
function openWorld(options: Parameters<typeof signingWorld>[0] = {}) {
	const world = signingWorld(options);

	world.seed({
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
		software_offers: [
			rows.softwareOffer("o1", "r1", { recipient_email_snapshot: GRACE }),
		],
		software_offer_links: [rows.offerLink("r1")],
	});
	world.sql.exec(
		"UPDATE software_signing_settings SET software_signing_enabled=1",
	);

	return world;
}

const PROJECT_SQL =
	"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','t','t','t','o','t','t')";

/** Each way the offer stops being open for signing (A1), as SQL run on an open world. */
const NOT_OPEN: readonly { readonly name: string; readonly sql: string }[] = [
	{
		name: "signing is off",
		sql: "UPDATE software_signing_settings SET software_signing_enabled=0",
	},
	{
		name: "the setting's row is missing",
		sql: "DELETE FROM software_signing_settings",
	},
	{
		name: "the offer is withdrawn",
		sql: "UPDATE software_offers SET status='withdrawn'",
	},
	{
		name: "the offer link is revoked",
		sql: `UPDATE software_offer_links SET revoked_at='${EARLIER}'`,
	},
	{
		name: "the offer link is replaced",
		sql: "UPDATE software_offer_links SET token_hash='another-hash'",
	},
	{
		name: "the recipient changed",
		sql: "UPDATE software_offers SET recipient_email_snapshot='new@example.test'",
	},
	{
		name: "the brief is resolved",
		sql: "UPDATE owner_requests SET status='resolved'",
	},
	{ name: "a project started", sql: PROJECT_SQL },
];

describe("the offer and the session", () => {
	it("read the signing setting's row, or null when it is missing", async () => {
		const world = signingWorld();

		expect(await world.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 0,
		});

		world.sql.exec(
			"UPDATE software_signing_settings SET software_signing_enabled=1",
		);
		expect(await world.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 1,
		});

		world.sql.exec("DELETE FROM software_signing_settings");
		expect(await world.ok(readSigningEnabled())).toBeNull();
	});

	it("read every offer of the brief a token hash names, unfiltered, each with the link's revocation and the brief", async () => {
		const world = openWorld();

		world.sql.exec(
			`UPDATE software_offers SET status='superseded' WHERE id='o1'; UPDATE software_offer_links SET revoked_at='${EARLIER}'; UPDATE owner_requests SET status='withdrawn',email=''`,
		);
		world.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", { version: 2, status: "draft" }),
			],
			owner_requests: [rows.softwareRequest("r2")],
		});
		world.seed({
			software_offers: [rows.softwareOffer("o3", "r2")],
			software_offer_links: [rows.offerLink("r2")],
		});

		const found = await world.ok(readLinkedOffer(LINK_HASH));

		const through = {
			link_revoked_at: EARLIER,
			request_kind: "software",
			request_status: "withdrawn",
			request_email: "",
		};

		expect(found.map((offer) => offer.id).sort()).toEqual(["o1", "o2"]);
		expect(found.find((offer) => offer.id === "o1")).toEqual({
			id: "o1",
			request_id: "r1",
			version: 1,
			status: "superseded",
			terms_json: "{}",
			created_at: "2026-11-13T11:00:00.000Z",
			updated_at: "2026-11-13T11:00:00.000Z",
			sent_at: "2026-11-13T11:00:00.000Z",
			sent_by: "owner@example.test",
			agreement_details_json: null,
			msa_template_id: null,
			sow_template_id: null,
			contractor_snapshot_json: null,
			recipient_email_snapshot: GRACE,
			reused_msa_id: null,
			...through,
		});
		expect(found.find((offer) => offer.id === "o2")).toMatchObject(through);
		expect(await world.ok(readLinkedOffer("no-such-hash"))).toEqual([]);
	});

	it("read the offer's signing state: the link only when it has the hash, the setting, a project; null with no offer", async () => {
		const world = openWorld();

		const open = {
			status: "sent",
			recipient_email_snapshot: GRACE,
			request_status: "reviewed",
			link_hash: LINK_HASH,
			link_revoked_at: null,
			software_signing_enabled: 1,
			project_offer_id: null,
		};

		const facts = (linkHash: string | null, offerId: string | null = "o1") =>
			world.ok(readSigningFacts({ offerId, linkHash }));

		expect(await facts(LINK_HASH)).toEqual(open);
		expect(await facts("another-hash")).toEqual({
			...open,
			link_hash: null,
		});
		expect(await facts(null)).toEqual({ ...open, link_hash: null });

		world.sql.exec(
			`UPDATE software_offer_links SET revoked_at='${EARLIER}'; ${PROJECT_SQL}; DELETE FROM software_signing_settings`,
		);
		expect(await facts(LINK_HASH)).toEqual({
			...open,
			link_revoked_at: EARLIER,
			software_signing_enabled: null,
			project_offer_id: "o1",
		});
		expect(await facts(LINK_HASH, "o9")).toBeNull();
		expect(await facts(LINK_HASH, null)).toBeNull();
	});
});

describe("readLinkedOffer and linkedOffer", () => {
	const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"] as const;
	const REQUEST_STATUSES = ["new", "reviewed", "resolved", "withdrawn"];

	/** A token of the shape getLinkedOffer reads (43 URL-safe characters), distinct per number. */
	const tokenOf = (n: number) =>
		`${"A".repeat(37)}-_${String(n).padStart(4, "0")}`;

	it("answer what getLinkedOffer answers on the same database, for every offer, link and brief", async () => {
		const world = signingWorld();
		const db = sqliteD1(world.sql);
		const tokens: string[] = [];
		let n = 0;

		const brief = async (
			offers: readonly { status: string; version: number }[],
			over: {
				kind?: string;
				status?: string;
				email?: string;
				revoked?: boolean;
			},
		) => {
			n += 1;
			const token = tokenOf(n);

			tokens.push(token);
			world.seed({
				owner_requests: [
					rows.ownerRequest(`r${n}`, {
						kind: over.kind ?? "software",
						status: over.status ?? "reviewed",
						email: over.email ?? GRACE,
					}),
				],
			});
			world.seed({
				software_offers: offers.map((offer) =>
					rows.softwareOffer(`o${n}-${offer.version}`, `r${n}`, {
						status: offer.status,
						version: offer.version,
						recipient_email_snapshot: GRACE,
					}),
				),
				software_offer_links: [
					rows.offerLink(`r${n}`, {
						token_hash: await hashOfferToken(token),
						revoked_at: over.revoked ? EARLIER : null,
					}),
				],
			});
		};

		for (const status of OFFER_STATUSES)
			for (const revoked of [false, true])
				for (const kind of ["software", "service"])
					for (const requestStatus of REQUEST_STATUSES)
						for (const email of [GRACE, ""])
							await brief([{ status, version: 1 }], {
								kind,
								status: requestStatus,
								email,
								revoked,
							});

		await brief(
			[
				{ status: "superseded", version: 1 },
				{ status: "sent", version: 2 },
				{ status: "draft", version: 3 },
			],
			{},
		);
		await brief([], {});
		tokens.push(tokenOf(9999));

		let found = 0;

		for (const token of tokens) {
			const today = await getLinkedOffer(db, token);

			const converted = await world.ok(
				readLinkedOffer(await hashOfferToken(token)).pipe(
					Effect.flatMap((facts) => linkedOffer.decide(null, facts)),
					Effect.map(
						({
							link_revoked_at: _revoked,
							request_kind: _kind,
							request_status: _status,
							request_email: _email,
							...offer
						}) => offer,
					),
					Effect.catchTag("OfferUnavailable", () => Effect.succeed(null)),
				),
			);

			expect(converted, token).toEqual(today);

			if (today) found += 1;
		}

		expect(tokens).toHaveLength(131);
		// A sent offer through a live link of an open software brief with an email: two open statuses, and the versioned brief.
		expect(found).toBe(3);
	});
});

describe("the signing link", () => {
	const link = (over: Partial<SigningLinkRow> = {}): SigningLinkRow => ({
		id: "link-new",
		hash: "key-link-new",
		actorHash: "actor-of-link-new",
		offerId: "o1",
		linkHash: LINK_HASH,
		recipient: GRACE,
		at: AT,
		since: SINCE,
		expiresAt: HOUR_LATER,
		...over,
	});

	it("reads the recipient's signing links of the offer, used or not, and no other link", async () => {
		const world = openWorld();

		world.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", { version: 2, status: "draft" }),
			],
		});
		world.seed({
			software_agreement_links: [
				signingLink("a"),
				signingLink("b", { used_at: EARLIER, issued_at: SINCE }),
				signingLink("other-offer", { offer_id: "o2" }),
				signingLink("other-recipient", { recipient_email: "x@example.test" }),
				signingLink("archive", {
					purpose: "archive",
					offer_id: null,
					link_hash: null,
				}),
			],
		});

		expect(await world.ok(readSigningLinks(GRACE, "o1"))).toEqual([
			{ id: "a", issued_at: EARLIER, used_at: null },
			{ id: "b", issued_at: SINCE, used_at: EARLIER },
		]);
		expect(await world.ok(readSigningLinks(GRACE, "o9"))).toEqual([]);
	});

	it("reads the recipient's signing links of the offer issued after the window's start, used or not, and no other link", async () => {
		const world = openWorld();

		world.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", { version: 2, status: "draft" }),
			],
		});
		world.seed({
			software_agreement_links: [
				signingLink("before", { issued_at: EARLIER }),
				signingLink("at-start", { issued_at: SINCE }),
				signingLink("after", { issued_at: AT }),
				signingLink("after-used", { issued_at: AT, used_at: AT }),
				signingLink("other-offer", { offer_id: "o2", issued_at: AT }),
				signingLink("other-recipient", {
					recipient_email: "x@example.test",
					issued_at: AT,
				}),
				signingLink("archive", {
					purpose: "archive",
					offer_id: null,
					link_hash: null,
					issued_at: AT,
				}),
			],
		});

		expect(await world.ok(readRecentSigningLinks(GRACE, "o1", SINCE))).toEqual([
			{ id: "after", issued_at: AT, used_at: null },
			{ id: "after-used", issued_at: AT, used_at: AT },
		]);
	});

	it("stores the link and its issue event in one batch", async () => {
		const world = openWorld();

		await world.ok(storeSigningLink(link()));

		expect(world.all("SELECT * FROM software_agreement_links")).toEqual([
			{
				id: "link-new",
				purpose: "agreement",
				offer_id: "o1",
				link_hash: LINK_HASH,
				recipient_email: GRACE,
				token_hash: "key-link-new",
				issued_at: AT,
				expires_at: HOUR_LATER,
				used_at: null,
			},
		]);
		expect(
			world.all(
				"SELECT agreement_id,offer_id,action,actor,occurred_at,reason FROM software_agreement_events",
			),
		).toEqual([
			{
				agreement_id: null,
				offer_id: "o1",
				action: "link-issued",
				actor: "actor-of-link-new",
				occurred_at: AT,
				reason: null,
			},
		]);
	});

	it("is ChangedSinceRead, writing nothing, when A4 finds a link issued after since, used or not", async () => {
		const recent: readonly SeedRow[] = [
			{ issued_at: "2026-11-23T11:59:31.000Z" },
			{ issued_at: AT, used_at: AT },
		];

		for (const over of recent) {
			const world = openWorld();

			world.seed({ software_agreement_links: [signingLink("recent", over)] });

			const before = world.written();

			expect(await world.failed(storeSigningLink(link()))).toBeInstanceOf(
				ChangedSinceRead,
			);
			expect(world.written()).toEqual(before);
		}

		const world = openWorld();

		world.seed({
			software_agreement_links: [
				signingLink("at-since", { issued_at: SINCE }),
				signingLink("archive", {
					purpose: "archive",
					offer_id: null,
					link_hash: null,
					issued_at: AT,
				}),
			],
		});
		await world.ok(storeSigningLink(link()));
	});

	it("is ChangedSinceRead, writing nothing, when A1 finds the offer no longer open for signing", async () => {
		for (const change of NOT_OPEN) {
			const world = openWorld();

			world.sql.exec(change.sql);

			const before = world.written();

			expect(
				await world.failed(storeSigningLink(link())),
				change.name,
			).toBeInstanceOf(ChangedSinceRead);
			expect(world.written(), change.name).toEqual(before);
		}
	});

	it("is AgreementStoreFailed, writing nothing, for any other failure", async () => {
		const world = openWorld();

		world.seed({
			software_agreement_links: [
				signingLink("taken", {
					token_hash: "key-link-new",
					issued_at: EARLIER,
				}),
			],
		});

		const before = world.written();
		const failed = await world.failed(storeSigningLink(link()));

		expect(failed).toBeInstanceOf(AgreementStoreFailed);
		expect(causeOf(failed)).toMatch(
			/UNIQUE constraint failed: software_agreement_links.token_hash/,
		);
		expect(world.written()).toEqual(before);
	});

	describe("through alwaysDecideAndSave and issueSigningLink", () => {
		const request: SigningLinkRequest = {
			at: new Date(AT),
			offerId: "o1",
			recipient: GRACE,
			session: null,
		};

		/** The link request through the loop, counting the batches it ran (each try draws its own link id and key). */
		const issuing = () => {
			const batches = { ran: 0 };

			const effect = alwaysDecideAndSave({
				facts: Effect.all({
					signing: readSigningFacts({ offerId: "o1", linkHash: LINK_HASH }),
					links: readSigningLinks(GRACE, "o1"),
				}),
				decide: (facts) => issueSigningLink.decide(request, facts),
				save: (write) => {
					batches.ran += 1;

					return storeSigningLink(
						link({
							id: `link-${batches.ran}`,
							hash: `key-${batches.ran}`,
							at: write.at,
							since: write.since,
							expiresAt: write.expiresAt,
						}),
					);
				},
			});

			return { batches, effect };
		};

		it("reads and decides again after another request's link raised A4: CooldownRunning", async () => {
			const world = openWorld({
				beforeFirstBatch: `INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('race','agreement','o1','${LINK_HASH}','${GRACE}','race-key','2026-11-23T11:59:59.000Z','${HOUR_LATER}')`,
			});

			const issue = issuing();
			const refused = await world.failed(issue.effect);

			expect(refused._tag).toBe("CooldownRunning");
			expect(issue.batches.ran).toBe(1);
			expect(
				world
					.all("SELECT id FROM software_agreement_links")
					.map((row) => row.id),
			).toEqual(["race"]);
		});

		it("reads and decides again after a withdrawal raised A1: OfferUnavailable", async () => {
			const world = openWorld({
				beforeFirstBatch: "UPDATE owner_requests SET status='withdrawn'",
			});

			const issue = issuing();
			const refused = await world.failed(issue.effect);

			expect(refused._tag).toBe("OfferUnavailable");
			expect(issue.batches.ran).toBe(1);
			expect(world.all("SELECT id FROM software_agreement_links")).toEqual([]);
		});

		it("saves on the first try when nothing changed", async () => {
			const world = openWorld();
			const issue = issuing();
			const answer = await world.ok(issue.effect);

			expect(issue.batches.ran).toBe(1);
			expect(answer.decided).toEqual({
				at: AT,
				since: SINCE,
				expiresAt: HOUR_LATER,
				receiptAddress: "g•••@example.test",
			});
			expect(
				world.all(
					"SELECT id,issued_at,expires_at FROM software_agreement_links",
				),
			).toEqual([{ id: "link-1", issued_at: AT, expires_at: HOUR_LATER }]);
		});
	});

	it("reads the brief's name for the greeting, or null", async () => {
		const world = openWorld();

		expect(await world.ok(readBriefName("r1"))).toBe("Grace Hopper");
		expect(await world.ok(readBriefName("r9"))).toBeNull();
	});

	describe("a refused mail", () => {
		/** The link, two sessions made from it and another link's session; two allowance windows and one of another key. */
		function refusedWorld(
			options: Parameters<typeof signingWorld>[0] = {},
		): World {
			const world = openWorld(options);

			world.seed({
				software_agreement_links: [
					signingLink("link-1"),
					signingLink("link-2"),
				],
				audio_client_allowances: [
					{ key: "ip-key", window_start: SINCE, uses: 3 },
					{ key: "email-key", window_start: AT, uses: 1 },
					{ key: "restarted-key", window_start: AT, uses: 1 },
				],
			});
			world.seed({
				software_agreement_sessions: [
					signingSession("s1"),
					signingSession("s2"),
					signingSession("s3", { link_id: "link-2" }),
				],
			});

			return world;
		}

		const refund = {
			linkId: "link-1",
			uses: [
				{ key: "ip-key", window_start: SINCE },
				{ key: "email-key", window_start: AT },
				{ key: "restarted-key", window_start: EARLIER },
			],
		};

		it("takes back the link, its sessions and one use of each counted allowance, in one batch", async () => {
			const world = refusedWorld();

			await world.ok(removeRefusedLink(refund));

			expect(world.all("SELECT id FROM software_agreement_links")).toEqual([
				{ id: "link-2" },
			]);
			expect(
				world.all("SELECT token_hash FROM software_agreement_sessions"),
			).toEqual([{ token_hash: "s3" }]);
			expect(
				world.all(
					"SELECT key,window_start,uses FROM audio_client_allowances ORDER BY key",
				),
			).toEqual([
				{ key: "ip-key", window_start: SINCE, uses: 2 },
				{ key: "restarted-key", window_start: AT, uses: 1 },
			]);
		});

		it("is AgreementStoreFailed and leaves the link, its sessions and every use when a statement fails", async () => {
			const world = refusedWorld({
				fail: {
					on: /UPDATE audio_client_allowances SET uses=uses-1/,
					message: "the refund fails",
				},
			});

			const before = world.written();
			const failed = await world.failed(removeRefusedLink(refund));

			expect(failed).toBeInstanceOf(AgreementStoreFailed);
			expect(world.written()).toEqual(before);
		});
	});

	it("consumes the links it is given with the existing consumeLinks, only while unused", async () => {
		const world = openWorld();

		world.seed({
			software_agreement_links: [
				signingLink("older"),
				signingLink("used", { used_at: EARLIER }),
				signingLink("new", { issued_at: AT }),
			],
		});

		await world.ok(consumeLinks(["older", "used"], AT));

		expect(
			world.all("SELECT id,used_at FROM software_agreement_links ORDER BY id"),
		).toEqual([
			{ id: "new", used_at: null },
			{ id: "older", used_at: AT },
			{ id: "used", used_at: EARLIER },
		]);
	});
});

describe("the redeem", () => {
	const SESSION_HASH = "session-hash-new";
	const TWO_HOURS = "2026-11-23T14:00:00.000Z";

	const signing = (over: Partial<RedeemSession> = {}): RedeemSession => ({
		purpose: "agreement",
		at: AT,
		keyHash: "key-link-1",
		linkId: "link-1",
		offerId: "o1",
		linkHash: LINK_HASH,
		recipient: GRACE,
		expiresAt: TWO_HOURS,
		location: "/offer/token/sign",
		live: { offerId: "o1", linkHash: LINK_HASH, recipient: GRACE },
		...over,
	});

	const archive: RedeemSession = {
		purpose: "archive",
		at: AT,
		keyHash: "key-archive-1",
		linkId: "archive-1",
		offerId: null,
		linkHash: null,
		recipient: GRACE,
		expiresAt: TWO_HOURS,
		location: "/agreements",
		live: null,
	};

	const redeem = (session: RedeemSession) =>
		redeemLinkBatch({
			session,
			sessionHash: SESSION_HASH,
			csrfNonce: "nonce-new",
		});

	function redeemWorld(options: Parameters<typeof signingWorld>[0] = {}) {
		const world = openWorld(options);

		world.seed({
			software_agreement_links: [
				signingLink("link-1"),
				signingLink("archive-1", {
					purpose: "archive",
					offer_id: null,
					link_hash: null,
				}),
			],
		});

		return world;
	}

	it("reads the link by its key's hash, whatever its purpose, use and expiry, or null", async () => {
		const world = redeemWorld();

		world.sql.exec(
			`UPDATE software_agreement_links SET used_at='${EARLIER}',expires_at='${EARLIER}' WHERE id='link-1'`,
		);

		expect(await world.ok(readLinkByKey("key-link-1"))).toEqual({
			...signingLink("link-1"),
			used_at: EARLIER,
			expires_at: EARLIER,
		});
		expect(await world.ok(readLinkByKey("key-archive-1"))).toMatchObject({
			id: "archive-1",
			purpose: "archive",
			offer_id: null,
		});
		expect(await world.ok(readLinkByKey("no-such-key"))).toBeNull();
	});

	it("uses a signing link and makes the session, with its verified event, in one batch", async () => {
		const world = redeemWorld();

		await world.ok(redeem(signing()));

		expect(
			world.all("SELECT id,used_at FROM software_agreement_links ORDER BY id"),
		).toEqual([
			{ id: "archive-1", used_at: null },
			{ id: "link-1", used_at: AT },
		]);
		expect(
			world.all(
				"SELECT agreement_id,offer_id,action,actor,occurred_at FROM software_agreement_events",
			),
		).toEqual([
			{
				agreement_id: null,
				offer_id: "o1",
				action: "verified",
				actor: SESSION_HASH,
				occurred_at: AT,
			},
		]);
		expect(world.all("SELECT * FROM software_agreement_sessions")).toEqual([
			{
				token_hash: SESSION_HASH,
				purpose: "agreement",
				offer_id: "o1",
				link_hash: LINK_HASH,
				recipient_email: GRACE,
				link_id: "link-1",
				verified_at: AT,
				expires_at: TWO_HOURS,
				revoked_at: null,
				csrf_nonce: "nonce-new",
			},
		]);
	});

	it("uses an archive link without A1, whatever the offer", async () => {
		const world = redeemWorld();

		world.sql.exec(
			"UPDATE software_signing_settings SET software_signing_enabled=0",
		);

		await world.ok(redeem(archive));

		expect(
			world.all(
				"SELECT purpose,offer_id,link_hash,link_id FROM software_agreement_sessions",
			),
		).toEqual([
			{
				purpose: "archive",
				offer_id: null,
				link_hash: null,
				link_id: "archive-1",
			},
		]);
	});

	it("is GuardRefused, writing nothing, when A5 finds the link used or expired at the instant", async () => {
		for (const change of [
			`UPDATE software_agreement_links SET used_at='${EARLIER}'`,
			`UPDATE software_agreement_links SET expires_at='${AT}'`,
			"DELETE FROM software_agreement_links",
		])
			for (const session of [signing(), archive]) {
				const world = redeemWorld();

				world.sql.exec(change);

				const before = world.written();

				expect(await world.failed(redeem(session)), change).toBeInstanceOf(
					GuardRefused,
				);
				expect(world.written(), change).toEqual(before);
			}
	});

	it("is GuardRefused, writing nothing, when A1 finds the signing link's offer no longer open for signing", async () => {
		for (const change of NOT_OPEN) {
			const world = redeemWorld();

			world.sql.exec(change.sql);

			const before = world.written();

			expect(await world.failed(redeem(signing())), change.name).toBeInstanceOf(
				GuardRefused,
			);
			expect(world.written(), change.name).toEqual(before);
		}
	});

	it("is AgreementStoreFailed, writing nothing, for any other failure", async () => {
		const world = redeemWorld();

		world.seed({ software_agreement_sessions: [signingSession(SESSION_HASH)] });

		const before = world.written();
		const failed = await world.failed(redeem(signing()));

		expect(failed).toBeInstanceOf(AgreementStoreFailed);
		expect(causeOf(failed)).toMatch(
			/UNIQUE constraint failed: software_agreement_sessions.token_hash/,
		);
		expect(world.written()).toEqual(before);
	});
});

describe("the draft", () => {
	const SESSION = "session-1";

	const draft = (over: Partial<DraftWrite> = {}): DraftWrite => ({
		offerId: "o1",
		recipient: GRACE,
		linkHash: LINK_HASH,
		sessionHash: SESSION,
		values_json: JSON.stringify({ legal_name: "Grace Hopper LLC" }),
		updated_at: AT,
		...over,
	});

	function draftWorld() {
		const world = openWorld();

		world.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", { version: 2, status: "superseded" }),
			],
			software_agreement_links: [signingLink("link-1")],
			...rows.agreementBase(),
		});
		world.seed({ software_agreement_sessions: [signingSession(SESSION)] });

		return world;
	}

	it("reads the offer's agreements with their status and a project of the offer, or null", async () => {
		const world = draftWorld();

		expect(await world.ok(readDraftFacts("o1"))).toEqual({
			agreements: [],
			project: null,
		});

		world.seed({
			software_agreements: [
				rows.agreement("a1", "r1", "o1", { status: "review" }),
				rows.agreement("a2", "r1", "o2", { status: "abandoned" }),
				rows.agreement("a3", "r1", "o1", {
					kind: "sow",
					status: "client_signed",
				}),
			],
		});
		world.sql.exec(PROJECT_SQL);

		expect(await world.ok(readDraftFacts("o1"))).toEqual({
			agreements: [
				{ offer_id: "o1", status: "review" },
				{ offer_id: "o1", status: "client_signed" },
			],
			project: { offer_id: "o1" },
		});
		expect(await world.ok(readDraftFacts("o2"))).toEqual({
			agreements: [{ offer_id: "o2", status: "abandoned" }],
			project: null,
		});
	});

	it("upserts the draft of the offer and the session's address", async () => {
		const world = draftWorld();

		await world.ok(saveDraftBatch(draft(), AT));
		await world.ok(
			saveDraftBatch(
				draft({ values_json: '{"legal_name":"Grace"}', updated_at: LATER }),
				AT,
			),
		);

		expect(world.all("SELECT * FROM software_agreement_drafts")).toEqual([
			{
				offer_id: "o1",
				recipient_email: GRACE,
				values_json: '{"legal_name":"Grace"}',
				updated_at: LATER,
			},
		]);
	});

	it("is GuardRefused, writing nothing, when A1, A2 or A3 raises", async () => {
		const refusals: readonly {
			readonly name: string;
			readonly sql?: string;
			readonly write?: Partial<DraftWrite>;
			readonly now?: string;
		}[] = [
			...NOT_OPEN.map((change) => ({
				name: `A1: ${change.name}`,
				sql: change.sql,
			})),
			{ name: "A1: the session names no link", write: { linkHash: null } },
			{ name: "A2: the session expired at its clock reading", now: LATER },
			{
				name: "A2: the session is revoked",
				sql: `UPDATE software_agreement_sessions SET revoked_at='${EARLIER}'`,
			},
			{
				name: "A2: the session is gone",
				sql: "DELETE FROM software_agreement_sessions",
			},
			...["client_signed", "executed"].map((status) => ({
				name: `A3: an agreement of the offer is ${status}`,
				sql: `INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('a1','msa','o1','r1','client-1','template-msa','${status}','MSA','${"0".repeat(64)}','{}','${EARLIER}','2026-11-23','review-hash')`,
			})),
		];

		for (const refusal of refusals) {
			const world = draftWorld();

			await world.ok(saveDraftBatch(draft({ updated_at: EARLIER }), AT));

			if (refusal.sql) world.sql.exec(refusal.sql);

			const before = world.written();

			expect(
				await world.failed(
					saveDraftBatch(draft(refusal.write), refusal.now ?? AT),
				),
				refusal.name,
			).toBeInstanceOf(GuardRefused);
			expect(world.written(), refusal.name).toEqual(before);
		}
	});

	it("saves while another offer's agreement is signed or this offer's is in review or abandoned", async () => {
		const world = draftWorld();

		world.seed({
			software_agreements: [
				rows.agreement("a1", "r1", "o2", { status: "executed" }),
				rows.agreement("a2", "r1", "o1", { status: "review" }),
				rows.agreement("a3", "r1", "o1", { kind: "sow", status: "abandoned" }),
			],
		});

		await world.ok(saveDraftBatch(draft(), AT));

		expect(world.all("SELECT offer_id FROM software_agreement_drafts")).toEqual(
			[{ offer_id: "o1" }],
		);
	});

	it("is AgreementStoreFailed, writing nothing, for any other failure", async () => {
		const world = draftWorld();
		const before = world.written();

		const failed = await world.failed(
			saveDraftBatch(draft({ values_json: "not json" }), AT),
		);

		expect(failed).toBeInstanceOf(AgreementStoreFailed);
		expect(causeOf(failed)).toMatch(/CHECK constraint failed/);
		expect(world.written()).toEqual(before);
	});
});

// ---- the SQL against the signing corpora ----

/** The corpora that run the signing link, the redeem or the draft, today and once converted. */
const CORPORA = [
	"offer-link",
	"offer-draft",
	"offer-review",
	"offer-sign",
	"offer-verify-page",
	"agreements-verify-page",
	"agreements-link",
] as const;

const root = new URL("../../", import.meta.url);

type RecordedStatement = { readonly sql: string };

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly RecordedStatement[];
};

/** Every recorded effect of the corpora's fixtures. */
function recordedEffects(): RecordedEffect[] {
	return CORPORA.flatMap((corpus) =>
		// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases, each with its effects.
		(
			JSON.parse(
				gunzipSync(
					readFileSync(
						new URL(`tests/golden/fixtures/${corpus}.json.gz`, root),
					),
				).toString("utf8"),
			) as { effects: RecordedEffect[] }[]
		).flatMap((recorded) => recorded.effects),
	);
}

/**
 * Every regular expression literal in the corpora's test files and their shared builders: every hook pattern (an `on`
 * written as a literal, or passed to a builder as one) and the few others, so "matches none" is checked against more
 * than the hooks, never fewer.
 */
function corpusPatterns(): RegExp[] {
	const files = [
		...CORPORA.map((corpus) => `tests/golden/${corpus}.test.ts`),
		"tests/golden/areas/agreement-access.ts",
		"tests/golden/areas/signing.ts",
	];

	const found = new Map<string, RegExp>();

	for (const file of files) {
		const source = ts.createSourceFile(
			file,
			readFileSync(new URL(file, root), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);

		const visit = (node: ts.Node) => {
			if (ts.isRegularExpressionLiteral(node)) {
				const end = node.text.lastIndexOf("/");

				found.set(
					node.text,
					new RegExp(node.text.slice(1, end), node.text.slice(end + 1)),
				);
			}

			ts.forEachChild(node, visit);
		};

		visit(source);
	}

	return [...found.values()];
}

/** Today's texts that this block's functions replace with another text, from today's code (src/lib). */
const TODAY = {
	linkedOffer: `SELECT o.* FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id
    JOIN owner_requests r ON r.id=o.request_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND o.status='sent'
    AND r.kind='software' AND r.status NOT IN ('withdrawn','resolved') AND r.email<>''`,
	redeemRead:
		"SELECT * FROM software_agreement_links WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?",
	consume:
		"UPDATE software_agreement_links SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL AND id<>? AND issued_at<=?",
	liveCheck:
		"SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END",
};

/** What each function of the block runs, in a world where it runs to its end: the texts of each call in order. */
async function tour() {
	const calls: { readonly name: string; readonly sql: readonly string[] }[] =
		[];

	const run = async <A, E>(
		name: string,
		effect: Effect.Effect<A, E, MusicDb>,
		prepare: (world: World) => void = () => {},
	) => {
		const world = openWorld();

		world.seed({
			software_agreement_links: [
				signingLink("link-1"),
				signingLink("archive-1", {
					purpose: "archive",
					offer_id: null,
					link_hash: null,
				}),
			],
			audio_client_allowances: [
				{ key: "ip-key", window_start: SINCE, uses: 2 },
				{ key: "email-key", window_start: AT, uses: 1 },
			],
		});
		world.seed({ software_agreement_sessions: [signingSession("session-1")] });
		prepare(world);
		world.executed.length = 0;
		await world.ok(effect);
		calls.push({ name, sql: [...world.executed] });
	};

	await run("readSigningEnabled", readSigningEnabled());
	await run("readLinkedOffer", readLinkedOffer(LINK_HASH));
	await run(
		"readSigningFacts",
		readSigningFacts({ offerId: "o1", linkHash: LINK_HASH }),
	);
	await run("readSigningLinks", readSigningLinks(GRACE, "o1"));
	await run(
		"readRecentSigningLinks",
		readRecentSigningLinks(GRACE, "o1", SINCE),
	);
	await run(
		"storeSigningLink",
		storeSigningLink({
			id: "link-new",
			hash: "key-new",
			actorHash: "actor",
			offerId: "o1",
			linkHash: LINK_HASH,
			recipient: GRACE,
			at: AT,
			since: SINCE,
			expiresAt: HOUR_LATER,
		}),
		(world) =>
			world.sql.exec(
				"UPDATE software_agreement_links SET issued_at='2000-01-01'",
			),
	);
	await run("readBriefName", readBriefName("r1"));
	await run(
		"removeRefusedLink",
		removeRefusedLink({
			linkId: "link-1",
			uses: [
				{ key: "ip-key", window_start: SINCE },
				{ key: "email-key", window_start: AT },
			],
		}),
	);
	await run("consumeLinks", consumeLinks(["link-1"], AT));
	await run("readLinkByKey", readLinkByKey("key-link-1"));
	await run(
		"redeemLinkBatch (signing)",
		redeemLinkBatch({
			session: {
				purpose: "agreement",
				at: AT,
				keyHash: "key-link-1",
				linkId: "link-1",
				offerId: "o1",
				linkHash: LINK_HASH,
				recipient: GRACE,
				expiresAt: LATER,
				location: "/offer/token/sign",
				live: { offerId: "o1", linkHash: LINK_HASH, recipient: GRACE },
			},
			sessionHash: "session-new",
			csrfNonce: "nonce",
		}),
	);
	await run(
		"redeemLinkBatch (archive)",
		redeemLinkBatch({
			session: {
				purpose: "archive",
				at: AT,
				keyHash: "key-archive-1",
				linkId: "archive-1",
				offerId: null,
				linkHash: null,
				recipient: GRACE,
				expiresAt: LATER,
				location: "/agreements",
				live: null,
			},
			sessionHash: "session-new",
			csrfNonce: "nonce",
		}),
	);
	await run("readDraftFacts", readDraftFacts("o1"));
	await run(
		"saveDraftBatch",
		saveDraftBatch(
			{
				offerId: "o1",
				recipient: GRACE,
				linkHash: LINK_HASH,
				sessionHash: "session-1",
				values_json: "{}",
				updated_at: AT,
			},
			AT,
		),
	);

	return calls;
}

/** The calls whose texts are each today's own, statement for statement (a batch in today's order). */
const KEPT = [
	"readSigningEnabled",
	"readSigningFacts",
	"storeSigningLink",
	"readBriefName",
	"removeRefusedLink",
	"redeemLinkBatch (signing)",
	"redeemLinkBatch (archive)",
	"saveDraftBatch",
];

/** Texts that replace one of today's where a rule now decides what today's SQL filtered: every hook keeps its pick. */
const CHANGED = [
	{
		old: TODAY.linkedOffer,
		call: "readLinkedOffer",
		why: "getLinkedOffer's filters moved into linkedOffer; the first statement keeps the text the hooks pick",
	},
	{
		old: TODAY.redeemRead,
		call: "readLinkByKey",
		why: "the redeem read's purpose, used_at and expires_at filters moved into redeemLink",
	},
];

/**
 * Statements whose hook pattern PR 4's re-record re-points (plan section 4): the converted statement does the same work
 * on the same table, so the trigger-hit marker stays, but the pattern no longer picks it.
 */
const REPOINTED = [
	{
		old: TODAY.consume,
		call: "consumeLinks",
		pattern: /UPDATE software_agreement_links SET used_at=\? WHERE purpose/,
		why: "A6 reuses consumeLinks over the ids consumeOlderLinks picks (offer-link: the used_at update after a sent email fails)",
	},
	{
		old: TODAY.liveCheck,
		call: "readSigningFacts",
		pattern:
			/SELECT CASE WHEN EXISTS\(SELECT 1 FROM software_offers o JOIN software_offer_links/,
		why: "the redeem's GET reads the signing state for stillOpenForSigning in place of running A1 as a read (offer-verify-page: the GET's live check, nth 2)",
	},
];

/** Reads today's code does not make where the converted flows make them. */
const ADDED = [
	{
		call: "readLinkedOffer",
		index: 1,
		why: "the offer link and the brief beside the offers, for linkedOffer",
	},
	{
		call: "readSigningLinks",
		index: 0,
		why: "the recipient's links after the mail, for consumeOlderLinks",
	},
	{
		call: "readRecentSigningLinks",
		index: 0,
		why: "the recipient's links issued after the window's start, before each try of the link batch (A4's facts)",
	},
	{
		call: "readSigningFacts",
		index: 0,
		why: "the offer's signing state before each try of the link batch (A1's facts), and for the redeem's GET",
	},
	{
		call: "readDraftFacts",
		index: 0,
		why: "A3's facts before the draft batch",
	},
	{
		call: "readDraftFacts",
		index: 1,
		why: "A1's project before the draft batch",
	},
];

describe("the store's SQL against the signing corpora", () => {
	it("runs today's texts for today's statements, each batch in an order the corpora recorded", async () => {
		const effects = recordedEffects();
		const calls = await tour();

		const texts = new Set(
			effects.flatMap((effect) => [
				...(effect.sql === undefined ? [] : [effect.sql]),
				...(effect.statements ?? []).map((statement) => statement.sql),
			]),
		);

		const batches = new Set(
			effects.flatMap((effect) =>
				effect.kind === "d1-batch" && effect.statements
					? [
							JSON.stringify(
								effect.statements.map((statement) => statement.sql),
							),
						]
					: [],
			),
		);

		for (const name of KEPT) {
			const call = calls.find((ran) => ran.name === name);

			expect(call, name).toBeDefined();

			for (const sql of call?.sql ?? [])
				expect(texts.has(sql), `${name}: ${sql}`).toBe(true);

			if ((call?.sql.length ?? 0) > 1)
				expect(batches.has(JSON.stringify(call?.sql)), name).toBe(true);
		}

		expect(texts.has(TODAY.linkedOffer)).toBe(true);
		expect(texts.has(TODAY.redeemRead)).toBe(true);
		expect(texts.has(TODAY.liveCheck)).toBe(true);
		// The signing link's own consume (TODAY.consume) left the corpora when the link was converted (its re-recorded
		// fixtures run `consumeLinks`); the re-pointed hook is checked against its old text below.
	});

	it("keeps every hook's pick for a changed text, names each re-pointed pattern, and adds reads no pattern picks", async () => {
		const patterns = corpusPatterns();
		const calls = await tour();

		const ran = (name: string) =>
			calls.find((call) => call.name === name)?.sql ?? [];

		const matching = (sql: string) =>
			patterns.filter((pattern) => pattern.test(sql)).map(String);

		expect(patterns.length).toBeGreaterThan(30);

		for (const change of CHANGED) {
			const [sql] = ran(change.call);

			expect(sql, change.why).toBeDefined();
			expect(matching(sql ?? ""), change.why).toEqual(matching(change.old));
			expect(matching(change.old).length, change.why).toBeGreaterThan(0);
			expect(statementOf(sql ?? ""), change.why).toEqual(
				statementOf(change.old),
			);
		}

		for (const repoint of REPOINTED) {
			const [sql] = ran(repoint.call);

			expect(sql, repoint.why).toBeDefined();
			expect(repoint.pattern.test(repoint.old), repoint.why).toBe(true);
			expect(repoint.pattern.test(sql ?? ""), repoint.why).toBe(false);
			expect(statementOf(sql ?? ""), repoint.why).toEqual(
				statementOf(repoint.old),
			);
		}

		for (const added of ADDED) {
			const sql = ran(added.call)[added.index];

			expect(sql, added.why).toBeDefined();
			expect(matching(sql ?? ""), added.why).toEqual([]);
		}
	});
});
