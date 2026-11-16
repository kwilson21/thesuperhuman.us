import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import { statementOf } from "../../scripts/sql-effects.mjs";
import { retireRequestSigning } from "../../src/lib/software-agreements";
import {
	type DepositInvoice,
	depositBlock,
} from "../../src/lib/software-deposit-block";
import {
	depositOfferBlock,
	depositOfferGuard,
} from "../../src/lib/software-offer-deposit";
import { offerSendingGuard } from "../../src/lib/software-offers";
import { OFFER_MOVES } from "../../src/server/machines/offer-version";
import {
	ChangedSinceRead,
	decideAndSave,
	SaveKeptChanging,
} from "../../src/server/guarded-save";
import {
	GuardRefused,
	OffersStoreFailed,
	readAttachmentRow,
	readAttachmentRows,
	readAudioProject,
	readClosedArchives,
	readContractorConfig,
	readCurrentTemplate,
	readDepositInvoices,
	readFreshLiveLink,
	readLinkLive,
	readLinkRow,
	readLinkStillLive,
	readMsaExists,
	readOfferLeft,
	readOffers,
	readProjectStarted,
	readRemovedAttachments,
	readRequest,
	readReusableMsa,
	readSignedAgreement,
	readSigningEnabled,
	recordQuestion,
	reserveQuestion,
	resolveDeclined,
	restoreAttachment,
	retireSigning,
	revokeOfferLink,
	saveDraftBatch,
	saveFit,
	saveSend,
	statusIs,
	withdrawForDecline,
} from "../../src/server/offers-store";
import type {
	DeclineWrite,
	ResolveWrite,
} from "../../src/server/rules/offer-decline";
import { depositAllowsSend } from "../../src/server/rules/offer-deposit";
import type {
	DraftWrite,
	RemovedAttachment,
} from "../../src/server/rules/offer-draft";
import type { FitWrite } from "../../src/server/rules/offer-fit";
import type { Pin } from "../../src/server/rules/offer-pin";
import type { QuestionWrite } from "../../src/server/rules/offer-question";
import type { RevokeWrite } from "../../src/server/rules/offer-revoke";
import type { SendWrite } from "../../src/server/rules/offer-send";
import {
	attachmentsUsable,
	type NamedAttachment,
	outsideClosedArchives,
	type RequestRead,
	retireSigning as retiredAt,
} from "../../src/server/rules/software-request";
import { MusicDb } from "../../src/server/services";
import { boundStatement } from "../helpers/d1";
import { double } from "../helpers/doubles";
import {
	hookPatterns,
	recordedBatches,
	recordedSql,
} from "../helpers/offers-golden";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";

// The offers store (src/server/offers-store.ts) against the real schema on node:sqlite: what each read finds, what each
// batch writes, and the failure each answers with (OffersStoreFailed for a rejection, GuardRefused for a refused guard,
// ChangedSinceRead for the draft's unique indexes). And its SQL against the golden corpus: every text it runs is one the
// old route ran (and the fixtures recorded), or one of the few listed below, none of which a golden hook picks.

const EARLIER = "2026-11-13T11:00:00.000Z";
const AT = "2026-11-13T12:00:00.000Z";

/** The start of the sending window at AT: 20 seconds before. */
const SINCE = "2026-11-13T11:59:40.000Z";
const OWNER = "owner@example.test";

/** A world: the real schema, every statement the store prepares recorded, and one statement failing when asked to. */
function offersWorld(fail?: { readonly on: RegExp; readonly message: string }) {
	const sql = freshMusicDb();
	const executed: string[] = [];

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (fail?.on.test(query)) throw new Error(fail.message);

			return sql.prepare(query);
		},
		exec: (query: string) => sql.exec(query),
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
	};
}

type World = ReturnType<typeof offersWorld>;

/** The request as read: reviewed, with the time it was seeded at. */
const request: RequestRead = {
	id: "r1",
	updatedAt: EARLIER,
	status: "reviewed",
	email: "grace@example.test",
};

const withRequest = (world: World, over = {}) =>
	world.seed({
		owner_requests: [
			rows.softwareRequest("r1", { status: "reviewed", ...over }),
		],
	});

const signing = retiredAt(AT);

const fitWrite: FitWrite = {
	request,
	label: "potential-fit",
	note: "Looks right.",
	at: AT,
	actor: OWNER,
	audit: "fit-reviewed",
};

const questionWrite: QuestionWrite = {
	request,
	at: AT,
	actor: OWNER,
	to: request.email,
	email: { subject: "A question", text: "Which users?\n\nKazon" },
	audit: "question-sent",
};

const declineWrite: DeclineWrite = {
	request,
	at: AT,
	actor: OWNER,
	withdraw: OFFER_MOVES.WITHDRAW,
	signing,
	audit: {
		action: "offer-link-revoked",
		note: "Offer withdrawn and link closed to decline the request",
	},
	to: request.email,
	email: { subject: "About your project brief", text: "No.\n\nKazon" },
};

const resolveWrite: ResolveWrite = {
	request: { ...request, updatedAt: AT },
	at: AT,
	actor: OWNER,
	status: "resolved",
	noOfferIn: OFFER_MOVES.WITHDRAW.from,
	audit: "declined",
};

const revokeWrite: RevokeWrite = {
	request,
	at: AT,
	actor: OWNER,
	linkCreatedAt: EARLIER,
	signing,
	audit: { action: "offer-link-revoked", note: "" },
};

const KEY = "agreements/attachments/123e4567-e89b-42d3-a456-426614174000.pdf";

const OTHER_KEY =
	"agreements/attachments/223e4567-e89b-42d3-a456-426614174000.pdf";

const named: NamedAttachment = {
	filename: "Requirements.pdf",
	version: "v2",
	date: "2026-10-01",
	sha256: "a".repeat(64),
	key: KEY,
	bytes: 1234,
};

/** The metadata row of an attachment, every column. */
const attachmentRow = (
	id: string,
	key: string,
	over: Partial<RemovedAttachment> = {},
): RemovedAttachment => ({
	id,
	request_id: "r1",
	filename: named.filename,
	version: named.version,
	document_date: named.date,
	object_key: key,
	sha256: named.sha256,
	bytes: named.bytes,
	created_at: EARLIER,
	created_by: OWNER,
	...over,
});

const newDraft = (over: Partial<DraftWrite> = {}): DraftWrite => ({
	request,
	at: AT,
	actor: OWNER,
	id: "o2",
	version: 2,
	save: { kind: "insert", version: 2 },
	termsJson: '{"outcome":"New"}',
	attachments: [],
	details: null,
	reusedMsa: null,
	removed: [],
	audit: "offer-draft-saved",
	...over,
});

const pin: Pin = {
	details: JSON.stringify({ attachments: [named] }),
	msa: "template-msa",
	sow: "template-sow",
	contractor: '{"legal_name":"Example","config_version":1}',
	email: "grace@example.test",
	attachments: [named],
};

