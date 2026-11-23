import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessionCookie } from "../../src/lib/agreement-access";
import type { SigningStateRow } from "../../src/server/rules/signing-offer";
import {
	type RedeemPage,
	redeemLink,
	SESSION_LIFETIME_MS,
	type StoredAgreementLink,
	stillOpenForSigning,
} from "../../src/server/rules/signing-redeem";
import { DatabaseSync } from "../helpers/sqlite-d1";

// Redeeming an emailed link, for both purposes, as stories in the verify pages' order (docs/plans/2026-11-signing-
// conversion.md, section 2): the link, the page's offer token and the method; the GET's live check of a signing link; and
// what a POST writes. Then, on sqlite with the real schema (db/music.sql), the link decision held to today's read
// (`completeAgreementLink`'s `purpose=? AND used_at IS NULL AND expires_at>?`) and to A5, the consume batch's guard, both
// copied here from src/lib/agreement-access.ts (neither is exported). The live check reuses `openForSigning`'s terms,
// which tests/rules/signing-offer.test.ts holds to A1.

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

const EXPIRED = { refused: "LinkExpired", say: "This link has expired." };

const AT = new Date("2026-11-23T12:00:00.000Z");
const RECIPIENT = "client@example.com";
const TOKEN = "offer-token".padEnd(43, "x");

const signingPage: RedeemPage = {
	purpose: "agreement",
	token: TOKEN,
	tokenHash: "offer-link-hash",
};

const archivePage: RedeemPage = { purpose: "archive" };

const signingLink = (
	over: Partial<StoredAgreementLink> = {},
): StoredAgreementLink => ({
	id: "link-1",
	purpose: "agreement",
	offer_id: "o1",
	link_hash: "offer-link-hash",
	recipient_email: RECIPIENT,
	token_hash: "key-hash",
	issued_at: "2026-11-23T11:30:00.000Z",
	expires_at: "2026-11-23T12:30:00.000Z",
	used_at: null,
	...over,
});

const archiveLink = (over: Partial<StoredAgreementLink> = {}) =>
	signingLink({ purpose: "archive", offer_id: null, link_hash: null, ...over });

const redeem = (
	page: RedeemPage,
	link: StoredAgreementLink | null,
	method = "GET",
) => said(redeemLink.decide({ at: AT, method, page }, { link }));

const live = {
	offerId: "o1",
	linkHash: "offer-link-hash",
	recipient: RECIPIENT,
};

describe("opening a link with a GET", () => {
	it("shows a signing link once its live check passes, and an archive link at once", () => {
		expect(redeem(signingPage, signingLink())).toEqual({
			wrote: { method: "GET", live },
		});
		expect(redeem(archivePage, archiveLink())).toEqual({
			wrote: { method: "GET", live: null },
		});
	});
});

describe("consuming a link with a POST", () => {
	it("uses a signing link and makes a two-hour session that goes to the offer's signing page, with A1 in its batch", () => {
		expect(redeem(signingPage, signingLink(), "POST")).toEqual({
			wrote: {
				method: "POST",
				session: {
					purpose: "agreement",
					at: "2026-11-23T12:00:00.000Z",
					keyHash: "key-hash",
					linkId: "link-1",
					offerId: "o1",
					linkHash: "offer-link-hash",
					recipient: RECIPIENT,
					expiresAt: "2026-11-23T14:00:00.000Z",
					location: `/offer/${TOKEN}/sign`,
					live,
				},
			},
		});
	});

	it("uses an archive link and makes a two-hour archive session that goes to the archive, with no A1", () => {
		expect(redeem(archivePage, archiveLink(), "POST")).toEqual({
			wrote: {
				method: "POST",
				session: {
					purpose: "archive",
					at: "2026-11-23T12:00:00.000Z",
					keyHash: "key-hash",
					linkId: "link-1",
					offerId: null,
					linkHash: null,
					recipient: RECIPIENT,
					expiresAt: "2026-11-23T14:00:00.000Z",
					location: "/agreements",
					live: null,
				},
			},
		});
	});

	it("sets the cookie of the session's purpose for as long as the session lasts", () => {
		expect(SESSION_LIFETIME_MS / 1000).toBe(7200);
		expect(sessionCookie("t", true, "agreement")).toBe(
			"agreement_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200; Secure",
		);
		expect(sessionCookie("t", false, "archive")).toBe(
			"agreement_archive=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200",
		);
	});
});

describe("a link that cannot be redeemed", () => {
	it("is expired when the key names no link", () => {
		expect(redeem(signingPage, null)).toEqual(EXPIRED);
		expect(redeem(archivePage, null, "POST")).toEqual(EXPIRED);
	});

	it("is expired when it is used, or its hour is over at the instant read", () => {
		expect(
			redeem(signingPage, signingLink({ used_at: "2026-11-23T11:45:00.000Z" })),
		).toEqual(EXPIRED);
		expect(
			redeem(archivePage, archiveLink({ expires_at: AT.toISOString() })),
		).toEqual(EXPIRED);
		expect(
			redeem(
				archivePage,
				archiveLink({ expires_at: "2026-11-23T12:00:00.001Z" }),
			),
		).toEqual({ wrote: { method: "GET", live: null } });
	});

	it("is expired on the page of the other purpose", () => {
		expect(redeem(archivePage, signingLink())).toEqual(EXPIRED);
		expect(
			redeem(signingPage, archiveLink({ link_hash: "offer-link-hash" })),
		).toEqual(EXPIRED);
	});

	it("is expired on another offer's signing page", () => {
		expect(
			redeem(
				signingPage,
				signingLink({ link_hash: "another-offer-link-hash" }),
			),
		).toEqual(EXPIRED);
		expect(redeem(signingPage, signingLink({ link_hash: null }))).toEqual(
			EXPIRED,
		);
	});

	it("is expired when asked with a method other than GET or POST", () => {
		for (const method of ["PUT", "HEAD", "DELETE", "get"])
			expect(redeem(signingPage, signingLink(), method)).toEqual(EXPIRED);
	});
});

