import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it } from "vitest";
import { softwareGuard } from "../../src/lib/software-guard";
import {
	AGREEMENT_MOVES,
	AGREEMENT_STATUSES,
	type AgreementStatus,
	agreementDocument,
} from "../../src/server/machines/agreement-document";
import { next } from "../../src/server/machines/next";
import type { StoredAgreementSession } from "../../src/server/rules/agreement-session";
import type { SigningStateRow } from "../../src/server/rules/signing-offer";
import {
	DetailsChanged,
	DocumentsChanged,
	type DocumentsToSign,
	documentsToSign,
	type DraftRow,
	EvidenceTooLong,
	type NamedDocument,
	NameNotPrintable,
	type ReusedMsaRow,
	SIGNING_CHANGED,
	type SignIds,
	type SignRequest,
	type SigningDocumentRow,
	SignedElsewhere,
	signDocuments,
	savedReceipt,
	StoredDataRefused,
	stillSignable,
} from "../../src/server/rules/signing-sign";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The client's signature (docs/plans/2026-11-signing-conversion.md, section 2, `signing-sign.ts`), stage by stage in the
// order today's `signAgreements` answers: the documents named, a repeat's saved receipt, the draft and the statements,
// and what only the batch's guards checked before. Then the three guards the sign keeps in SQL (A7, A8, A9), run on
// sqlite with today's SQL copied from src/lib/software-agreements.ts, held to the rule's decision over the same facts.

const MSA_ID = "00000000-0000-4000-8000-0000000000a1";
const SOW_ID = "00000000-0000-4000-8000-0000000000a2";
const MSA_HASH = "a".repeat(64);
const SOW_HASH = "b".repeat(64);
const OTHER_HASH = "f".repeat(64);
const TOKEN = "this-session-hash";
const OTHER_TOKEN = "other-session-hash";
const EMAIL = "grace@example.test";
const AT = "2026-11-13T12:00:00.000Z";

const CLIENT = {
	legal_name: "Grace Hopper LLC",
	entity_type: "LLC",
	jurisdiction: "Virginia",
	business_address: "1 Main St",
	notice_email: "notices@example.test",
	reviewer_name: "Grace Hopper",
	reviewer_email: EMAIL,
	approver_name: "Grace Hopper",
	approver_email: EMAIL,
	signer_name: "Grace Hopper",
	signer_title: "Founder",
	portfolio: "deny",
	naming: false,
};

const CONTRACTOR = {
	legal_name: "The Superhuman Group LLC",
	notice_email: "owner@example.test",
	config_version: "1",
};

/** The draft the client saved, which resolves to CLIENT with the session's address. */
const DRAFT = {
	legal_name: "Grace Hopper LLC",
	entity_type: "LLC",
	state: "Virginia",
	business_address: "1 Main St",
	signer_name: "Grace Hopper",
	signer_title: "Founder",
	portfolio_choice: "private",
	notice_email: "notices@example.test",
};

type Loose = { readonly [key: string]: string | boolean | undefined };

const valuesJson = (
	client: Loose | null = CLIENT,
	contractor: Loose | null = CONTRACTOR,
) => JSON.stringify({ client, contractor });

const doc = (
	kind: "msa" | "sow",
	over: Partial<SigningDocumentRow> = {},
): SigningDocumentRow => ({
	id: kind === "msa" ? MSA_ID : SOW_ID,
	kind,
	client_id: "client-1",
	status: "review",
	text_sha256: kind === "msa" ? MSA_HASH : SOW_HASH,
	values_json: valuesJson(),
	review_session_hash: TOKEN,
	...over,
});

const BOTH: NamedDocument[] = [
	{ id: MSA_ID, hash: MSA_HASH },
	{ id: SOW_ID, hash: SOW_HASH },
];

const SOW_ONLY: NamedDocument[] = [{ id: SOW_ID, hash: SOW_HASH }];

const SESSION: StoredAgreementSession = {
	token_hash: TOKEN,
	purpose: "agreement",
	offer_id: "o1",
	link_hash: "link-hash",
	recipient_email: EMAIL,
	verified_at: "2026-11-13T11:30:00.000Z",
	expires_at: "2026-11-13T13:30:00.000Z",
	revoked_at: null,
	csrf_nonce: "csrf",
};

type Said = { refused: string } | { wrote: unknown };

const said = <W, E extends { _tag: string }>(
	decided: Effect.Effect<W, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag }),
			onSuccess: (value) => ({ wrote: value }),
		}),
	);

/** Stage 1's answer for a signature, which every later stage starts from. */
function chosen(
	rows: readonly SigningDocumentRow[],
	named: readonly NamedDocument[] = BOTH,
) {
	const answer = Effect.runSync(documentsToSign.decide({ named }, rows));

	if (answer.kind !== "sign") throw new Error("expected a signature");

	return answer;
}

const ids = (documents: number): SignIds => ({
	receipt: "receipt-1",
	notice: "notice-1",
	documents: Array.from({ length: documents }, (_, index) => ({
		signature: `signature-${index + 1}`,
		event: `event-${index + 1}`,
	})),
});