const sendWrite = (over: Partial<SendWrite> = {}): SendWrite => ({
	request,
	at: AT,
	actor: OWNER,
	offer: {
		id: "o2",
		version: 2,
		status: "draft",
		updatedAt: EARLIER,
		sentAt: null,
	},
	move: {
		kind: "send",
		supersede: OFFER_MOVES.SUPERSEDE,
		markSent: OFFER_MOVES.SEND,
	},
	link: { href: "https://example.test/offer/t", tokenHash: "new-hash" },
	pin: null,
	signing,
	audit: { action: "offer-sent", note: "Offer v2 sent" },
	to: request.email,
	email: { subject: "Your project offer: X", text: "Hi" },
	...over,
});

const reissue = (): SendWrite =>
	sendWrite({
		offer: {
			id: "o1",
			version: 1,
			status: "sent",
			updatedAt: EARLIER,
			sentAt: EARLIER,
		},
		move: { kind: "reissue", move: OFFER_MOVES.REISSUE },
		audit: { action: "offer-sent", note: "Offer v1 sent" },
	});

/** The sow template, beside the msa template `rows.agreementBase` gives. */
const sowTemplate = {
	id: "template-sow",
	kind: "sow",
	version: 1,
	text: "SOW",
	sha256: "0".repeat(64),
	published_at: EARLIER,
	published_by: OWNER,
};

/** A sent offer o1 and an open draft o2 of the request. */
const sentAndDraft = (world: World) =>
	world.seed({
		software_offers: [
			rows.softwareOffer("o1", "r1"),
			rows.softwareOffer("o2", "r1", {
				version: 2,
				status: "draft",
				sent_at: null,
				sent_by: null,
			}),
		],
	});

const statusOf = (world: World, id: string) =>
	world.all("SELECT status FROM software_offers WHERE id=?", id)[0]?.status;

describe("the store's reads", () => {
	it("reads the request, or null, and fails on details that are not JSON as getOwnerRequest did", async () => {
		const world = offersWorld();

		withRequest(world);
		world.seed({
			owner_requests: [
				rows.softwareRequest("r2", { details_json: "{not json" }),
			],
		});

		expect(await world.ok(readRequest("missing"))).toBeNull();

		expect(await world.ok(readRequest("r1"))).toMatchObject({
			id: "r1",
			kind: "software",
			status: "reviewed",
			details: {},
		});

		const failure = await world.failed(readRequest("r2"));

		expect(failure).toBeInstanceOf(OffersStoreFailed);
		expect(failure.failure).toBeInstanceOf(SyntaxError);
	});

	it("carries a rejected read's error in `failure`, for the route's log", async () => {
		const world = offersWorld({
			on: /FROM owner_requests WHERE id=\?/,
			message: "D1 is down",
		});

		const failure = await world.failed(readRequest("r1"));

		expect(failure).toBeInstanceOf(OffersStoreFailed);
		expect(failure.failure).toEqual(new Error("D1 is down"));
	});

	it("reads a started project, the offers newest first and a live link made after the window's start", async () => {
		const world = offersWorld();

		withRequest(world);
		sentAndDraft(world);

		expect(await world.ok(readProjectStarted("r1"))).toBe(false);
		expect((await world.ok(readOffers("r1"))).map((offer) => offer.id)).toEqual(
			["o2", "o1"],
		);

		world.seed({ software_offer_links: [rows.offerLink("r1")] });
		expect(await world.ok(readFreshLiveLink("r1", SINCE))).toBe(false);
		expect(
			await world.ok(readFreshLiveLink("r1", "2026-11-13T10:59:59.000Z")),
		).toBe(true);

		world.seed({ software_projects: [rows.softwareProject("r1", "o1")] });
		expect(await world.ok(readProjectStarted("r1"))).toBe(true);
	});

	it("reads a signed agreement only when one is client_signed or executed", async () => {
		const world = offersWorld();

		withRequest(world);
		sentAndDraft(world);
		world.seed(rows.agreementBase());

		for (const [status, signed] of [
			["review", false],
			["abandoned", false],
			["client_signed", true],
			["executed", true],
		] as const) {
			world.sql.exec("DELETE FROM software_agreements");
			world.seed({
				software_agreements: [rows.agreement("a1", "r1", "o1", { status })],
			});
			expect(await world.ok(readSignedAgreement("r1")), status).toBe(signed);
		}
	});

	it("reads an audio project of the request", async () => {
		const world = offersWorld();

		withRequest(world);
		expect(await world.ok(readAudioProject("r1"))).toBe(false);

		world.seed({
			audio_projects: [
				{ request_id: "r1", created_at: EARLIER, updated_at: EARLIER },
			],
		});
		expect(await world.ok(readAudioProject("r1"))).toBe(true);
	});

	it("reads the request's link row, and whether the page's link is still live", async () => {
		const world = offersWorld();

		withRequest(world);
		expect(await world.ok(readLinkRow("r1"))).toBeNull();

		world.seed({ software_offer_links: [rows.offerLink("r1")] });
		expect(await world.ok(readLinkRow("r1"))).toEqual({
			created_at: EARLIER,
			revoked_at: null,
		});
		expect(await world.ok(readLinkLive("r1", EARLIER))).toBe(true);
		expect(await world.ok(readLinkLive("r1", AT))).toBe(false);
	});
});

