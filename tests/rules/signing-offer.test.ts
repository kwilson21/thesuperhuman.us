import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "vitest";
import { liveSigningGuard } from "../../src/lib/agreement-access";
import {
	getLinkedOffer,
	hashOfferToken,
	type SoftwareOffer,
} from "../../src/lib/software-offers";
import {
	type LinkedOfferRow,
	linkedOffer,
	openForSigning,
	type SigningStateRow,
} from "../../src/server/rules/signing-offer";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The offer a signing token names, and whether it is open for signing (docs/plans/2026-11-signing-conversion.md,
// section 2), as stories; then each held, on sqlite with the real schema (db/music.sql), to the SQL that decides it today:
// `openForSigning` to the live signing guard A1 (`liveSigningGuard`, imported from src/lib/agreement-access.ts), and
// `linkedOffer` to `getLinkedOffer`'s filters (imported from src/lib/software-offers.ts). The facts are read with the
// statements the store will read them with, copied here: A1's facts with the read today's link route makes after a
// guard raised (`signingRefusal`, src/lib/agreement-access.ts), the linked offer's rows filtered by the token's hash alone.

type Said = { refused: string; say: string } | { wrote: unknown };

const said = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

const refuses = <W, E>(decided: Effect.Effect<W, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: () => true,
			onSuccess: () => false,
		}),
	);

const RECIPIENT = "client@example.com";

const open: SigningStateRow = {
	status: "sent",
	recipient_email_snapshot: RECIPIENT,
	request_status: "reviewed",
	link_hash: "h",
	link_revoked_at: null,
	software_signing_enabled: 1,
	project_offer_id: null,
};

const decideOpen = (row: SigningStateRow | null) =>
	said(openForSigning.decide({ recipient: RECIPIENT }, row));

const SIGNING_OFF = {
	refused: "SigningOff",
	say: "Website signing is off.",
};

const UNAVAILABLE = {
	refused: "OfferUnavailable",
	say: "This offer is unavailable for signing.",
};

const STARTED = {
	refused: "SigningStarted",
	say: "This offer is unavailable for signing.",
};

describe("an offer open for signing", () => {
	it("goes on when it is sent through its live link to the recipient, the brief open, no project and signing on", () => {
		expect(decideOpen(open)).toEqual({ wrote: {} });
		expect(decideOpen({ ...open, request_status: "new" })).toEqual({
			wrote: {},
		});
	});

	it("is refused as switched off when signing is off, whatever else holds", () => {
		expect(decideOpen({ ...open, software_signing_enabled: 0 })).toEqual(
			SIGNING_OFF,
		);
		expect(decideOpen({ ...open, software_signing_enabled: null })).toEqual(
			SIGNING_OFF,
		);
		expect(
			decideOpen({
				...open,
				software_signing_enabled: 0,
				status: "superseded",
				project_offer_id: "o1",
			}),
		).toEqual(SIGNING_OFF);
	});

	it("is unavailable when the offer is gone, whatever the setting", () => {
		expect(decideOpen(null)).toEqual(UNAVAILABLE);
	});

	it("is unavailable when it is not sent, its link is replaced or revoked, its recipient changed or its brief closed", () => {
		for (const status of ["draft", "superseded", "withdrawn"])
			expect(decideOpen({ ...open, status })).toEqual(UNAVAILABLE);

		expect(decideOpen({ ...open, link_hash: null })).toEqual(UNAVAILABLE);
		expect(
			decideOpen({ ...open, link_revoked_at: "2026-11-23T10:00:00.000Z" }),
		).toEqual(UNAVAILABLE);
		expect(
			decideOpen({ ...open, recipient_email_snapshot: "other@example.com" }),
		).toEqual(UNAVAILABLE);
		expect(decideOpen({ ...open, recipient_email_snapshot: null })).toEqual(
			UNAVAILABLE,
		);

		for (const request_status of ["withdrawn", "resolved"])
			expect(decideOpen({ ...open, request_status })).toEqual(UNAVAILABLE);
	});

	it("is refused as started when a project exists, after every other check", () => {
		expect(decideOpen({ ...open, project_offer_id: "o1" })).toEqual(STARTED);
		expect(
			decideOpen({ ...open, project_offer_id: "o1", status: "superseded" }),
		).toEqual(UNAVAILABLE);
	});
});

const row = (over: Partial<LinkedOfferRow> = {}): LinkedOfferRow => ({
	id: "o1",
	request_id: "r1",
	version: 1,
	status: "sent",
	terms_json: "{}",
	created_at: "2026-11-20T10:00:00.000Z",
	updated_at: "2026-11-20T10:00:00.000Z",
	sent_at: "2026-11-20T10:00:00.000Z",
	sent_by: "owner",
	link_revoked_at: null,
	request_kind: "software",
	request_status: "reviewed",
	request_email: RECIPIENT,
	...over,
});