const request = (over: Partial<SignRequest> = {}): SignRequest => ({
	at: AT,
	ids: ids(2),
	session: SESSION,
	offer: { id: "o1", reused_msa_id: null },
	named: BOTH,
	address: "203.0.113.9",
	userAgent: "golden-browser",
	...over,
});

const sign = (
	rows: readonly SigningDocumentRow[] = [doc("msa"), doc("sow")],
	over: Partial<SignRequest> = {},
	draft: DraftRow | null = null,
) =>
	said(
		signDocuments.decide(request(over), {
			chosen: chosen(rows, over.named ?? BOTH),
			draft,
		}),
	);

const draftRow = (values: Loose): DraftRow => ({
	values_json: JSON.stringify(values),
});

describe("the documents a signature signs", () => {
	const choose = (
		rows: readonly SigningDocumentRow[],
		named: readonly NamedDocument[] = BOTH,
	) => said(documentsToSign.decide({ named }, rows));

	it("signs both documents in review, in kind order, with the client read from the MSA's values", () => {
		expect(choose([doc("sow"), doc("msa")])).toEqual({
			wrote: {
				kind: "sign",
				documents: [doc("msa"), doc("sow")],
				client: CLIENT,
				contractorNotice: "owner@example.test",
			},
		});
		expect(choose([doc("msa"), doc("sow")], [...BOTH].reverse())).toEqual(
			choose([doc("msa"), doc("sow")]),
		);
	});

	it("reads the client from the first document to sign", () => {
		const answer = choose([
			doc("msa", { values_json: valuesJson({ ...CLIENT, signer_name: "A" }) }),
			doc("sow", { values_json: valuesJson({ ...CLIENT, signer_name: "B" }) }),
		]);

		expect(answer).toMatchObject({
			wrote: { client: { signer_name: "A" } },
		});
	});

	it("leaves out abandoned documents, so the SOW named alone signs beside an abandoned MSA", () => {
		expect(
			choose([doc("msa", { status: "abandoned" }), doc("sow")], SOW_ONLY),
		).toMatchObject({ wrote: { kind: "sign", documents: [doc("sow")] } });
	});

	it("refuses documents that are not exactly those left to sign, with the hashes read", () => {
		const refused = { refused: "DocumentsChanged" };

		expect(
			choose(
				[doc("msa"), doc("sow")],
				[{ id: MSA_ID, hash: SOW_HASH }, BOTH[1]],
			),
		).toEqual(refused);
		expect(choose([doc("msa"), doc("sow")], SOW_ONLY)).toEqual(refused);
		expect(choose([doc("msa"), doc("sow")], [BOTH[0]])).toEqual(refused);
		expect(
			choose(
				[doc("msa"), doc("sow")],
				[
					...BOTH,
					{ id: "00000000-0000-4000-8000-0000000000b1", hash: MSA_HASH },
				],
			),
		).toEqual(refused);
		expect(
			choose([doc("msa"), doc("sow", { text_sha256: OTHER_HASH })]),
		).toEqual(refused);
		expect(choose([])).toEqual(refused);
		expect(choose([], [])).toEqual(refused);
		expect(
			choose([
				doc("msa", { status: "executed" }),
				doc("sow", { status: "executed" }),
			]),
		).toEqual(refused);
		expect(choose([doc("msa"), doc("sow", { status: "executed" })])).toEqual(
			refused,
		);
		expect(choose([doc("msa", { status: "abandoned" }), doc("sow")])).toEqual(
			refused,
		);
		expect(choose([doc("msa"), doc("sow", { status: "abandoned" })])).toEqual(
			refused,
		);
	});

	it("is a repeat when every document left to sign is client_signed, and then reads no values", () => {
		expect(
			choose([
				doc("sow", { status: "client_signed", values_json: "not json" }),
				doc("msa", { status: "client_signed", values_json: "null" }),
			]),
		).toEqual({ wrote: { kind: "repeat", agreementId: MSA_ID } });
		expect(
			choose(
				[
					doc("msa", { status: "executed" }),
					doc("sow", { status: "client_signed" }),
				],
				SOW_ONLY,
			),
		).toEqual({ wrote: { kind: "repeat", agreementId: SOW_ID } });
	});

	it("goes on to sign when only one document is client_signed (A9 refuses it before the batch)", () => {
		expect(
			choose([doc("msa", { status: "client_signed" }), doc("sow")]),
		).toMatchObject({ wrote: { kind: "sign" } });
	});

	it("refuses stored values that do not read", () => {
		const refused = { refused: "StoredDataRefused" };

		const values = (values_json: string) =>
			choose([doc("msa", { values_json }), doc("sow")]);

		expect(values("not json")).toEqual(refused);
		expect(values("null")).toEqual(refused);
		expect(values("5")).toEqual(refused);
		expect(values("[]")).toEqual(refused);
		expect(values(valuesJson(null))).toEqual(refused);
		expect(values(JSON.stringify({ contractor: CONTRACTOR }))).toEqual(refused);
		expect(values(valuesJson({ ...CLIENT, legal_name: undefined }))).toEqual(
			refused,
		);
		expect(values(valuesJson({ ...CLIENT, extra: "x" }))).toEqual(refused);
		expect(
			values(valuesJson({ ...CLIENT, portfolio: "deny", naming: true })),
		).toEqual(refused);
		expect(values(valuesJson({ ...CLIENT, signer_name: "" }))).toEqual(refused);
		expect(
			values(valuesJson({ ...CLIENT, signer_name: "Grace\u0007Hopper" })),
		).toEqual(refused);
	});

	it("reads the client as the client reader does: composed, with portfolio naming allowed", () => {
		expect(
			choose([
				doc("msa", {
					values_json: valuesJson({
						...CLIENT,
						signer_name: "José Nu\u0303nez",
						portfolio: "allow",
						naming: true,
					}),
				}),
				doc("sow"),
			]),
		).toMatchObject({
			wrote: {
				client: {
					signer_name: "José N\u0169nez",
					portfolio: "allow",
					naming: true,
				},
			},
		});
	});

	it("keeps a contractor that does not read for the batch's last statement", () => {
		const contractor = (values_json: string) =>
			choose([doc("msa", { values_json }), doc("sow")]);

		expect(contractor(JSON.stringify({ client: CLIENT }))).toMatchObject({
			wrote: { kind: "sign", contractorNotice: null },
		});
		expect(contractor(valuesJson(CLIENT, null))).toMatchObject({
			wrote: { contractorNotice: null },
		});
		expect(
			contractor(JSON.stringify({ client: CLIENT, contractor: {} })),
		).toMatchObject({ wrote: { contractorNotice: null } });
		expect(
			contractor(
				JSON.stringify({ client: CLIENT, contractor: { notice_email: 5 } }),
			),
		).toMatchObject({ wrote: { contractorNotice: null } });
	});

	it("refuses the documents named before the stored values", () => {
		expect(
			choose([doc("msa", { values_json: "null" }), doc("sow")], SOW_ONLY),
		).toEqual({ refused: "DocumentsChanged" });
	});
});