describe("the deposit read", () => {
	const STATUSES = [
		"creating",
		"open",
		"paid",
		"payment_failed",
		"void",
		"uncollectible",
	] as const;

	const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"] as const;

	const KINDS = ["deposit", "balance", "milestone"] as const;

	/** Every invoice the columns allow. */
	const every: DepositInvoice[] = [0, 1, 2].flatMap((milestoneIndex) =>
		KINDS.flatMap((kind) =>
			STATUSES.flatMap((status) =>
				[false, true].flatMap((refunded) =>
					OFFER_STATUSES.map((offerStatus) => ({
						milestoneIndex,
						kind,
						status,
						refunded,
						offerStatus,
					})),
				),
			),
		),
	);

	const firstDeposits = every.filter(
		(invoice) => invoice.milestoneIndex === 0 && invoice.kind === "deposit",
	);

	/** Stores the invoices, each on an offer of its own with the offer status given, all for the one request. */
	function store(world: World, invoices: readonly DepositInvoice[]) {
		world.sql.exec(
			"DELETE FROM software_invoices; DELETE FROM software_offers",
		);

		invoices.forEach((invoice, index) => {
			world.seed({
				software_offers: [
					rows.softwareOffer(`o${index}`, "r1", {
						version: index + 1,
						status: invoice.offerStatus,
					}),
				],
				software_invoices: [
					rows.softwareInvoice(`i${index}`, "r1", `o${index}`, {
						milestone_index: invoice.milestoneIndex,
						kind: invoice.kind,
						status: invoice.status,
						refunded_at: invoice.refunded ? EARLIER : null,
					}),
				],
			});
		});
	}

	/** What the rule decides from the store's rows, as the old read answered it: its sentence, or null. */
	const sendSentence = (invoices: readonly DepositInvoice[]) =>
		Effect.runSync(
			Effect.match(depositAllowsSend.decide(null, { invoices }), {
				onFailure: (refusal): string | null => refusal.say,
				onSuccess: () => null,
			}),
		);

	async function compare(world: World, invoices: readonly DepositInvoice[]) {
		store(world, invoices);

		const read = await world.ok(readDepositInvoices("r1"));
		const db = sqliteD1(world.sql);

		expect(read).toEqual(invoices);
		expect(sendSentence(read), JSON.stringify(invoices)).toBe(
			await depositOfferBlock(db, "r1"),
		);
		expect(
			depositBlock([...read], true) === "open",
			JSON.stringify(invoices),
		).toBe((await depositOfferBlock(db, "r1", true)) !== null);
	}

	it("reads every invoice with its offer's status, and the rule then answers as the old read and guard did", async () => {
		const world = offersWorld();

		withRequest(world);

		expect(every).toHaveLength(432);

		for (const invoice of every) await compare(world, [invoice]);
	});

	it("agrees with the old read on every pair of first deposits whose offers can coexist", async () => {
		const world = offersWorld();

		withRequest(world);

		let compared = 0;

		for (const first of firstDeposits)
			for (const second of firstDeposits) {
				// One draft and one sent offer per request, at most.
				if (
					first.offerStatus === second.offerStatus &&
					(first.offerStatus === "draft" || first.offerStatus === "sent")
				)
					continue;

				await compare(world, [first, second]);
				compared += 1;
			}

		expect(compared).toBeGreaterThan(1000);
	});

	it("joins each invoice to its offer, as the guard does, and the guard refuses exactly what the rule refuses", async () => {
		const world = offersWorld();

		withRequest(world);
		store(world, [
			{
				milestoneIndex: 0,
				kind: "deposit",
				status: "paid",
				refunded: false,
				offerStatus: "withdrawn",
			},
		]);

		const db = sqliteD1(world.sql);

		const refuses = depositOfferGuard(db, "r1")
			.first()
			.then(
				() => false,
				() => true,
			);

		expect(
			depositBlock([...(await world.ok(readDepositInvoices("r1")))], false),
		).toBe("paidEarlier");
		expect(await refuses).toBe(true);
		expect(world.executed.at(-2)).toMatch(
			/ JOIN software_offers o ON o\.id=i\.offer_id /,
		);
		expect(world.executed.at(-1)).toMatch(
			/ JOIN software_offers o ON o\.id=i\.offer_id /,
		);
	});

	it("fails as a whole when the read fails", async () => {
		const world = offersWorld({
			on: /SELECT i\.status,o\.status AS offer_status FROM software_invoices/,
			message: "D1 is down",
		});

		withRequest(world);
		expect(await world.failed(readDepositInvoices("r1"))).toBeInstanceOf(
			OffersStoreFailed,
		);
	});
});

describe("fit and question", () => {
	it("saves a fit review, the request's updated_at and the audit", async () => {
		const world = offersWorld();

		withRequest(world);
		await world.ok(saveFit(fitWrite));

		expect(
			world.all(
				"SELECT label,note,updated_at,updated_by FROM software_fit_reviews",
			),
		).toEqual([
			{
				label: "potential-fit",
				note: "Looks right.",
				updated_at: AT,
				updated_by: OWNER,
			},
		]);
		expect(world.all("SELECT updated_at FROM owner_requests")).toEqual([
			{ updated_at: AT },
		]);
		expect(
			world.all(
				"SELECT action,actor,note,occurred_at FROM owner_request_audit",
			),
		).toEqual([
			{ action: "fit-reviewed", actor: OWNER, note: "", occurred_at: AT },
		]);
	});

	it("is GuardRefused when the request changed since it was read, and writes nothing", async () => {
		const world = offersWorld();

		withRequest(world, { updated_at: "2026-11-13T11:30:00.000Z" });

		expect(await world.failed(saveFit(fitWrite))).toBeInstanceOf(GuardRefused);
		expect(world.all("SELECT * FROM software_fit_reviews")).toEqual([]);
	});

	it("is OffersStoreFailed, with the error, when the batch fails for another reason", async () => {
		const world = offersWorld({
			on: /INSERT INTO software_fit_reviews/,
			message: "D1 is down",
		});

		withRequest(world);

		const failure = await world.failed(saveFit(fitWrite));

		expect(failure).toBeInstanceOf(OffersStoreFailed);
		expect(failure).toMatchObject({ failure: new Error("D1 is down") });
	});

	it("reserves a question, then records it against the updated_at the reservation wrote", async () => {
		const world = offersWorld();

		withRequest(world);
		await world.ok(reserveQuestion(questionWrite));
		await world.ok(recordQuestion(questionWrite));

		expect(world.all("SELECT updated_at FROM owner_requests")).toEqual([
			{ updated_at: AT },
		]);
		expect(world.all("SELECT action FROM owner_request_audit")).toEqual([
			{ action: "question-sent" },
		]);
	});

	it("refuses a question's batches once a project has started", async () => {
		const world = offersWorld();

		withRequest(world);
		world.seed({
			software_offers: [rows.softwareOffer("o1", "r1")],
			software_projects: [rows.softwareProject("r1", "o1")],
		});

		expect(await world.failed(reserveQuestion(questionWrite))).toBeInstanceOf(
			GuardRefused,
		);
		expect(await world.failed(recordQuestion(questionWrite))).toBeInstanceOf(
			GuardRefused,
		);
	});
});