describe("the offer a token names", () => {
	it("is the sent version of the brief", () => {
		const sent = row({ id: "o2", version: 2 });

		expect(
			said(
				linkedOffer.decide(null, [
					row({ status: "superseded" }),
					sent,
					row({ id: "o3", version: 3, status: "draft" }),
				]),
			),
		).toEqual({ wrote: sent });
	});

	it("is unavailable with no sent version, a revoked link, a brief that is not software, closed or without an email", () => {
		expect(said(linkedOffer.decide(null, []))).toEqual(UNAVAILABLE);

		for (const over of [
			{ status: "draft" as const },
			{ status: "superseded" as const },
			{ status: "withdrawn" as const },
			{ link_revoked_at: "2026-11-23T10:00:00.000Z" },
			{ request_kind: "service" },
			{ request_status: "withdrawn" },
			{ request_status: "resolved" },
			{ request_email: "" },
		])
			expect(said(linkedOffer.decide(null, [row(over)]))).toEqual(UNAVAILABLE);
	});
});

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeAll(() => {
	database.exec(readFileSync("db/music.sql", "utf8"));
});

const T = "2026-11-20T10:00:00.000Z";

function addRequest(
	id: string,
	over: { kind?: string; status?: string; email?: string } = {},
) {
	database
		.prepare(
			"INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
		)
		.run(
			id,
			over.kind ?? "software",
			over.email ?? RECIPIENT,
			"A brief",
			over.status ?? "reviewed",
			T,
			T,
		);
}

function addOffer(
	id: string,
	requestId: string,
	version: number,
	status: string,
	recipient: string | null = RECIPIENT,
) {
	database
		.prepare(
			"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,recipient_email_snapshot) VALUES(?,?,?,?,?,?,?,?)",
		)
		.run(id, requestId, version, status, "{}", T, T, recipient);
}

function addLink(requestId: string, tokenHash: string, revoked: boolean) {
	database
		.prepare(
			"INSERT INTO software_offer_links(request_id,token_hash,created_at,revoked_at) VALUES(?,?,?,?)",
		)
		.run(requestId, tokenHash, T, revoked ? T : null);
}

function addProject(requestId: string, offerId: string) {
	database
		.prepare(
			"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
		)
		.run(requestId, offerId, "{}", "standard", T, T, T, "owner", T, T);
}

function clear() {
	database.exec(
		"DELETE FROM software_projects; DELETE FROM software_offer_links; DELETE FROM software_offers; DELETE FROM audio_project_audit; DELETE FROM audio_projects; DELETE FROM owner_requests; DELETE FROM software_signing_settings",
	);
}

/** A1's facts, read as the store will read them: the offer by its id, with the link by the hash, the setting and a project. */
const SIGNING_FACTS =
	"SELECT o.status,o.recipient_email_snapshot,r.status AS request_status,l.token_hash AS link_hash,l.revoked_at AS link_revoked_at,s.software_signing_enabled,p.offer_id AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id LEFT JOIN software_offer_links l ON l.request_id=o.request_id AND l.token_hash=? LEFT JOIN software_signing_settings s ON s.id=1 LEFT JOIN software_projects p ON p.offer_id=o.id WHERE o.id=?";

const readSigning = (offerId: string, linkHash: string) =>
	// SAFETY: the statement selects exactly the columns of SigningStateRow, with the types the schema stores them in.
	(database.prepare(SIGNING_FACTS).get(linkHash, offerId) ??
		null) as SigningStateRow | null;

/** Whether A1 refuses: it raises, as it does in a batch. */
const guardRefuses = (offerId: string, linkHash: string, email: string) =>
	liveSigningGuard(db, offerId, linkHash, email)
		.first()
		.then(
			() => false,
			() => true,
		);

const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"] as const;
const REQUEST_STATUSES = ["new", "reviewed", "resolved", "withdrawn"] as const;
const LINKS = ["live", "revoked", "replaced", "elsewhere", "none"] as const;
const SNAPSHOTS = [RECIPIENT, "other@example.com", null] as const;
const PROJECTS = ["none", "this offer", "another offer"] as const;
const SETTINGS = ["missing", 0, 1] as const;

