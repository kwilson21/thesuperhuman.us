import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	openSession,
	openStudioSession,
	signingIsLive,
	type SigningOfferRow,
	type StoredAgreementSession,
} from "../../src/server/rules/agreement-session";

// The session rules as stories: a session counts until it expires or is revoked, and a signing session only while its
// offer is still sent to the same address.

const NOW = new Date("2026-11-13T12:00:00.000Z");

const session = (
	over: Partial<StoredAgreementSession> = {},
): StoredAgreementSession => ({
	token_hash: "h",
	purpose: "agreement",
	offer_id: "o1",
	link_hash: "l1",
	recipient_email: "grace@example.test",
	verified_at: "2026-11-13T11:00:00.000Z",
	expires_at: "2026-11-13T13:00:00.000Z",
	revoked_at: null,
	csrf_nonce: "n",
	...over,
});

const run = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag }),
			onSuccess: (value) => ({ kept: value }),
		}),
	);

describe("an open session", () => {
	it("is kept before it expires", () => {
		expect(run(openSession.decide({ now: NOW }, session()))).toEqual({
			kept: session(),
		});
	});

	it("is refused at its exact expiry, as the stored text is compared", () => {
		expect(
			run(
				openSession.decide(
					{ now: NOW },
					session({ expires_at: NOW.toISOString() }),
				),
			),
		).toEqual({ refused: "SessionNotOpen" });
	});

	it("is refused when it expired", () => {
		expect(
			run(
				openSession.decide(
					{ now: NOW },
					session({ expires_at: "2026-11-13T11:59:59.999Z" }),
				),
			),
		).toEqual({ refused: "SessionNotOpen" });
	});

	it("is refused when it was revoked", () => {
		expect(
			run(
				openSession.decide(
					{ now: NOW },
					session({ revoked_at: "2026-11-13T11:30:00.000Z" }),
				),
			),
		).toEqual({ refused: "SessionNotOpen" });
	});
});

const offerRow = (over: Partial<SigningOfferRow> = {}): SigningOfferRow => ({
	offer_status: "sent",
	link_revoked_at: null,
	request_status: "open",
	recipient_email_snapshot: "grace@example.test",
	...over,
});

const live = (
	rows: SigningOfferRow[],
	over: Partial<StoredAgreementSession> = {},
) => run(signingIsLive.decide({ session: session(over) }, rows));

describe("a signing session", () => {
	it("is live while its offer is sent to its address through an unrevoked link for an open brief", () => {
		expect(live([offerRow()])).toEqual({ kept: session() });
	});

	it("is live when any one of the rows is live", () => {
		expect(live([offerRow({ offer_status: "draft" }), offerRow()])).toEqual({
			kept: session(),
		});
	});

	it.each([
		["no offer is found", []],
		["the offer is not sent", [offerRow({ offer_status: "superseded" })]],
		[
			"the link was revoked",
			[offerRow({ link_revoked_at: "2026-11-13T11:00:00.000Z" })],
		],
		["the brief was withdrawn", [offerRow({ request_status: "withdrawn" })]],
		["the brief was resolved", [offerRow({ request_status: "resolved" })]],
		[
			"the offer went to another address",
			[offerRow({ recipient_email_snapshot: "x@example.test" })],
		],
		[
			"the offer has no address",
			[offerRow({ recipient_email_snapshot: null })],
		],
	])("is not live when %s", (_name, rows) => {
		expect(live(rows)).toEqual({ refused: "SessionNotOpen" });
	});

	it("is not asked about an offer when it is an archive session", () => {
		expect(live([], { purpose: "archive", offer_id: null })).toEqual({
			kept: session({ purpose: "archive", offer_id: null }),
		});
	});
});

describe("a studio session", () => {
	const stored = {
		email: "grace@example.test",
		expires_at: "2026-11-13T13:00:00.000Z",
		revoked_at: null,
	};

	it("answers its email while open", () => {
		expect(run(openStudioSession.decide({ now: NOW }, stored))).toEqual({
			kept: { email: "grace@example.test" },
		});
	});

	it("is present as a value even when its email is empty", () => {
		expect(
			run(openStudioSession.decide({ now: NOW }, { ...stored, email: "" })),
		).toEqual({
			kept: { email: "" },
		});
	});

	it("is refused when expired or revoked", () => {
		expect(
			run(
				openStudioSession.decide(
					{ now: NOW },
					{ ...stored, expires_at: "2026-11-13T11:00:00.000Z" },
				),
			),
		).toEqual({ refused: "StudioSessionNotOpen" });
		expect(
			run(
				openStudioSession.decide(
					{ now: NOW },
					{ ...stored, revoked_at: "2026-11-13T11:00:00.000Z" },
				),
			),
		).toEqual({ refused: "StudioSessionNotOpen" });
	});
});