describe("decline", () => {
	const seeded = () => {
		const world = offersWorld();

		withRequest(world);
		world.seed({
			software_offers: [
				rows.softwareOffer("o0", "r1", { version: 1, status: "superseded" }),
				rows.softwareOffer("o1", "r1", { version: 2 }),
				rows.softwareOffer("o2", "r1", {
					version: 3,
					status: "draft",
					sent_at: null,
					sent_by: null,
				}),
			],
			software_offer_links: [rows.offerLink("r1")],
			...rows.agreementBase(),
		});
		world.seed({
			software_agreements: [
				rows.agreement("a1", "r1", "o1", { status: "review" }),
			],
		});

		return world;
	};

	it("withdraws the draft and sent offers, retires signing, closes the link and writes the audit", async () => {
		const world = seeded();

		await world.ok(withdrawForDecline(declineWrite, SINCE));

		expect(
			world.all("SELECT id,status,updated_at FROM software_offers ORDER BY id"),
		).toEqual([
			{ id: "o0", status: "superseded", updated_at: EARLIER },
			{ id: "o1", status: "withdrawn", updated_at: AT },
			{ id: "o2", status: "withdrawn", updated_at: AT },
		]);
		expect(
			world.all("SELECT status,retain_until FROM software_agreements"),
		).toEqual([{ status: "abandoned", retain_until: signing.retainUntil }]);
		expect(world.all("SELECT revoked_at FROM software_offer_links")).toEqual([
			{ revoked_at: AT },
		]);
		expect(world.all("SELECT action,note FROM owner_request_audit")).toEqual([
			{
				action: "offer-link-revoked",
				note: "Offer withdrawn and link closed to decline the request",
			},
		]);
	});

	it.each([
		[
			"a signed agreement",
			(world: World) =>
				world.sql.exec("UPDATE software_agreements SET status='client_signed'"),
		],
		[
			"a link made after the window's start",
			(world: World) =>
				world.sql.exec(`UPDATE software_offer_links SET created_at='${AT}'`),
		],
		[
			"an open first deposit",
			(world: World) =>
				world.seed({
					software_invoices: [rows.softwareInvoice("i1", "r1", "o1")],
				}),
		],
		[
			"an audio project",
			(world: World) =>
				world.seed({
					audio_projects: [
						{ request_id: "r1", created_at: EARLIER, updated_at: EARLIER },
					],
				}),
		],
		[
			"a started project",
			(world: World) =>
				world.seed({ software_projects: [rows.softwareProject("r1", "o1")] }),
		],
		[
			"a changed request",
			(world: World) =>
				world.sql.exec(`UPDATE owner_requests SET updated_at='${AT}'`),
		],
	])(
		"refuses the first batch on %s, and writes nothing",
		async (_name, change) => {
			const world = seeded();

			change(world);

			expect(
				await world.failed(withdrawForDecline(declineWrite, SINCE)),
			).toBeInstanceOf(GuardRefused);
			expect(statusOf(world, "o1")).toBe("sent");
		},
	);

	it("reads an offer left after the email, and resolves only when none is", async () => {
		const world = seeded();

		expect(await world.ok(readOfferLeft("r1"))).toBe(true);
		await world.ok(withdrawForDecline(declineWrite, SINCE));
		expect(await world.ok(readOfferLeft("r1"))).toBe(false);

		await world.ok(resolveDeclined(resolveWrite, SINCE));

		expect(
			world.all("SELECT status,resolved_at,updated_at FROM owner_requests"),
		).toEqual([{ status: "resolved", resolved_at: AT, updated_at: AT }]);
		expect(
			world.all("SELECT action FROM owner_request_audit ORDER BY id"),
		).toEqual([{ action: "offer-link-revoked" }, { action: "declined" }]);
	});

	it("refuses the second batch when a draft was saved during the email (F10)", async () => {
		const world = seeded();

		await world.ok(withdrawForDecline(declineWrite, SINCE));
		world.seed({
			software_offers: [
				rows.softwareOffer("o3", "r1", {
					version: 4,
					status: "draft",
					sent_at: null,
					sent_by: null,
				}),
			],
		});

		expect(
			await world.failed(resolveDeclined(resolveWrite, SINCE)),
		).toBeInstanceOf(GuardRefused);
		expect(world.all("SELECT status FROM owner_requests")).toEqual([
			{ status: "reviewed" },
		]);
	});
});

describe("revoke", () => {
	const seeded = () => {
		const world = offersWorld();

		withRequest(world);
		world.seed({
			software_offers: [rows.softwareOffer("o1", "r1")],
			software_offer_links: [rows.offerLink("r1")],
		});

		return world;
	};

	it("closes the page's link and writes the audit with no note", async () => {
		const world = seeded();

		await world.ok(revokeOfferLink(revokeWrite, SINCE));

		expect(world.all("SELECT revoked_at FROM software_offer_links")).toEqual([
			{ revoked_at: AT },
		]);
		expect(world.all("SELECT action,note FROM owner_request_audit")).toEqual([
			{ action: "offer-link-revoked", note: "" },
		]);
	});

	it("is GuardRefused for another link, or one made after the window's start", async () => {
		const other = seeded();

		other.sql.exec(
			"UPDATE software_offer_links SET created_at='2026-11-13T10:00:00.000Z'",
		);
		expect(
			await other.failed(revokeOfferLink(revokeWrite, SINCE)),
		).toBeInstanceOf(GuardRefused);

		const fresh = seeded();

		expect(
			await fresh.failed(
				revokeOfferLink(revokeWrite, "2026-11-13T10:59:59.000Z"),
			),
		).toBeInstanceOf(GuardRefused);
	});
});