describe("A1 and openForSigning", () => {
	it("refuse exactly together, for every offer, link, recipient, brief, project and setting", async () => {
		let compared = 0;
		let open = 0;

		for (const setting of SETTINGS) {
			clear();

			if (setting !== "missing")
				database
					.prepare(
						"INSERT INTO software_signing_settings(id,software_signing_enabled,updated_at,updated_by) VALUES(1,?,?,?)",
					)
					.run(setting, T, "owner");

			const cases: {
				offerId: string;
				hash: string;
				label: string;
			}[] = [];

			let n = 0;

			for (const status of OFFER_STATUSES)
				for (const link of LINKS)
					for (const snapshot of SNAPSHOTS)
						for (const requestStatus of REQUEST_STATUSES)
							for (const project of PROJECTS) {
								n += 1;
								const request = `r${n}`;
								const offerId = `o${n}`;
								const hash = `h${n}`;

								addRequest(request, { status: requestStatus });
								addOffer(offerId, request, 1, status, snapshot);

								if (link === "live") addLink(request, hash, false);

								if (link === "revoked") addLink(request, hash, true);

								if (link === "replaced") addLink(request, `other${n}`, false);

								if (link === "elsewhere") {
									addLink(request, `other${n}`, false);
									addRequest(`x${n}`);
									addLink(`x${n}`, hash, false);
								}

								if (project === "this offer") addProject(request, offerId);

								if (project === "another offer") {
									addOffer(`p${n}`, request, 2, "superseded");
									addProject(request, `p${n}`);
								}

								cases.push({
									offerId,
									hash,
									label: JSON.stringify({
										setting,
										status,
										link,
										snapshot,
										requestStatus,
										project,
									}),
								});
							}

			cases.push({ offerId: "gone", hash: "h1", label: "a missing offer" });

			for (const { offerId, hash, label } of cases) {
				const rule = refuses(
					openForSigning.decide(
						{ recipient: RECIPIENT },
						readSigning(offerId, hash),
					),
				);

				expect(
					{ label, refuses: await guardRefuses(offerId, hash, RECIPIENT) },
					label,
				).toEqual({ label, refuses: rule });
				compared += 1;

				if (!rule) open += 1;
			}
		}

		// Every combination, with and without the setting, and the open ones only with signing on: sent, live link,
		// recipient, an open brief and no project on this offer (2 brief statuses times 2 projects).
		expect(compared).toBe(3 * (720 + 1));
		expect(open).toBe(4);
	});
});

/** The linked offer's rows, read as the store will read them: every offer of the brief whose link has the hash. */
const LINKED_ROWS =
	"SELECT o.*,l.revoked_at AS link_revoked_at,r.kind AS request_kind,r.status AS request_status,r.email AS request_email FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE l.token_hash=?";

const KINDS = ["software", "service", "purchase"] as const;
const EMAILS = ["", RECIPIENT] as const;

const OFFER_SETS: readonly (readonly string[])[] = [
	[],
	["draft"],
	["sent"],
	["superseded"],
	["withdrawn"],
	["superseded", "sent", "draft"],
];

/** A signing token: 43 URL-safe characters, as `newOfferToken` makes them. */
const tokenOf = (n: number) => `token${n}`.padEnd(43, "x");

describe("linkedOffer and getLinkedOffer", () => {
	it("find the same offer, or none, for every brief kind, status, email, link and set of versions", async () => {
		clear();

		const cases: { token: string; label: string }[] = [];
		let n = 0;

		for (const kind of KINDS)
			for (const status of REQUEST_STATUSES)
				for (const email of EMAILS)
					for (const revoked of [false, true])
						for (const offers of OFFER_SETS) {
							n += 1;
							const request = `r${n}`;
							const token = tokenOf(n);

							addRequest(request, { kind, status, email });
							addLink(request, await hashOfferToken(token), revoked);

							offers.forEach((offerStatus, index) =>
								addOffer(`o${n}-${index}`, request, index + 1, offerStatus),
							);

							cases.push({
								token,
								label: JSON.stringify({ kind, status, email, revoked, offers }),
							});
						}

		cases.push({ token: tokenOf(0), label: "a token no link has" });

		let found = 0;

		for (const { token, label } of cases) {
			const today: SoftwareOffer | null = await getLinkedOffer(db, token);

			// SAFETY: `o.*` and the three aliased columns are exactly LinkedOfferRow's, as the schema stores them.
			const rows = database
				.prepare(LINKED_ROWS)
				.all(await hashOfferToken(token)) as LinkedOfferRow[];

			const decided = Effect.runSync(
				Effect.match(linkedOffer.decide(null, rows), {
					onFailure: () => null,
					onSuccess: (offer) => offer,
				}),
			);

			const offerOnly = decided && {
				...decided,
				link_revoked_at: undefined,
				request_kind: undefined,
				request_status: undefined,
				request_email: undefined,
			};

			expect({ label, offer: offerOnly && { ...offerOnly } }, label).toEqual({
				label,
				offer: today && { ...today },
			});

			if (today) found += 1;
		}

		// Only a software brief that is new or reviewed, with an email, a live link and a sent version.
		expect(found).toBe(2 * 2);
	});

	it("leaves a token that is not 43 URL-safe characters to the flow: getLinkedOffer reads nothing for it", async () => {
		expect(await getLinkedOffer(db, "short")).toBeNull();
	});
});