describe("a repeat's saved receipt", () => {
	const repeat = (
		saved: { receipt_id: string; session_token_hash: string | null } | null,
	) => said(savedReceipt.decide({ session: SESSION }, saved));

	it("answers the receipt this session saved", () => {
		expect(
			repeat({ receipt_id: "receipt-0", session_token_hash: TOKEN }),
		).toEqual({ wrote: "receipt-0" });
	});

	it("refuses another session's signature, a signature with no session, and none", () => {
		const refused = { refused: "SignedElsewhere" };

		expect(
			repeat({ receipt_id: "receipt-0", session_token_hash: OTHER_TOKEN }),
		).toEqual(refused);
		expect(
			repeat({ receipt_id: "receipt-0", session_token_hash: null }),
		).toEqual(refused);
		expect(repeat(null)).toEqual(refused);
	});
});

const CONSENT =
	"I agree to sign and receive these documents electronically, and I’m authorized to sign for Grace Hopper LLC, a business. I can download and keep a complete copy.";

const BOTH_INTENT =
	"Signing applies your name above as your electronic signature on the agreement and statement of work linked above.";

const SOW_INTENT =
	"Signing applies your name above as your electronic signature on the statement of work linked above.";

const signature = (
	id: string,
	agreement: string,
	hash: string,
	over: Partial<Record<string, string>> = {},
) => ({
	id,
	agreement_id: agreement,
	party: "client",
	typed_name: "Grace Hopper",
	title: "Founder",
	consent_text: CONSENT,
	consent_at: AT,
	signed_at: AT,
	document_sha256: hash,
	session_token_hash: TOKEN,
	owner_subject: null,
	verified_email: EMAIL,
	verified_at: "2026-11-13T11:30:00.000Z",
	verification_method: "verified by one-time email link",
	intent_text: BOTH_INTENT,
	document_list_json: `[{"id":"${MSA_ID}","hash":"${MSA_HASH}"},{"id":"${SOW_ID}","hash":"${SOW_HASH}"}]`,
	receipt_id: "receipt-1",
	ip_address: "203.0.113.9",
	user_agent: "golden-browser",
	...over,
});

const event = (id: string, agreement: string) => ({
	id,
	agreement_id: agreement,
	offer_id: "o1",
	action: "client-signed",
	actor: TOKEN,
	occurred_at: AT,
	reason: null,
});