describe("draft", () => {
	const seeded = () => {
		const world = offersWorld();

		withRequest(world);
		world.seed({ software_offers: [rows.softwareOffer("o1", "r1")] });

		return world;
	};

	it("reads the removed attachments' rows, the named ones' columns, and an MSA by id", async () => {
		const world = seeded();

		world.seed({
			software_agreement_attachments: [
				attachmentRow("f1", KEY),
				attachmentRow("f2", OTHER_KEY),
			],
		});

		expect(await world.ok(readRemovedAttachments("r1", [KEY]))).toEqual([
			attachmentRow("f1", KEY),
		]);
		expect(await world.ok(readAttachmentRows("r1", [KEY, "missing"]))).toEqual([
			{
				object_key: KEY,
				sha256: named.sha256,
				bytes: named.bytes,
				filename: named.filename,
				version: named.version,
				document_date: named.date,
			},
		]);
		expect(await world.ok(readAttachmentRows("r2", [KEY]))).toEqual([]);
		expect(await world.ok(readMsaExists("a1"))).toBe(false);
	});

	it("reads the keys a closed archive names, passing over an open archive's manifest", async () => {
		const world = seeded();

		world.seed(rows.agreementBase());
		world.seed({
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "executed",
					attachment_manifest_json: JSON.stringify([
						null,
						1,
						true,
						{ key: KEY },
					]),
					archive_closed_at: EARLIER,
				}),
				rows.agreement("a2", "r1", "o1", {
					status: "review",
					attachment_manifest_json: "{not json",
				}),
			],
		});

		expect(await world.ok(readClosedArchives([KEY, OTHER_KEY]))).toEqual({
			keys: [KEY],
			unreadable: false,
		});
		expect(await world.ok(readClosedArchives([OTHER_KEY]))).toEqual({
			keys: [],
			unreadable: false,
		});
	});

	// G11 reads each closed archive's manifest with json_each and each entry with json_extract, which raise "malformed
	// JSON", the guard's own message, on a value that is not JSON: the batch is refused and answered by the reads after a
	// refused batch (409), and only when an attachment is named, since with none the batch has no G11.
	it("reads a closed archive whose manifest, or an entry of it, is not JSON as unreadable, without failing, and reads nothing with no key", async () => {
		for (const manifest of ["{not json", '["{not json"]', '{"key":"x"}']) {
			const world = seeded();

			world.seed(rows.agreementBase());
			world.seed({
				software_agreements: [
					rows.agreement("a1", "r1", "o1", {
						status: "executed",
						attachment_manifest_json: JSON.stringify([{ key: KEY }]),
						archive_closed_at: EARLIER,
					}),
					rows.agreement("a2", "r1", "o1", {
						status: "executed",
						attachment_manifest_json: manifest,
						archive_closed_at: EARLIER,
					}),
				],
			});

			expect(
				await world.ok(readClosedArchives([KEY, OTHER_KEY])),
				manifest,
			).toEqual({ keys: [KEY], unreadable: true });
			expect(await world.ok(readClosedArchives([OTHER_KEY])), manifest).toEqual(
				{ keys: [], unreadable: true },
			);

			const asked = world.executed.length;

			expect(await world.ok(readClosedArchives([])), manifest).toEqual({
				keys: [],
				unreadable: false,
			});
			expect(world.executed.length, manifest).toBe(asked);

			// What the old route's guard does with the same row: it raises "malformed JSON", which refuses its batch.
			expect(() =>
				world.all(
					"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements a,json_each(a.attachment_manifest_json) m WHERE a.archive_closed_at IS NOT NULL AND json_extract(m.value,'$.key')=?)",
					OTHER_KEY,
				),
			).toThrow(/malformed JSON/);
		}
	});

	it("gives the rules an unreadable closed archive to refuse a named attachment on, as the batch's G11 refuses it, and nothing to refuse with none named", async () => {
		const world = seeded();

		world.seed(rows.agreementBase());
		world.seed({
			software_agreement_attachments: [attachmentRow("f1", KEY)],
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "executed",
					attachment_manifest_json: "{not json",
					archive_closed_at: EARLIER,
				}),
			],
		});

		const read = {
			rows: await world.ok(readAttachmentRows("r1", [KEY])),
			closed: await world.ok(readClosedArchives([KEY])),
		};

		expect(attachmentsUsable([named], read)).toBe(false);
		expect(outsideClosedArchives(named, read.closed)).toBe(false);
		expect(
			await world.failed(
				saveDraftBatch(
					newDraft({
						attachments: [named],
						details: { json: JSON.stringify({ attachments: [named] }) },
					}),
				),
			),
		).toBeInstanceOf(GuardRefused);

		const none = {
			rows: [],
			closed: await world.ok(readClosedArchives([])),
		};

		expect(attachmentsUsable([], none)).toBe(true);
		expect(await world.ok(saveDraftBatch(newDraft()))).toEqual({
			deletedKeys: [],
		});
	});

	it("inserts a new version and deletes a removed attachment's row that nothing names", async () => {
		const world = seeded();

		world.seed({ software_agreement_attachments: [attachmentRow("f1", KEY)] });

		expect(
			await world.ok(
				saveDraftBatch(newDraft({ removed: [attachmentRow("f1", KEY)] })),
			),
		).toEqual({ deletedKeys: [KEY] });
		expect(
			world.all(
				"SELECT id,version,status,terms_json,created_at,updated_at FROM software_offers WHERE id='o2'",
			),
		).toEqual([
			{
				id: "o2",
				version: 2,
				status: "draft",
				terms_json: '{"outcome":"New"}',
				created_at: AT,
				updated_at: AT,
			},
		]);
		expect(world.all("SELECT * FROM software_agreement_attachments")).toEqual(
			[],
		);
		expect(world.all("SELECT action FROM owner_request_audit")).toEqual([
			{ action: "offer-draft-saved" },
		]);
	});

	it("keeps a removed attachment's row that another offer's details still name", async () => {
		const world = seeded();

		world.seed({ software_agreement_attachments: [attachmentRow("f1", KEY)] });
		world.sql.exec(
			`UPDATE software_offers SET agreement_details_json='${JSON.stringify({ attachments: [{ key: KEY }] })}' WHERE id='o1'`,
		);

		expect(
			await world.ok(
				saveDraftBatch(newDraft({ removed: [attachmentRow("f1", KEY)] })),
			),
		).toEqual({ deletedKeys: [] });
		expect(world.all("SELECT id FROM software_agreement_attachments")).toEqual([
			{ id: "f1" },
		]);
	});

	it("updates the open draft's terms, details and reused MSA", async () => {
		const world = seeded();

		world.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", {
					version: 2,
					status: "draft",
					sent_at: null,
					sent_by: null,
				}),
			],
		});

		await world.ok(
			saveDraftBatch(
				newDraft({
					save: {
						kind: "update",
						expectedUpdatedAt: EARLIER,
						move: OFFER_MOVES.SAVE,
					},
					details: { json: '{"planned_start":"2026-10-01"}' },
					reusedMsa: { id: null },
				}),
			),
		);

		expect(
			world.all(
				"SELECT terms_json,updated_at,agreement_details_json,reused_msa_id FROM software_offers WHERE id='o2'",
			),
		).toEqual([
			{
				terms_json: '{"outcome":"New"}',
				updated_at: AT,
				agreement_details_json: '{"planned_start":"2026-10-01"}',
				reused_msa_id: null,
			},
		]);
	});

	it("is GuardRefused when the open draft changed, and for a named attachment with no row", async () => {
		const stale = seeded();

		stale.seed({
			software_offers: [
				rows.softwareOffer("o2", "r1", {
					version: 2,
					status: "draft",
					updated_at: AT,
					sent_at: null,
					sent_by: null,
				}),
			],
		});
		expect(
			await stale.failed(
				saveDraftBatch(
					newDraft({
						save: {
							kind: "update",
							expectedUpdatedAt: EARLIER,
							move: OFFER_MOVES.SAVE,
						},
					}),
				),
			),
		).toBeInstanceOf(GuardRefused);

		const unnamed = seeded();

		expect(
			await unnamed.failed(saveDraftBatch(newDraft({ attachments: [named] }))),
		).toBeInstanceOf(GuardRefused);
	});

	it("is GuardRefused when stored details its delete reads are not JSON, as before", async () => {
		const world = seeded();

		world.seed({ software_agreement_attachments: [attachmentRow("f1", KEY)] });
		world.sql.exec(
			"UPDATE software_offers SET agreement_details_json='{not json' WHERE id='o1'",
		);

		expect(
			await world.failed(
				saveDraftBatch(newDraft({ removed: [attachmentRow("f1", KEY)] })),
			),
		).toBeInstanceOf(GuardRefused);
	});

	it("is ChangedSinceRead when another draft is open or the version is taken (the unique indexes)", async () => {
		const open = seeded();

		open.seed({
			software_offers: [
				rows.softwareOffer("o9", "r1", {
					version: 9,
					status: "draft",
					sent_at: null,
					sent_by: null,
				}),
			],
		});
		expect(await open.failed(saveDraftBatch(newDraft()))).toBeInstanceOf(
			ChangedSinceRead,
		);

		const taken = seeded();

		expect(
			await taken.failed(
				saveDraftBatch(
					newDraft({ version: 1, save: { kind: "insert", version: 1 } }),
				),
			),
		).toBeInstanceOf(ChangedSinceRead);
	});

	it("is GuardRefused when the reused MSA is gone, read after its foreign key failed", async () => {
		const world = seeded();

		expect(
			await world.failed(
				saveDraftBatch(newDraft({ reusedMsa: { id: "a-gone" } })),
			),
		).toBeInstanceOf(GuardRefused);
		expect(world.executed.at(-1)).toBe(
			"SELECT 1 FROM software_agreements WHERE id=?",
		);
	});

	it("is OffersStoreFailed for a foreign key failure while the MSA is there, or when the evidence cannot be read", async () => {
		const present = offersWorld({
			on: /UPDATE software_offers SET reused_msa_id/,
			message: "FOREIGN KEY constraint failed",
		});

		withRequest(present);
		present.seed({
			software_offers: [rows.softwareOffer("o1", "r1")],
			...rows.agreementBase(),
		});
		present.seed({ software_agreements: [rows.agreement("a1", "r1", "o1")] });

		const failure = await present.failed(
			saveDraftBatch(newDraft({ reusedMsa: { id: "a1" } })),
		);

		expect(failure).toBeInstanceOf(OffersStoreFailed);
		expect(failure).toMatchObject({
			failure: new Error("FOREIGN KEY constraint failed"),
		});

		const unread = offersWorld({
			on: /^SELECT 1 FROM software_agreements WHERE id=\?$/,
			message: "D1 is down",
		});

		withRequest(unread);
		unread.seed({ software_offers: [rows.softwareOffer("o1", "r1")] });

		expect(
			await unread.failed(
				saveDraftBatch(newDraft({ reusedMsa: { id: "a-gone" } })),
			),
		).toEqual(new OffersStoreFailed({ failure: new Error("D1 is down") }));
	});

	/**
	 * The draft saved through `decideAndSave`, as the flow will: read the offers, number the new version after the newest,
	 * save. `taken` runs before each try's batch, as another writer would.
	 */
	const draftLoop = (world: World, taken: (attempt: number) => void) => {
		let attempt = 0;

		return decideAndSave({
			facts: readOffers("r1"),
			decide: (offers) =>
				Effect.succeed(
					Option.some(
						Math.max(0, ...offers.map((stored) => stored.version)) + 1,
					),
				),
			save: (version: number) =>
				Effect.suspend(() => {
					attempt += 1;
					taken(attempt);

					return saveDraftBatch(
						newDraft({ version, save: { kind: "insert", version } }),
					);
				}),
		});
	};

	it("reads and decides again when another writer takes the version, three tries in all", async () => {
		const world = seeded();

		const saved = await world.ok(
			draftLoop(world, (attempt) => {
				if (attempt === 1)
					world.seed({
						software_offers: [
							rows.softwareOffer("o9", "r1", {
								version: 2,
								status: "superseded",
							}),
						],
					});
			}),
		);

		expect(saved.decided).toEqual(Option.some(3));
		expect(
			world.all("SELECT version FROM software_offers WHERE id='o2'"),
		).toEqual([{ version: 3 }]);

		const busy = seeded();

		expect(
			await busy.failed(
				draftLoop(busy, (attempt) =>
					busy.seed({
						software_offers: [
							rows.softwareOffer(`o-${attempt}`, "r1", {
								version: attempt + 1,
								status: "superseded",
							}),
						],
					}),
				),
			),
		).toBeInstanceOf(SaveKeptChanging);
		expect(busy.all("SELECT id FROM software_offers WHERE id='o2'")).toEqual(
			[],
		);
	});

	it("puts a removed attachment's row back, and leaves a row already there", async () => {
		const world = seeded();

		await world.ok(restoreAttachment(attachmentRow("f1", KEY)));
		await world.ok(
			restoreAttachment(attachmentRow("f1", KEY, { filename: "Other.pdf" })),
		);

		expect(world.all("SELECT * FROM software_agreement_attachments")).toEqual([
			attachmentRow("f1", KEY),
		]);
	});
});

