import { readFileSync } from "node:fs";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseDraft, readDraft } from "../../src/lib/agreement-draft-fields";
import { FieldsRefused } from "../../src/lib/fields";
import { AGREEMENT_STATUSES } from "../../src/server/machines/agreement-document";
import {
	openSession,
	type StoredAgreementSession,
} from "../../src/server/rules/agreement-session";
import {
	AlreadySigned,
	type DraftSaveFacts,
	type DraftSaveRequest,
	draftFront,
	type SigningSessionFacts,
	saveSigningDraft,
	type StoredAgreementStatus,
} from "../../src/server/rules/signing-draft";
import { SESSION_GUARD, sessionGuard } from "../helpers/signing-guards";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The draft's rules as stories in the route's order (docs/plans/2026-11-signing-conversion.md, section 2): the session,
// the nonce and the values before anything else is read, then a project and a signed agreement, read just before the
// batch, and the draft written. Then, on sqlite with the real schema (db/music.sql), the batch's guards held to the
// decisions: A2 (`sessionGuard`, copied in tests/helpers/signing-guards.ts and held here to the store's text) to
// `openSession`, which decides the
// session the draft is given (through `visitorSession`), and A3 (the draft's own guard, copied from
// `saveAgreementDraft` in src/lib/agreement-draft.ts) to `saveSigningDraft`'s AlreadySigned. A1 is held to
// `openForSigning` in tests/rules/signing-offer.test.ts.

type Said =
	| { refused: string; say: string; errors?: unknown }
	| { wrote: unknown };

const said = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal): Said =>
				"errors" in refusal
					? { refused: refusal._tag, say: refusal.say, errors: refusal.errors }
					: { refused: refusal._tag, say: refusal.say },
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

const RECIPIENT = "client@example.com";
const NOW = "2026-11-23T12:00:00.000Z";

const session: StoredAgreementSession = {
	token_hash: "session-hash",
	purpose: "agreement",
	offer_id: "o1",
	link_hash: "offer-link-hash",
	recipient_email: RECIPIENT,
	verified_at: "2026-11-23T11:00:00.000Z",
	expires_at: "2026-11-23T13:00:00.000Z",
	revoked_at: null,
	csrf_nonce: "nonce-1",
};

const held: SigningSessionFacts = {
	offer: { id: "o1" },
	session,
	software_signing_enabled: 1,
};

const VALUES = { legal_name: "Acme LLC", signer_name: " Grace Hopper " };

const DRAFT = {
	legal_name: "Acme LLC",
	entity_type: "",
	state: "",
	country: "",
	business_address: "",
	signer_name: "Grace Hopper",
	signer_title: "",
	portfolio_choice: "",
	reviewer_name: "",
	reviewer_email: "",
	approver_name: "",
	approver_email: "",
	notice_email: "",
};

const MISSING = {
	refused: "SessionMissing",
	say: "Open a fresh email link to keep going. Your saved details will be here.",
};

const RELOAD = { refused: "CsrfMismatch", say: "Reload and try again." };

const NOT_SAVED =
	"Your details could not be saved. Check the fields and try again.";

const front = (
	facts: Partial<SigningSessionFacts> = {},
	body: { nonce?: unknown; values?: unknown } = {},
) =>
	said(
		draftFront.decide(
			{ nonce: "nonce-1", values: VALUES, ...body },
			{ ...held, ...facts },
		),
	);