describe("the signature's batch", () => {
	it("writes the notice, each document's signature, event and status, the draft removed and the two notifications", () => {
		expect(sign()).toEqual({
			wrote: {
				receiptId: "receipt-1",
				guards: {
					offerId: "o1",
					linkHash: "link-hash",
					recipient: EMAIL,
					sessionTokenHash: TOKEN,
					draftValues: null,
					reusedMsaId: null,
					signFrom: ["review"],
				},
				notice: {
					id: "notice-1",
					agreement_id: SOW_ID,
					client_id: "client-1",
					business_address: "1 Main St",
					notice_email: "notices@example.test",
					recorded_at: AT,
				},
				documents: [
					{
						id: MSA_ID,
						text_sha256: MSA_HASH,
						signature: signature("signature-1", MSA_ID, MSA_HASH),
						event: event("event-1", MSA_ID),
						status: "client_signed",
						client_signed_at: AT,
					},
					{
						id: SOW_ID,
						text_sha256: SOW_HASH,
						signature: signature("signature-2", SOW_ID, SOW_HASH),
						event: event("event-2", SOW_ID),
						status: "client_signed",
						client_signed_at: AT,
					},
				],
				draft: { offer_id: "o1", recipient_email: EMAIL },
				notifications: [
					{
						agreement_id: SOW_ID,
						kind: "signature-receipt",
						email: EMAIL,
					},
					{
						agreement_id: SOW_ID,
						kind: "countersign-notice",
						email: "owner@example.test",
					},
				],
			},
		});
	});

	it("moves each document where SIGN leads in the machine", () => {
		expect(next(agreementDocument, "review", "SIGN")).toBe("client_signed");
		expect(AGREEMENT_MOVES.SIGN).toEqual(["review"]);
	});

	it("signs the SOW alone for an offer that reuses an MSA, with the SOW-only intent and the reused MSA's guard", () => {
		const signed = sign([doc("sow")], {
			ids: ids(1),
			named: SOW_ONLY,
			offer: { id: "o1", reused_msa_id: "msa-old" },
		});

		expect(signed).toMatchObject({
			wrote: {
				guards: { reusedMsaId: "msa-old" },
				notice: { agreement_id: SOW_ID },
				documents: [
					{
						signature: signature("signature-1", SOW_ID, SOW_HASH, {
							intent_text: SOW_INTENT,
							document_list_json: `[{"id":"${SOW_ID}","hash":"${SOW_HASH}"}]`,
						}),
						event: event("event-1", SOW_ID),
					},
				],
			},
		});
	});

	it("has no reused MSA guard for an empty id, as today", () => {
		expect(
			sign(undefined, { offer: { id: "o1", reused_msa_id: "" } }),
		).toMatchObject({ wrote: { guards: { reusedMsaId: null } } });
	});

	it("keeps the draft as read for its guard (A7)", () => {
		expect(
			sign(undefined, {}, { values_json: JSON.stringify(DRAFT) }),
		).toMatchObject({
			wrote: { guards: { draftValues: JSON.stringify(DRAFT) } },
		});
	});

	it("records absent browser evidence as empty text, and the evidence at its limits", () => {
		expect(sign(undefined, { address: null, userAgent: null })).toMatchObject({
			wrote: {
				documents: [
					{ signature: { ip_address: "", user_agent: "" } },
					{ signature: { ip_address: "", user_agent: "" } },
				],
			},
		});
		expect(
			sign(undefined, {
				address: "1".repeat(100),
				userAgent: "u".repeat(2000),
			}),
		).toMatchObject({
			wrote: {
				documents: [
					{
						signature: {
							ip_address: "1".repeat(100),
							user_agent: "u".repeat(2000),
						},
					},
					{},
				],
			},
		});
	});

	it("signs with the names the client reader made: composed, with unicode the fonts print", () => {
		const values = valuesJson({
			...CLIENT,
			signer_name: "José Nu\u0303nez",
			signer_title: "Directrice générale",
		});

		expect(
			sign([doc("msa", { values_json: values }), doc("sow")]),
		).toMatchObject({
			wrote: {
				documents: [
					{
						signature: {
							typed_name: "José N\u0169nez",
							title: "Directrice générale",
						},
					},
					{},
				],
			},
		});
	});

	it("accepts a saved draft that resolves to the reviewed client, blanks filled with the session's address", () => {
		expect(sign(undefined, {}, draftRow(DRAFT))).toMatchObject({
			wrote: { receiptId: "receipt-1" },
		});
		expect(
			sign(undefined, {}, draftRow({ ...DRAFT, notice_email: "" })),
		).toEqual({ refused: "DetailsChanged" });
		expect(
			sign(
				[
					doc("msa", {
						values_json: valuesJson({ ...CLIENT, notice_email: EMAIL }),
					}),
					doc("sow"),
				],
				{},
				draftRow({ ...DRAFT, notice_email: "" }),
			),
		).toMatchObject({ wrote: { receiptId: "receipt-1" } });
	});

	it("refuses a draft that differs, no longer resolves, has an unknown field or is not JSON", () => {
		const refused = { refused: "DetailsChanged" };

		expect(
			sign(undefined, {}, draftRow({ ...DRAFT, legal_name: "Another LLC" })),
		).toEqual(refused);
		expect(sign(undefined, {}, draftRow({ legal_name: "x" }))).toEqual(refused);
		expect(sign(undefined, {}, draftRow({ ...DRAFT, extra: "x" }))).toEqual(
			refused,
		);
		expect(sign(undefined, {}, { values_json: "not json" })).toEqual(refused);
	});

	it("refuses documents to sign that hold no SOW", () => {
		expect(sign([doc("msa")], { ids: ids(1), named: [BOTH[0]] })).toEqual({
			refused: "DocumentsChanged",
		});
	});

	it("refuses a signer's name or title the fonts cannot print", () => {
		const named = (signer_name: string, signer_title = "Founder") =>
			sign([
				doc("msa", {
					values_json: valuesJson({ ...CLIENT, signer_name, signer_title }),
				}),
				doc("sow"),
			]);

		const refused = { refused: "NameNotPrintable" };

		expect(named("李小龙")).toEqual(refused);
		expect(named("Grace 🙂 Hopper")).toEqual(refused);
		expect(named("غريس هوبر")).toEqual(refused);
		expect(named("Grace Hopper", "总裁")).toEqual(refused);
		expect(named("Грейс Хоппер")).toMatchObject({ wrote: {} });
		expect(named("Γκρέις Χόπερ")).toMatchObject({ wrote: {} });
	});

	it("refuses browser evidence over its limits or with a control character", () => {
		const refused = { refused: "EvidenceTooLong" };

		expect(sign(undefined, { address: "1".repeat(101) })).toEqual(refused);
		expect(sign(undefined, { userAgent: "u".repeat(2001) })).toEqual(refused);
		expect(sign(undefined, { userAgent: "a\u0001b" })).toEqual(refused);
		expect(sign(undefined, { userAgent: "a\tb" })).toEqual(refused);
		expect(sign(undefined, { address: "203.0.113.9\u007f" })).toEqual(refused);
		expect(sign(undefined, { address: null, userAgent: "\u001f" })).toEqual(
			refused,
		);
	});

	it("refuses values with no contractor notice email that is text", () => {
		const refused = { refused: "StoredDataRefused" };

		const values = (values_json: string) =>
			sign([doc("msa", { values_json }), doc("sow")]);

		expect(values(JSON.stringify({ client: CLIENT }))).toEqual(refused);
		expect(values(valuesJson(CLIENT, null))).toEqual(refused);
		expect(values(JSON.stringify({ client: CLIENT, contractor: {} }))).toEqual(
			refused,
		);
	});

	it("refuses in the order today's code builds the batch", () => {
		const unprintable = valuesJson({ ...CLIENT, signer_name: "李小龙" });

		const noContractor = (client: Loose) => JSON.stringify({ client });

		expect(
			sign(
				[doc("msa", { values_json: unprintable }), doc("sow")],
				{ address: "1".repeat(101) },
				draftRow({ ...DRAFT, legal_name: "Another LLC" }),
			),
		).toEqual({ refused: "DetailsChanged" });
		expect(
			sign([doc("msa", { values_json: unprintable })], {
				ids: ids(1),
				named: [BOTH[0]],
			}),
		).toEqual({ refused: "DocumentsChanged" });
		expect(
			sign([doc("msa", { values_json: unprintable }), doc("sow")], {
				address: "1".repeat(101),
			}),
		).toEqual({ refused: "NameNotPrintable" });
		expect(
			sign([doc("msa", { values_json: noContractor(CLIENT) }), doc("sow")], {
				address: "1".repeat(101),
			}),
		).toEqual({ refused: "EvidenceTooLong" });
	});
});