const open: SigningStateRow = {
	status: "sent",
	recipient_email_snapshot: RECIPIENT,
	request_status: "reviewed",
	link_hash: "offer-link-hash",
	link_revoked_at: null,
	software_signing_enabled: 1,
	project_offer_id: null,
};

describe("the GET's live check of a signing link", () => {
	const check = (row: SigningStateRow | null) =>
		said(stillOpenForSigning.decide(live, row));

	it("passes while the offer is open for signing to the link's recipient", () => {
		expect(check(open)).toEqual({ wrote: {} });
	});

	it("is expired for every reason the offer stopped being open for signing", () => {
		expect(check(null)).toEqual(EXPIRED);

		for (const over of [
			{ software_signing_enabled: 0 },
			{ software_signing_enabled: null },
			{ status: "superseded" },
			{ link_hash: null },
			{ link_revoked_at: AT.toISOString() },
			{ recipient_email_snapshot: "other@example.com" },
			{ request_status: "resolved" },
			{ request_status: "withdrawn" },
			{ project_offer_id: "o1" },
		])
			expect(check({ ...open, ...over }), JSON.stringify(over)).toEqual(
				EXPIRED,
			);
	});
});

const database = new DatabaseSync(":memory:");

beforeAll(() => {
	database.exec(readFileSync("db/music.sql", "utf8"));

	const T = "2026-11-20T10:00:00.000Z";

	database
		.prepare(
			"INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
		)
		.run("r1", "software", RECIPIENT, "A brief", "reviewed", T, T);
	database
		.prepare(
			"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
		)
		.run("o1", "r1", 1, "sent", "{}", T, T);
});

beforeEach(() => {
	database.exec("DELETE FROM software_agreement_links");
});

/** The link as today's redeem reads it, copied: none unless it has the purpose, is unused and has not expired. */
const TODAY_READ =
	"SELECT * FROM software_agreement_links WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?";

/** A5, the consume batch's guard, copied. */
const A5 =
	"SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreement_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN 1 ELSE json_extract('Link already consumed','$') END";

const EXPIRIES = [
	"2026-11-23T11:59:59.999Z",
	AT.toISOString(),
	"2026-11-23T12:00:00.001Z",
] as const;

describe("today's read, A5 and the link decision", () => {
	it("agree on every link: purpose, use, expiry and offer token, on both pages", () => {
		const at = AT.toISOString();
		let compared = 0;
		let redeemable = 0;

		for (const purpose of ["agreement", "archive"] as const)
			for (const used_at of [null, "2026-11-23T11:45:00.000Z"])
				for (const expires_at of EXPIRIES)
					for (const link_hash of ["offer-link-hash", "another", null])
						for (const page of [signingPage, archivePage]) {
							database.exec("DELETE FROM software_agreement_links");
							database
								.prepare(
									"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at,used_at) VALUES(?,?,?,?,?,?,?,?,?)",
								)
								.run(
									"link-1",
									purpose,
									purpose === "agreement" ? "o1" : null,
									link_hash,
									RECIPIENT,
									"key-hash",
									"2026-11-23T11:00:00.000Z",
									expires_at,
									used_at,
								);

							const label = JSON.stringify({
								purpose,
								used_at,
								expires_at,
								link_hash,
								page: page.purpose,
							});

							// The store reads the link by the key's hash alone; the rule decides the rest.
							// SAFETY: `SELECT *` gives every column of StoredAgreementLink, each stored as text or NULL.
							const stored = (database
								.prepare(
									"SELECT * FROM software_agreement_links WHERE token_hash=?",
								)
								.get("key-hash") ?? null) as StoredAgreementLink | null;

							const rule = !(
								"refused" in
								said(
									redeemLink.decide(
										{ at: AT, method: "POST", page },
										{ link: stored && { ...stored } },
									),
								)
							);

							// SAFETY: `SELECT *` gives the link's link_hash column, stored as text or NULL, or no row.
							const read = database
								.prepare(TODAY_READ)
								.get("key-hash", page.purpose, at) as
								| { link_hash: string | null }
								| undefined;

							const today =
								read !== undefined &&
								(page.purpose === "archive" ||
									read.link_hash === page.tokenHash);

							expect({ label, redeems: rule }, label).toEqual({
								label,
								redeems: today,
							});

							// A5 re-checks the use and the expiry (not the purpose or the token, which the read fixed).
							let a5 = true;

							try {
								database.prepare(A5).get("key-hash", at);
							} catch {
								a5 = false;
							}

							expect({ label, a5 }, label).toEqual({
								label,
								a5: used_at === null && expires_at > at,
							});

							if (rule) expect(a5, label).toBe(true);

							compared += 1;

							if (rule) redeemable += 1;
						}

		// A signing link of this offer on its page, and an archive link (whatever its link hash) on the archive page,
		// each unused and unexpired.
		expect(compared).toBe(72);
		expect(redeemable).toBe(1 + 3);
	});
});