describe("before anything else is read", () => {
	it("goes on with the visitor's session and the draft read from the values", () => {
		expect(front()).toEqual({ wrote: { session, draft: DRAFT } });
	});

	it("needs a sent offer, the visitor's open session for it and signing on", () => {
		expect(front({ offer: null })).toEqual(MISSING);
		expect(front({ session: null })).toEqual(MISSING);
		expect(front({ session: { ...session, offer_id: "o2" } })).toEqual(MISSING);
		expect(front({ software_signing_enabled: 0 })).toEqual(MISSING);
		expect(front({ software_signing_enabled: null })).toEqual(MISSING);
	});

	it("needs the session's nonce, compared as it arrived", () => {
		for (const nonce of ["nonce-2", "", undefined, null, 1, ["nonce-1"]])
			expect(front({}, { nonce })).toEqual(RELOAD);
	});

	it("needs values that read as a draft, and answers what each field must fix", () => {
		expect(front({}, { values: { legal_name: "Acme\u0001" } })).toEqual({
			refused: "DraftRefused",
			say: "Check the highlighted details.",
			errors: { legal_name: "Remove unusual characters from this field." },
		});
		expect(front({}, { values: { nope: "x" } })).toEqual({
			refused: "DraftRefused",
			say: "Check the highlighted details.",
			errors: { legal_name: "Check this field." },
		});
		expect(front({}, { values: undefined })).toEqual({
			refused: "DraftRefused",
			say: "Check the highlighted details.",
			errors: { legal_name: "Check this field." },
		});
	});

	it("answers the session first, then the nonce, then the values", () => {
		expect(
			front({ session: null }, { nonce: "wrong", values: { nope: 1 } }),
		).toEqual(MISSING);
		expect(front({}, { nonce: "wrong", values: { nope: 1 } })).toEqual(RELOAD);
	});
});

const agreement = (
	status: string,
	offer_id: string | null = "o1",
): StoredAgreementStatus => ({ offer_id, status });

const save = (
	facts: Partial<DraftSaveFacts> = {},
	body: { nonce?: unknown; values?: unknown } = {},
) =>
	said(
		saveSigningDraft.decide(saveRequest(body), {
			...held,
			agreements: [],
			project: null,
			...facts,
		}),
	);

const saveRequest = (
	body: { nonce?: unknown; values?: unknown } = {},
): DraftSaveRequest => ({
	nonce: "nonce-1",
	values: VALUES,
	...body,
	at: new Date(NOW),
	route: "draft",
});