describe("send", () => {
	const seeded = () => {
		const world = offersWorld();

		withRequest(world);
		sentAndDraft(world);
		world.seed({
			software_offer_links: [rows.offerLink("r1", { revoked_at: EARLIER })],
		});

		return world;
	};

	it("reads the signing setting, the templates, the contractor config, a reusable MSA and an attachment row", async () => {
		const world = seeded();

		expect(await world.ok(readSigningEnabled())).toBe(false);
		world.sql.exec(
			"UPDATE software_signing_settings SET software_signing_enabled=1",
		);
		expect(await world.ok(readSigningEnabled())).toBe(true);

		expect(await world.ok(readCurrentTemplate("msa"))).toBeNull();
		world.seed(rows.agreementBase());
		expect(await world.ok(readCurrentTemplate("msa"))).toMatchObject({
			id: "template-msa",
		});

		expect(await world.ok(readContractorConfig())).toBeNull();
		world.seed({
			software_contractor_config: [
				{
					version: 1,
					values_json: "{}",
					created_at: EARLIER,
					created_by: OWNER,
				},
				{
					version: 2,
					values_json: '{"a":1}',
					created_at: EARLIER,
					created_by: OWNER,
				},
			],
		});
		expect(await world.ok(readContractorConfig())).toEqual({
			version: 2,
			values_json: '{"a":1}',
		});

		world.seed({
			software_agreements: [
				rows.agreement("a1", "r1", "o1", { status: "executed" }),
			],
		});
		expect(await world.ok(readReusableMsa("a1", "grace@example.test"))).toBe(
			false,
		);
		world.seed({
			software_agreement_artifacts: [{ agreement_id: "a1", status: "ready" }],
		});
		expect(await world.ok(readReusableMsa("a1", "grace@example.test"))).toBe(
			true,
		);
		expect(await world.ok(readReusableMsa("a1", "other@example.test"))).toBe(
			false,
		);

		expect(await world.ok(readAttachmentRow("r1", named))).toBe(false);
		world.seed({ software_agreement_attachments: [attachmentRow("f1", KEY)] });
		expect(await world.ok(readAttachmentRow("r1", named))).toBe(true);
		expect(
			await world.ok(readAttachmentRow("r1", { ...named, bytes: 1 })),
		).toBe(false);
	});

	it("sends the open draft: supersedes the sent one, marks the draft sent, writes the link and the pin", async () => {
		const world = seeded();

		world.seed(rows.agreementBase());
		world.seed({
			software_agreement_templates: [sowTemplate],
			software_agreement_attachments: [attachmentRow("f1", KEY)],
		});

		await world.ok(saveSend(sendWrite({ pin }), SINCE));

		expect(
			world.all(
				"SELECT id,status,sent_at,sent_by,updated_at,msa_template_id,recipient_email_snapshot FROM software_offers ORDER BY id",
			),
		).toEqual([
			{
				id: "o1",
				status: "superseded",
				sent_at: EARLIER,
				sent_by: OWNER,
				updated_at: EARLIER,
				msa_template_id: null,
				recipient_email_snapshot: null,
			},
			{
				id: "o2",
				status: "sent",
				sent_at: AT,
				sent_by: OWNER,
				updated_at: AT,
				msa_template_id: "template-msa",
				recipient_email_snapshot: "grace@example.test",
			},
		]);
		expect(
			world.all(
				"SELECT token_hash,created_at,revoked_at FROM software_offer_links",
			),
		).toEqual([{ token_hash: "new-hash", created_at: AT, revoked_at: null }]);
		expect(world.all("SELECT action,note FROM owner_request_audit")).toEqual([
			{ action: "offer-sent", note: "Offer v2 sent" },
		]);
		expect(await world.ok(readLinkStillLive("r1", "new-hash", "o2"))).toBe(
			true,
		);
		expect(await world.ok(readLinkStillLive("r1", "old-hash", "o2"))).toBe(
			false,
		);
	});

	it("reissues the sent offer with a new link only while its link is revoked (G9)", async () => {
		const world = seeded();

		world.sql.exec("DELETE FROM software_offers WHERE id='o2'");
		await world.ok(saveSend(reissue(), SINCE));

		expect(statusOf(world, "o1")).toBe("sent");
		expect(
			world.all("SELECT token_hash,revoked_at FROM software_offer_links"),
		).toEqual([{ token_hash: "new-hash", revoked_at: null }]);
		expect(await world.failed(saveSend(reissue(), SINCE))).toBeInstanceOf(
			GuardRefused,
		);
	});

	it.each([
		[
			"the offer changed since it was read (G8)",
			(world: World) =>
				world.sql.exec(
					`UPDATE software_offers SET updated_at='${AT}' WHERE id='o2'`,
				),
		],
		[
			"a signed agreement (G3)",
			(world: World) => {
				world.seed(rows.agreementBase());
				world.seed({ software_agreements: [rows.agreement("a1", "r1", "o1")] });
			},
		],
		[
			"a paid first deposit (G4)",
			(world: World) =>
				world.seed({
					software_invoices: [
						rows.softwareInvoice("i1", "r1", "o1", { status: "paid" }),
					],
				}),
		],
		[
			"a link made after the window's start (G5)",
			(world: World) =>
				world.sql.exec(
					`UPDATE software_offer_links SET created_at='${AT}',revoked_at=NULL`,
				),
		],
		[
			"a started project (G2)",
			(world: World) =>
				world.seed({ software_projects: [rows.softwareProject("r1", "o1")] }),
		],
	])("is GuardRefused for %s", async (_name, change) => {
		const world = seeded();

		change(world);

		expect(await world.failed(saveSend(sendWrite(), SINCE))).toBeInstanceOf(
			GuardRefused,
		);
		expect(statusOf(world, "o2")).toBe("draft");
	});
});