const OPEN: SigningStateRow = {
	status: "sent",
	recipient_email_snapshot: EMAIL,
	request_status: "offer_sent",
	link_hash: "link-hash",
	link_revoked_at: null,
	software_signing_enabled: 1,
	project_offer_id: null,
};

const REUSED: ReusedMsaRow = {
	id: "msa-old",
	kind: "msa",
	status: "executed",
	terminated_at: null,
};

const still = (
	over: {
		signing?: SigningStateRow | null;
		reusedMsa?: ReusedMsaRow | null;
		reusedMsaId?: string | null;
		session?: StoredAgreementSession;
		documents?: readonly SigningDocumentRow[];
	} = {},
) =>
	said(
		stillSignable.decide(
			{
				at: AT,
				session: over.session ?? SESSION,
				offer: { reused_msa_id: over.reusedMsaId ?? null },
				documents: over.documents ?? [doc("msa"), doc("sow")],
			},
			{
				signing: over.signing === undefined ? OPEN : over.signing,
				reusedMsa: over.reusedMsa === undefined ? null : over.reusedMsa,
			},
		),
	);

describe("what only the batch's guards checked before", () => {
	it("lets the batch go when the offer is open, the session open, the reused MSA executed and each document in review by this session", () => {
		expect(still()).toEqual({ wrote: {} });
		expect(still({ reusedMsaId: "msa-old", reusedMsa: REUSED })).toEqual({
			wrote: {},
		});
	});

	it("refuses an offer no longer open for signing (A1), as openForSigning decides", () => {
		expect(
			still({ signing: { ...OPEN, software_signing_enabled: 0 } }),
		).toEqual({ refused: "SigningOff" });
		expect(still({ signing: { ...OPEN, status: "superseded" } })).toEqual({
			refused: "OfferUnavailable",
		});
		expect(
			still({ signing: { ...OPEN, request_status: "withdrawn" } }),
		).toEqual({ refused: "OfferUnavailable" });
		expect(
			still({
				signing: { ...OPEN, link_revoked_at: "2026-11-13T11:00:00.000Z" },
			}),
		).toEqual({ refused: "OfferUnavailable" });
		expect(
			still({
				signing: { ...OPEN, recipient_email_snapshot: "other@example.test" },
			}),
		).toEqual({ refused: "OfferUnavailable" });
		expect(still({ signing: null })).toEqual({ refused: "OfferUnavailable" });
		expect(still({ signing: { ...OPEN, project_offer_id: "o1" } })).toEqual({
			refused: "SigningStarted",
		});
	});

	it("refuses a session that expired or was revoked by the signing time (A2)", () => {
		expect(still({ session: { ...SESSION, expires_at: AT } })).toEqual({
			refused: "SessionNotOpen",
		});
		expect(
			still({
				session: { ...SESSION, revoked_at: "2026-11-13T11:59:00.000Z" },
			}),
		).toEqual({ refused: "SessionNotOpen" });
	});

	it("refuses a reused MSA that is not an executed MSA still in force (A8)", () => {
		const refused = { refused: "DocumentsChanged" };

		const reused = (row: ReusedMsaRow | null) =>
			still({ reusedMsaId: "msa-old", reusedMsa: row });

		expect(reused({ ...REUSED, terminated_at: "2026-11-01" })).toEqual(refused);
		expect(reused({ ...REUSED, status: "client_signed" })).toEqual(refused);
		expect(reused({ ...REUSED, status: "abandoned" })).toEqual(refused);
		expect(reused({ ...REUSED, kind: "sow" })).toEqual(refused);
		expect(reused({ ...REUSED, id: "another" })).toEqual(refused);
		expect(reused(null)).toEqual(refused);
		expect(still({ reusedMsaId: "", reusedMsa: null })).toEqual({ wrote: {} });
	});

	it("refuses a document no longer in review, or reviewed by another session (A9)", () => {
		const refused = { refused: "DocumentsChanged" };

		expect(
			still({
				documents: [doc("msa", { status: "client_signed" }), doc("sow")],
			}),
		).toEqual(refused);
		expect(
			still({
				documents: [
					doc("msa", { review_session_hash: OTHER_TOKEN }),
					doc("sow", { review_session_hash: OTHER_TOKEN }),
				],
			}),
		).toEqual(refused);
		expect(
			still({
				documents: [
					doc("msa"),
					doc("sow", { review_session_hash: OTHER_TOKEN }),
				],
			}),
		).toEqual(refused);
	});

	it("refuses in the batch's order: A1, A2, A8, A9", () => {
		const all = {
			signing: { ...OPEN, project_offer_id: "o1" },
			session: { ...SESSION, expires_at: AT },
			reusedMsaId: "msa-old",
			reusedMsa: null,
			documents: [doc("msa", { review_session_hash: OTHER_TOKEN })],
		};

		expect(
			still({
				...all,
				signing: { ...all.signing, software_signing_enabled: 0 },
			}),
		).toEqual({ refused: "SigningOff" });
		expect(still(all)).toEqual({ refused: "SigningStarted" });
		expect(still({ ...all, signing: OPEN })).toEqual({
			refused: "SessionNotOpen",
		});
		expect(still({ ...all, signing: OPEN, session: SESSION })).toEqual({
			refused: "DocumentsChanged",
		});
	});
});