describe("saving the draft", () => {
	it("upserts the draft of the offer and the session's address, read again as it is stored, with A1's and A2's binds", () => {
		expect(save()).toEqual({
			wrote: {
				offerId: "o1",
				recipient: RECIPIENT,
				linkHash: "offer-link-hash",
				sessionHash: "session-hash",
				values_json: JSON.stringify(DRAFT),
				updated_at: NOW,
			},
		});
	});

	it("is refused once a project exists for the offer, with the draft's 409 (SigningStarted)", () => {
		expect(save({ project: { offer_id: "o1" } })).toEqual({
			refused: "SigningStarted",
			// The shared refusal's own sentence is the signing link's; the draft route answers it with NOT_SAVED.
			say: "This offer is unavailable for signing.",
		});
		expect(save({ project: { offer_id: "o2" } })).toEqual(
			expect.objectContaining({ wrote: expect.anything() }),
		);
	});

	it("is refused once an agreement of the offer is client-signed or executed", () => {
		for (const status of ["client_signed", "executed"])
			expect(
				save({ agreements: [agreement("review"), agreement(status)] }),
			).toEqual({ refused: "AlreadySigned", say: NOT_SAVED });

		expect(
			save({
				agreements: [
					agreement("review"),
					agreement("abandoned"),
					agreement("executed", "o2"),
				],
			}),
		).toEqual(expect.objectContaining({ wrote: expect.anything() }));
	});

	it("answers the front first, then the project, then a signed agreement (the batch's order: A1 before A3)", () => {
		const both = {
			project: { offer_id: "o1" },
			agreements: [agreement("executed")],
		};

		expect(save({ ...both, session: null })).toEqual(MISSING);
		expect(save(both, { nonce: "wrong" })).toEqual(RELOAD);
		expect(save(both, { values: 5 })).toEqual(
			expect.objectContaining({ refused: "DraftRefused" }),
		);
		expect(save(both)).toEqual(
			expect.objectContaining({ refused: "SigningStarted" }),
		);
	});

	// The draft route's second read runs where the rule is asked, as today's runs before the batch, so a value that reads
	// once but not twice throws there: asked inside a flow, that is a defect, the route's logged 500.
	const asked = (request: DraftSaveRequest, facts: DraftSaveFacts) =>
		Effect.runSyncExit(
			Effect.suspend(() => saveSigningDraft.decide(request, facts)),
		);

	it("dies with today's FieldsRefused when the values read once but not twice (a field whose NFC form outgrows its limit)", () => {
		const values = { legal_name: "\u0958".repeat(200) };
		const first = readDraft(values);

		// Today: the route's read passes, and saveAgreementDraft's second read throws (the route's logged 500).
		expect(first.ok && first.value.legal_name.length).toBe(400);
		expect(() => parseDraft(first.ok ? first.value : {})).toThrow(
			FieldsRefused,
		);

		const exit = asked(saveRequest({ values }), {
			...held,
			agreements: [],
			project: null,
		});

		expect(Exit.isFailure(exit)).toBe(true);

		if (Exit.isFailure(exit)) {
			expect(Cause.hasDies(exit.cause)).toBe(true);
			expect(Cause.squash(exit.cause)).toBeInstanceOf(FieldsRefused);
		}
	});

	it("reads the draft route's values a second time before the project and signed checks, as today", () => {
		// Today `saveAgreementDraft` parses the route's value again before its batch, so a value that reads once but not
		// twice is the logged 500 even when the offer is signed or a project started (A3 and A1 only check in the batch).
		const values = { legal_name: "\u0958".repeat(200) };

		for (const facts of [
			{ ...held, agreements: [agreement("client_signed")], project: null },
			{ ...held, agreements: [], project: { offer_id: "o1" } },
			{
				...held,
				agreements: [agreement("executed")],
				project: { offer_id: "o1" },
			},
		]) {
			const exit = asked(saveRequest({ values }), facts);

			expect(Exit.isFailure(exit)).toBe(true);

			if (Exit.isFailure(exit)) {
				expect(Cause.hasDies(exit.cause)).toBe(true);
				expect(Cause.squash(exit.cause)).toBeInstanceOf(FieldsRefused);
			}
		}

		// The review reads them once: the signed agreement is its refusal.
		expect(
			asked(
				{ ...saveRequest({ values }), route: "review" },
				{ ...held, agreements: [agreement("client_signed")], project: null },
			),
		).toEqual(Exit.fail(new AlreadySigned()));
	});

	it("stores the review's values as read once, as the review route's single read does today", () => {
		// The review hands saveAgreementDraft the body's values, which parseDraft reads once: a value whose NFC form
		// outgrows its limit is stored as read, and the review goes on (the country is read by no later check when the
		// state is a US state).
		const values = {
			legal_name: "Sample LLC",
			entity_type: "LLC",
			state: "Wyoming",
			country: "\u0958".repeat(100),
			business_address: "100 Example Street",
			signer_name: "Example Signer",
			signer_title: "Owner",
			portfolio_choice: "private",
		};

		const today = parseDraft(values);

		const exit = asked(
			{ ...saveRequest({ values }), route: "review" },
			{ ...held, agreements: [], project: null },
		);

		expect(Exit.isSuccess(exit)).toBe(true);

		if (Exit.isSuccess(exit))
			expect(exit.value.values_json).toBe(JSON.stringify(today));

		// The draft route reads the same values a second time: today's FieldsRefused, a defect.
		const draftRoute = asked(saveRequest({ values }), {
			...held,
			agreements: [],
			project: null,
		});

		expect(Exit.isFailure(draftRoute)).toBe(true);

		if (Exit.isFailure(draftRoute))
			expect(Cause.squash(draftRoute.cause)).toBeInstanceOf(FieldsRefused);
	});
});

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeAll(() => {
	database.exec(readFileSync("db/music.sql", "utf8"));
	// The agreements below name no client or template: only the columns A3 reads matter here.
	database.exec("PRAGMA foreign_keys=OFF");
});

afterEach(() => {
	vi.useRealTimers();
});