describe("the store's statements", () => {
	it("builds every status list from the offer version machine", () => {
		expect(statusIs(OFFER_MOVES.WITHDRAW.from)).toBe(
			"status IN ('draft','sent')",
		);
		expect(statusIs(OFFER_MOVES.SUPERSEDE.from)).toBe("status='sent'");
		expect(statusIs(OFFER_MOVES.SEND.from)).toBe("status='draft'");
		expect(statusIs(OFFER_MOVES.SAVE.from)).toBe("status='draft'");
		expect(() => statusIs([])).toThrow();
		// SAFETY: the cast puts a status the machine does not name through, which is the bug the check stops.
		expect(() => statusIs(["sent'--" as "sent"])).toThrow();
	});

	it("retires signing with the statements and values of retireRequestSigning", () => {
		const db = sqliteD1(freshMusicDb());

		expect(retireSigning(db, "r1", retiredAt(AT)).map(boundStatement)).toEqual(
			retireRequestSigning(db, "r1", AT).map(boundStatement),
		);
	});

	it("guards G5 with offerSendingGuard's text, at the window's start the flow read", () => {
		const db = sqliteD1(freshMusicDb());

		expect(boundStatement(offerSendingGuard(db, "r1", SINCE))).toEqual({
			query:
				"SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_offer_links WHERE request_id=? AND revoked_at IS NULL AND created_at>?) THEN 1 ELSE json_extract('Offer still sending','$') END",
			args: ["r1", SINCE],
		});
	});
});

// ---- the SQL against the golden corpus ----

/** The old texts the store changes, each with the new text and why. A hook that picked the old text must pick the new. */
const CHANGED = [
	{
		old: "SELECT i.status,o.status AS offer_status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id\n    WHERE i.request_id=? AND i.milestone_index=0 AND i.kind='deposit'\n    AND i.refunded_at IS NULL AND i.status IN ('creating','open','payment_failed','uncollectible','paid')",
		new: "SELECT i.status,o.status AS offer_status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id WHERE i.request_id=? ORDER BY i.id",
		why: "the deposit read gives the rule every invoice, unfiltered (design, section 7), and keeps the hooks' text",
	},
	{
		old: "UPDATE software_offers SET status='withdrawn',updated_at=? WHERE request_id=? AND status IN ('sent','draft')",
		new: "UPDATE software_offers SET status='withdrawn',updated_at=? WHERE request_id=? AND status IN ('draft','sent')",
		why: "the WITHDRAW list in the machine's order (draft, sent); no hook reads past `status='withdrawn'`",
	},
	{
		old: "UPDATE software_offers SET status='sent',sent_at=?,sent_by=?,updated_at=? WHERE id=?",
		new: "UPDATE software_offers SET status='sent',sent_at=?,sent_by=?,updated_at=? WHERE id=? AND status='draft'",
		why: "mark sent gains its status filter from SEND (design, section 1); G8 holds the offer at draft in the same batch",
	},
] as const;

/** The texts the store adds, each with why; no golden hook may pick one, since hooks count their matches. */
const ADDED = [
	{
		sql: "SELECT i.milestone_index,i.kind,i.refunded_at FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id WHERE i.request_id=? ORDER BY i.id",
		why: "the rest of each invoice, read in the deposit read's batch",
	},
	{
		sql: "SELECT 1 FROM software_agreements WHERE request_id=? AND status IN ('client_signed','executed')",
		why: "AgreementSigned, read before the batch that G3 re-checks",
	},
	{
		sql: "SELECT 1 FROM audio_projects WHERE request_id=?",
		why: "AudioProjectExists, read before the batch that G6 re-checks",
	},
	{
		sql: "SELECT object_key,sha256,bytes,filename,version,document_date FROM software_agreement_attachments WHERE request_id=? AND object_key IN (SELECT value FROM json_each(?))",
		why: "AttachmentNotUsable's rows, read before the batch that G11 re-checks",
	},
	{
		sql: "SELECT DISTINCT object_key,unreadable FROM (SELECT CASE WHEN json_valid(m.value) THEN json_extract(m.value,'$.key') END AS object_key,NOT json_valid(a.attachment_manifest_json) OR (m.value IS NOT NULL AND NOT json_valid(m.value)) AS unreadable FROM software_agreements a LEFT JOIN json_each(CASE WHEN json_valid(a.attachment_manifest_json) THEN a.attachment_manifest_json END) m WHERE a.archive_closed_at IS NOT NULL) WHERE unreadable OR object_key IN (SELECT value FROM json_each(?))",
		why: "AttachmentNotUsable's closed archives, those G11's predicate covers, with any that is not JSON read as a fact",
	},
] as const;

/** A batch of the store, run from the seeded start in a world of its own, so that it runs every statement. */
type TourBatch = {
	readonly name: string;
	readonly run: (fresh: World) => Effect.Effect<unknown, unknown, MusicDb>;
};