describe("every refusal of this file", () => {
	it("says the sign route's one 409 sentence", () => {
		expect(SIGNING_CHANGED).toBe(
			"The reviewed agreement changed. Reload and review it again.",
		);

		for (const refusal of [
			new DocumentsChanged(),
			new SignedElsewhere(),
			new DetailsChanged(),
			new NameNotPrintable(),
			new EvidenceTooLong(),
			new StoredDataRefused(),
		])
			expect(refusal.say).toBe(SIGNING_CHANGED);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The guards kept in SQL. Today's statements, copied from signAgreements and reusedMsaGuard
// (src/lib/software-agreements.ts, which does not export them), each wrapped by `softwareGuard` as today. The rule
// decides over the rows as read; the guard, bound with what the rule wrote, re-checks them as they are when the batch
// runs. For every way the rows can change between the two, the guard refuses exactly when the rule, deciding over the
// rows as they are then, would not write the same batch.
// ---------------------------------------------------------------------------------------------------------------------

/** A7, signAgreements: the saved draft is the one read. */
const DRAFT_GUARD =
	"SELECT 1 FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=? AND values_json=?";

/** A8, reusedMsaGuard: the MSA the offer reuses is still executed and not terminated. */
const REUSED_MSA_GUARD =
	"SELECT 1 FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL";

/** A9, signAgreements: each document is still in review, with the hash and review session read. */
const DOCUMENT_GUARD =
	"SELECT 1 FROM software_agreements WHERE id=? AND status='review' AND text_sha256=? AND review_session_hash=?";

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS software_agreements; DROP TABLE IF EXISTS software_agreement_drafts;
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
			text_sha256 TEXT NOT NULL, values_json TEXT NOT NULL, review_session_hash TEXT NOT NULL, client_id TEXT NOT NULL,
			terminated_at TEXT);
		CREATE TABLE software_agreement_drafts (offer_id TEXT NOT NULL, recipient_email TEXT NOT NULL,
			values_json TEXT NOT NULL, PRIMARY KEY(offer_id,recipient_email))`,
	);
});

/** Whether a guard refuses: it raises, and the batch rolls back. */
const refuses = (sql: string, values: (string | null)[]) =>
	softwareGuard(db, sql, values)
		.first()
		.then(
			() => false,
			() => true,
		);

const storeDocuments = (rows: readonly SigningDocumentRow[]) => {
	database.exec("DELETE FROM software_agreements");

	for (const row of rows)
		database
			.prepare(
				"INSERT INTO software_agreements(id,kind,status,text_sha256,values_json,review_session_hash,client_id) VALUES (?,?,?,?,?,?,?)",
			)
			.run(
				row.id,
				row.kind,
				row.status,
				row.text_sha256,
				row.values_json,
				row.review_session_hash,
				row.client_id,
			);
};

/** The offer's documents read back, as the store reads them for the rule. */
const readDocuments = (): SigningDocumentRow[] =>
	database
		.prepare(
			"SELECT id,kind,status,text_sha256,values_json,review_session_hash,client_id FROM software_agreements ORDER BY id",
		)
		.all()
		.map((row) => ({
			id: String(row.id),
			kind: row.kind === "msa" ? "msa" : "sow",
			client_id: String(row.client_id),
			status: AGREEMENT_STATUSES.find((s) => s === row.status) ?? "review",
			text_sha256: String(row.text_sha256),
			values_json: String(row.values_json),
			review_session_hash: String(row.review_session_hash),
		}));

/** Whether the rule, deciding over these rows, goes on to the same signing batch: stage 1 signs, and A9 holds. */
function ruleSigns(
	rows: readonly SigningDocumentRow[],
	named: readonly NamedDocument[],
) {
	const first = Effect.runSync(
		Effect.match(documentsToSign.decide({ named }, rows), {
			onFailure: (): DocumentsToSign | null => null,
			onSuccess: (answer): DocumentsToSign | null => answer,
		}),
	);

	if (first === null || first.kind !== "sign") return false;

	return (
		"wrote" in
		still({
			documents: first.documents,
		})
	);
}

/** Every stored state of one document as the batch finds it: each status, the hash read or another, this session or another. */
const states = (kind: "msa" | "sow"): SigningDocumentRow[] =>
	AGREEMENT_STATUSES.flatMap((status) =>
		[kind === "msa" ? MSA_HASH : SOW_HASH, OTHER_HASH].flatMap((text_sha256) =>
			[TOKEN, OTHER_TOKEN].map((review_session_hash) =>
				doc(kind, { status, text_sha256, review_session_hash }),
			),
		),
	);

describe("A9, each document still in review with the hash and review session read", () => {
	it("binds the statuses SIGN leaves, as the copied SQL names them", () => {
		expect(AGREEMENT_MOVES.SIGN).toEqual(["review"]);
	});

	it("refuses exactly when the rule over the rows the batch finds would not sign, for both documents", async () => {
		const read = [doc("msa"), doc("sow")];
		const batch = chosen(read).documents;
		let refused = 0;

		for (const msa of states("msa"))
			for (const sow of states("sow")) {
				storeDocuments([msa, sow]);

				const now = readDocuments();
				let guard = false;

				for (const document of batch)
					guard ||= await refuses(DOCUMENT_GUARD, [
						document.id,
						document.text_sha256,
						TOKEN,
					]);

				if (guard) refused += 1;

				expect(guard, JSON.stringify([msa, sow])).toBe(!ruleSigns(now, BOTH));
			}

		expect(refused).toBe(255);
	});

	it("refuses exactly when the rule would not sign, for the SOW alone", async () => {
		const batch = chosen([doc("sow")], SOW_ONLY).documents;

		for (const sow of states("sow")) {
			storeDocuments([sow]);

			const guard = await refuses(DOCUMENT_GUARD, [
				batch[0].id,
				batch[0].text_sha256,
				TOKEN,
			]);

			expect(guard, JSON.stringify(sow)).toBe(
				!ruleSigns(readDocuments(), SOW_ONLY),
			);
		}
	});
});

describe("A8, the MSA the offer reuses still executed and not terminated", () => {
	const kinds = ["msa", "sow"] as const;

	/** Every row the reused id can name when the batch runs, and none. */
	const rows: (ReusedMsaRow | null)[] = [
		null,
		...kinds.flatMap((kind) =>
			AGREEMENT_STATUSES.flatMap((status: AgreementStatus) =>
				[null, "2026-11-01"].map((terminated_at) => ({
					id: "msa-old",
					kind,
					status,
					terminated_at,
				})),
			),
		),
	];

	const storeReused = (row: ReusedMsaRow | null) => {
		database.exec("DELETE FROM software_agreements");

		if (row !== null)
			database
				.prepare(
					"INSERT INTO software_agreements(id,kind,status,text_sha256,values_json,review_session_hash,client_id,terminated_at) VALUES (?,?,?,?,'{}','r','c',?)",
				)
				.run(row.id, row.kind, row.status, MSA_HASH, row.terminated_at);
	};

	/** The reused MSA read back by its id, as the store reads it for the rule. */
	const readReused = (id: string): ReusedMsaRow | null => {
		const row = database
			.prepare(
				"SELECT id,kind,status,terminated_at FROM software_agreements WHERE id=?",
			)
			.get(id);

		return row === undefined
			? null
			: {
					id: String(row.id),
					kind: row.kind === "msa" ? "msa" : "sow",
					status: AGREEMENT_STATUSES.find((s) => s === row.status) ?? "review",
					terminated_at:
						row.terminated_at === null ? null : String(row.terminated_at),
				};
	};

	it("refuses exactly when the rule refuses over the row the batch finds", async () => {
		const batch = Effect.runSync(
			signDocuments.decide(
				request({
					ids: ids(1),
					named: SOW_ONLY,
					offer: { id: "o1", reused_msa_id: "msa-old" },
				}),
				{ chosen: chosen([doc("sow")], SOW_ONLY), draft: null },
			),
		);

		expect(batch.guards.reusedMsaId).toBe("msa-old");

		let refused = 0;

		for (const row of rows) {
			storeReused(row);

			const guard = await refuses(REUSED_MSA_GUARD, [batch.guards.reusedMsaId]);

			const rule = still({
				reusedMsaId: "msa-old",
				reusedMsa: readReused("msa-old"),
				documents: [doc("sow")],
			});

			if (guard) refused += 1;

			expect(guard, JSON.stringify(row)).toBe("refused" in rule);
		}

		expect(refused).toBe(rows.length - 1);
	});

	it("has no guard and no refusal when the offer reuses no MSA", () => {
		for (const reused_msa_id of [null, ""]) {
			const batch = Effect.runSync(
				signDocuments.decide(request({ offer: { id: "o1", reused_msa_id } }), {
					chosen: chosen([doc("msa"), doc("sow")]),
					draft: null,
				}),
			);

			expect(batch.guards.reusedMsaId).toBeNull();

			for (const row of rows)
				expect(still({ reusedMsaId: reused_msa_id, reusedMsa: row })).toEqual({
					wrote: {},
				});
		}
	});
});

describe("A7, the saved draft is the one read", () => {
	/** A draft that resolves to the client below; the blanked one resolves to it too, with the session's address. */
	const READ = JSON.stringify({ ...DRAFT, notice_email: EMAIL });
	const BLANKED = JSON.stringify({ ...DRAFT, notice_email: "" });
	const DIFFERENT = JSON.stringify({ ...DRAFT, legal_name: "Another LLC" });

	/** What the drafts table can hold when the batch runs. */
	const stored: { offer: string; email: string; values: string }[][] = [
		[],
		[{ offer: "o1", email: EMAIL, values: READ }],
		[{ offer: "o1", email: EMAIL, values: BLANKED }],
		[{ offer: "o1", email: EMAIL, values: DIFFERENT }],
		[{ offer: "o1", email: "other@example.test", values: READ }],
		[{ offer: "o2", email: EMAIL, values: READ }],
	];

	/** CLIENT with the session's address as its notice email. */
	const rows = [
		doc("msa", {
			values_json: valuesJson({ ...CLIENT, notice_email: EMAIL }),
		}),
		doc("sow"),
	];

	/** The drafts the rule may have read: none, or one of the two that resolve to the client. */
	const drafts = [null, READ, BLANKED];

	const storeDrafts = (
		rowsNow: { offer: string; email: string; values: string }[],
	) => {
		database.exec("DELETE FROM software_agreement_drafts");

		for (const row of rowsNow)
			database
				.prepare(
					"INSERT INTO software_agreement_drafts(offer_id,recipient_email,values_json) VALUES (?,?,?)",
				)
				.run(row.offer, row.email, row.values);
	};

	/** The draft read back by the offer and the session's address, as the store reads it for the rule. */
	const readDraft = (): DraftRow | null => {
		const row = database
			.prepare(
				"SELECT values_json FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
			)
			.get("o1", EMAIL);

		return row === undefined ? null : { values_json: String(row.values_json) };
	};

	const decide = (draft: DraftRow | null) =>
		Effect.runSync(
			Effect.match(
				signDocuments.decide(request(), { chosen: chosen(rows), draft }),
				{
					onFailure: () => null,
					onSuccess: (write) => write,
				},
			),
		);

	it("refuses exactly when a draft was read and the rule, over the draft the batch finds, would not write the same guard", async () => {
		let refused = 0;

		for (const values of drafts) {
			const batch = decide(values === null ? null : { values_json: values });

			if (batch === null) throw new Error("the read draft must sign");

			expect(batch.guards.draftValues).toBe(values);

			for (const now of stored) {
				storeDrafts(now);

				const guard =
					batch.guards.draftValues !== null &&
					(await refuses(DRAFT_GUARD, [
						batch.guards.offerId,
						batch.guards.recipient,
						batch.guards.draftValues,
					]));

				const again = decide(readDraft());

				if (guard) refused += 1;

				expect(guard, JSON.stringify({ values, now })).toBe(
					batch.guards.draftValues !== null &&
						again?.guards.draftValues !== batch.guards.draftValues,
				);
			}
		}

		expect(refused).toBe(10);
	});
});