describe("A2 and the session the draft is given", () => {
	const EXPIRIES = [
		"2026-11-23T11:59:59.999Z",
		NOW,
		"2026-11-23T12:00:00.001Z",
	] as const;

	it("refuse exactly together, for every expiry and revocation, and a session that is gone", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));

		let compared = 0;
		let open = 0;

		const cases: (StoredAgreementSession | null)[] = [
			null,
			...EXPIRIES.flatMap((expires_at) =>
				[null, "2026-11-23T11:30:00.000Z"].map((revoked_at) => ({
					...session,
					expires_at,
					revoked_at,
				})),
			),
		];

		for (const row of cases) {
			database.exec("DELETE FROM software_agreement_sessions");

			if (row)
				database
					.prepare(
						"INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,revoked_at,csrf_nonce) VALUES(?,?,?,?,?,?,?,?,?,?)",
					)
					.run(
						row.token_hash,
						row.purpose,
						row.offer_id,
						row.link_hash,
						row.recipient_email,
						"link-1",
						row.verified_at,
						row.expires_at,
						row.revoked_at,
						row.csrf_nonce,
					);

			// What `visitorSession` gives the rule: the session while it is open at the instant read, else none.
			const visitor =
				row === null
					? null
					: Effect.runSync(
							Effect.match(openSession.decide({ now: new Date(NOW) }, row), {
								onFailure: () => null,
								onSuccess: (open) => open,
							}),
						);

			const rule =
				"refused" in
				said(
					saveSigningDraft.decide(saveRequest(), {
						...held,
						session: visitor,
						agreements: [],
						project: null,
					}),
				);

			const guard = await sessionGuard(db, { ...session, ...row })
				.first()
				.then(
					() => false,
					() => true,
				);

			const label = JSON.stringify(row);

			expect({ label, refuses: guard }, label).toEqual({
				label,
				refuses: rule,
			});
			compared += 1;

			if (!rule) open += 1;
		}

		expect(compared).toBe(7);
		expect(open).toBe(1);
	});
});

/** A3 as `saveAgreementDraft` ran it before the conversion (the store's `saveDraftBatch` builds the same text), copied. */
const A3 =
	"SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed')) THEN 1 ELSE json_extract('Already signed','$') END";

describe("A2 as copied", () => {
	it("is the store's guard, text for text", () => {
		expect(readFileSync("src/server/agreement-store.ts", "utf8")).toContain(
			SESSION_GUARD,
		);
	});
});

describe("A3 and AlreadySigned", () => {
	let stored = 0;

	const store = (offerId: string, status: string) => {
		stored += 1;
		database
			.prepare(
				"INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
			)
			.run(
				`a${stored}`,
				"msa",
				offerId,
				"r1",
				`client-${stored}`,
				"template-1",
				status,
				"text",
				"0".repeat(64),
				"{}",
				NOW,
				"2026-11-23",
				"review-hash",
			);
	};

	/** The offer's agreements, read as the store will read them: every one, whatever its status. */
	const readAgreements = (offerId: string) =>
		// SAFETY: the statement selects exactly the two columns of StoredAgreementStatus, which the schema stores as text.
		database
			.prepare(
				"SELECT offer_id,status FROM software_agreements WHERE offer_id=?",
			)
			.all(offerId) as StoredAgreementStatus[];

	const a3Refuses = (offerId: string) => {
		try {
			database.prepare(A3).get(offerId);

			return false;
		} catch {
			return true;
		}
	};

	it("refuse exactly together, for up to two agreements of the offer of every status, and another offer's", () => {
		const sets: string[][] = [
			[],
			...AGREEMENT_STATUSES.map((status) => [status]),
			...AGREEMENT_STATUSES.flatMap((first) =>
				AGREEMENT_STATUSES.map((second) => [first, second]),
			),
		];

		let compared = 0;
		let signed = 0;

		for (const statuses of sets)
			for (const other of [null, ...AGREEMENT_STATUSES]) {
				database.exec("DELETE FROM software_agreements");

				for (const status of statuses) store("o1", status);

				if (other) store("o2", other);

				const label = JSON.stringify({ statuses, other });

				const rule = save({ agreements: readAgreements("o1") });

				expect({ label, refuses: a3Refuses("o1") }, label).toEqual({
					label,
					refuses: "refused" in rule,
				});

				if ("refused" in rule) {
					expect(rule.refused, label).toBe("AlreadySigned");
					signed += 1;
				}

				compared += 1;
			}

		// Every set with a client-signed or executed agreement of the offer: 2 alone, and 16 - 4 of the pairs.
		expect(compared).toBe(21 * 5);
		expect(signed).toBe((2 + 12) * 5);
	});
});