const TOUR_BATCHES: readonly TourBatch[] = [
	{ name: "fit", run: () => saveFit(fitWrite) },
	{
		name: "the question's reservation",
		run: () => reserveQuestion(questionWrite),
	},
	{
		name: "the question's record",
		run: () => recordQuestion({ ...questionWrite, at: EARLIER }),
	},
	{
		name: "the decline's first batch",
		run: () => withdrawForDecline(declineWrite, SINCE),
	},
	{
		name: "the decline's second batch",
		run: (fresh) => {
			fresh.sql.exec("UPDATE software_offers SET status='withdrawn'");

			return resolveDeclined({ ...resolveWrite, request }, SINCE);
		},
	},
	{
		name: "revoke",
		run: (fresh) => {
			fresh.sql.exec("UPDATE software_offer_links SET revoked_at=NULL");

			return revokeOfferLink(revokeWrite, SINCE);
		},
	},
	{
		name: "a new draft",
		run: (fresh) => {
			fresh.sql.exec("DELETE FROM software_offers WHERE id='o2'");

			return saveDraftBatch(newDraft());
		},
	},
	{
		name: "a new draft with details naming an attachment",
		run: (fresh) => {
			fresh.sql.exec("DELETE FROM software_offers WHERE id='o2'");

			return saveDraftBatch(
				newDraft({
					attachments: [named],
					details: { json: JSON.stringify({ attachments: [named] }) },
				}),
			);
		},
	},
	{
		name: "a new draft that confirms a reused MSA",
		run: (fresh) => {
			fresh.sql.exec("DELETE FROM software_offers WHERE id='o2'");

			return saveDraftBatch(newDraft({ reusedMsa: { id: null } }));
		},
	},
	{
		name: "a new draft that removes an attachment",
		run: (fresh) => {
			fresh.sql.exec("DELETE FROM software_offers WHERE id='o2'");

			return saveDraftBatch(newDraft({ removed: [attachmentRow("f1", KEY)] }));
		},
	},
	{
		name: "the open draft updated",
		run: () =>
			saveDraftBatch(
				newDraft({
					save: {
						kind: "update",
						expectedUpdatedAt: EARLIER,
						move: OFFER_MOVES.SAVE,
					},
				}),
			),
	},
	{ name: "a send", run: () => saveSend(sendWrite(), SINCE) },
	{
		name: "a send with the agreement pinned",
		run: (fresh) => {
			fresh.seed({ software_agreement_templates: [sowTemplate] });

			return saveSend(sendWrite({ pin }), SINCE);
		},
	},
	{
		name: "a reissue",
		run: (fresh) => {
			fresh.sql.exec("DELETE FROM software_offers WHERE id='o2'");

			return saveSend(reissue(), SINCE);
		},
	},
];

/** A world seeded for the tour: the request, a sent offer and a draft, a revoked link, the agreement base, an attachment. */
function tourWorld() {
	const world = offersWorld();

	withRequest(world);
	sentAndDraft(world);
	world.seed({
		software_offer_links: [rows.offerLink("r1", { revoked_at: EARLIER })],
		...rows.agreementBase(),
	});
	world.seed({ software_agreement_attachments: [attachmentRow("f1", KEY)] });

	return world;
}

/**
 * Runs every function of the store once, each to its end, and answers every SQL text it prepared, and the texts of each
 * batch in order.
 */
async function tour() {
	const texts = new Set<string>();
	const world = tourWorld();

	await world.ok(readRequest("r1"));
	await world.ok(readProjectStarted("r1"));
	await world.ok(readOffers("r1"));
	await world.ok(readFreshLiveLink("r1", SINCE));
	await world.ok(readDepositInvoices("r1"));
	await world.ok(readSignedAgreement("r1"));
	await world.ok(readAudioProject("r1"));
	await world.ok(readLinkRow("r1"));
	await world.ok(readLinkLive("r1", EARLIER));
	await world.ok(readOfferLeft("r1"));
	await world.ok(readRemovedAttachments("r1", [KEY]));
	await world.ok(readAttachmentRows("r1", [KEY]));
	await world.ok(readClosedArchives([KEY]));
	await world.ok(readMsaExists("a1"));
	await world.ok(readSigningEnabled());
	await world.ok(readCurrentTemplate("msa"));
	await world.ok(readContractorConfig());
	await world.ok(readReusableMsa("a1", "grace@example.test"));
	await world.ok(readAttachmentRow("r1", named));
	await world.ok(readLinkStillLive("r1", "hash", "o2"));
	await world.ok(restoreAttachment(attachmentRow("f1", KEY)));

	for (const text of world.executed) texts.add(text);

	const batches: { readonly name: string; readonly sql: readonly string[] }[] =
		[];

	for (const batch of TOUR_BATCHES) {
		const fresh = tourWorld();

		await fresh.ok(batch.run(fresh));

		for (const text of fresh.executed) texts.add(text);
		batches.push({ name: batch.name, sql: fresh.executed });
	}

	return { texts, batches };
}

describe("the store's SQL against the golden corpus", () => {
	it("runs only texts the old route ran, and the changed and added texts listed here, every one of them", async () => {
		const recorded = recordedSql();
		const { texts: ran } = await tour();

		const expected = new Set<string>([
			...CHANGED.map((change) => change.new),
			...ADDED.map((added) => added.sql),
		]);

		const unknown = [...ran].filter(
			(text) => !recorded.has(text) && !expected.has(text),
		);

		expect(unknown).toEqual([]);
		expect([...expected].filter((text) => !ran.has(text))).toEqual([]);

		for (const change of CHANGED) {
			expect(recorded.has(change.old), change.why).toBe(true);
			expect(ran.has(change.old), change.why).toBe(false);
		}

		for (const added of ADDED)
			expect(recorded.has(added.sql), added.why).toBe(false);
	});

	it("runs each batch's statements in an order the old route ran them", async () => {
		const recorded = recordedBatches();
		const { batches } = await tour();

		const asBefore = (sql: string) =>
			CHANGED.find((change) => change.new === sql)?.old ?? sql;

		const unmatched = batches.filter(
			(batch) => !recorded.has(JSON.stringify(batch.sql.map(asBefore))),
		);

		expect(unmatched).toEqual([]);
	});

	it("leaves every hook's count as it was: a changed text matches the patterns its old text matched, an added one none", () => {
		const patterns = hookPatterns();

		const matching = (sql: string) =>
			patterns.filter((pattern) => pattern.test(sql)).map(String);

		expect(patterns.length).toBeGreaterThan(20);
		// Hooks also name a pattern through a const: onBatch (send and signing, revoke), liveCheck and afterTheEmail.
		expect(patterns.map(String)).toEqual(
			expect.arrayContaining([
				String(/INSERT INTO software_offer_links/),
				String(/UPDATE software_offer_links SET revoked_at/),
				String(
					/SELECT 1 FROM software_offer_links WHERE request_id=\? AND token_hash=\?/,
				),
				String(
					/UPDATE owner_requests SET status='resolved'|^SELECT 1 FROM software_offers WHERE request_id=\? AND status IN/,
				),
			]),
		);

		for (const change of CHANGED) {
			expect(matching(change.new), change.why).toEqual(matching(change.old));
			// The trigger-hit marker a hook writes names the statement's operation, table and access.
			expect(statementOf(change.new), change.why).toEqual(
				statementOf(change.old),
			);
		}

		for (const added of ADDED)
			expect(matching(added.sql), added.why).toEqual([]);
	});
});
