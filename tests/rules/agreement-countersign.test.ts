import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateAgreementCharacters } from "../../src/lib/agreement-templates";
import { countersignAgreements } from "../../src/lib/software-agreements";
import type { SoftwareOffer } from "../../src/lib/software-offers";
import { softwareGuard } from "../../src/lib/software-guard";
import {
	CHANGED_OR_FAILED,
	type CountersignFacts,
	type CountersignRequest,
	type CountersignStamp,
	countersign,
	countersignFront,
	countersignPending,
	type OfferAgreementRow,
	type SentOfferRow,
} from "../../src/server/rules/agreement-countersign";
import type { Refusal } from "../../src/server/terms";
import {
	type BoundStatement,
	boundStatement,
	fakeBatch,
	preparedStatement,
} from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The owner's countersignature as stories, stage by stage in the route's order: the offer and the setting, the pending
// documents, then the snapshot, the name, the evidence, the SOW and the client's address, and the exact values the batch
// writes. Then today's `countersignAgreements` runs beside the rule over the same facts, and the two guards that re-check it
// at write time (A10 and A11) run on sqlite against the rule.

const said = <W, E extends Refusal>(decided: Effect.Effect<W, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

const MSA = "11111111-1111-4111-8111-111111111111";
const SOW = "22222222-2222-4222-8222-222222222222";
const MSA_HASH = "a".repeat(64);
const SOW_HASH = "b".repeat(64);
const AT = "2026-11-23T15:00:00.000Z";
const RECEIPT = "33333333-3333-4333-8333-333333333333";

const CONTRACTOR = {
	legal_name: "The Superhuman Group LLC",
	entity_jurisdiction: "Wyoming LLC",
	signer_name: "Kazon Wilson",
	signer_title: "Founder",
	notice_email: "owner@example.test",
	business_address: "A registered agent address",
	registered_agent_confirmed: true,
};

const offer = (over: Partial<SentOfferRow> = {}): SentOfferRow => ({
	id: "o1",
	request_id: "r1",
	contractor_snapshot_json: JSON.stringify({
		...CONTRACTOR,
		config_version: 1,
	}),
	recipient_email_snapshot: "client@example.test",
	reused_msa_id: null,
	...over,
});

const agreement = (
	kind: "msa" | "sow",
	status = "client_signed",
	over: Partial<OfferAgreementRow> = {},
): OfferAgreementRow => ({
	id: kind === "msa" ? MSA : SOW,
	kind,
	status,
	text_sha256: kind === "msa" ? MSA_HASH : SOW_HASH,
	...over,
});

const BOTH = [
	{ id: MSA, hash: MSA_HASH },
	{ id: SOW, hash: SOW_HASH },
];

const SOW_ONLY = [{ id: SOW, hash: SOW_HASH }];

const facts = (over: Partial<CountersignFacts> = {}): CountersignFacts => ({
	offer: offer(),
	signingEnabled: 1,
	agreements: [agreement("msa"), agreement("sow")],
	...over,
});

const request = (
	over: Partial<CountersignRequest & CountersignStamp> = {},
): CountersignRequest & CountersignStamp => ({
	documents: BOTH,
	typedName: "Kazon Wilson",
	actor: "Owner@Example.TEST",
	ip: "203.0.113.7",
	userAgent: "Mozilla/5.0",
	at: AT,
	receiptId: RECEIPT,
	...over,
});

const changed = (refused: string) => ({ refused, say: CHANGED_OR_FAILED });

const OFFER_CHANGED = {
	refused: "OfferChanged",
	say: "Signing is off or the offer changed.",
};

describe("the front: a sent offer with signing on", () => {
	const front = (over: Partial<CountersignFacts>) =>
		said(countersignFront.decide(null, facts(over)));

	it("goes on with a sent offer and signing on", () => {
		expect(front({})).toEqual({ wrote: {} });
	});

	it("is refused with its own sentence when the request has no sent offer, whatever the setting", () => {
		expect(front({ offer: null })).toEqual(OFFER_CHANGED);
		expect(front({ offer: null, signingEnabled: null })).toEqual(OFFER_CHANGED);
	});

	it("is refused when signing is off or its row is missing", () => {
		expect(front({ signingEnabled: 0 })).toEqual(OFFER_CHANGED);
		expect(front({ signingEnabled: null })).toEqual(OFFER_CHANGED);
	});
});

describe("the pending documents", () => {
	const pending = (
		agreements: OfferAgreementRow[],
		documents = BOTH,
		over: Partial<CountersignFacts> = {},
	) =>
		said(
			countersignPending.decide({ documents }, facts({ agreements, ...over })),
		);

	const both = [agreement("msa"), agreement("sow")];

	it("goes on when the client-signed documents are the ones named, in either order", () => {
		expect(pending(both)).toEqual({ wrote: {} });
		expect(pending(both, [...BOTH].reverse())).toEqual({ wrote: {} });
		expect(pending([agreement("sow")], SOW_ONLY)).toEqual({ wrote: {} });
	});

	it("leaves out abandoned and other documents that are not client-signed", () => {
		expect(
			pending(
				[
					agreement("msa", "abandoned", { id: "x" }),
					agreement("msa"),
					agreement("sow"),
				],
				BOTH,
			),
		).toEqual({ wrote: {} });
		expect(
			pending([agreement("msa", "executed"), agreement("sow")], SOW_ONLY),
		).toEqual({ wrote: {} });
	});

	it("is refused with the generic sentence when nothing is client-signed", () => {
		expect(pending([])).toEqual(changed("PendingChanged"));
		expect(
			pending([agreement("msa", "review"), agreement("sow", "review")]),
		).toEqual(changed("PendingChanged"));
		expect(
			pending([agreement("msa", "executed"), agreement("sow", "executed")]),
		).toEqual(changed("PendingChanged"));
		expect(
			pending([agreement("msa", "abandoned"), agreement("sow", "abandoned")]),
		).toEqual(changed("PendingChanged"));
	});

	it("is refused when the documents named differ in id, hash or number", () => {
		expect(pending(both, SOW_ONLY)).toEqual(changed("PendingChanged"));
		expect(pending(both, [BOTH[0]])).toEqual(changed("PendingChanged"));
		expect(pending(both, [BOTH[0], { id: SOW, hash: MSA_HASH }])).toEqual(
			changed("PendingChanged"),
		);
		expect(pending(both, [...BOTH, { id: "x", hash: MSA_HASH }])).toEqual(
			changed("PendingChanged"),
		);
		expect(pending(both, [BOTH[1], BOTH[1]])).toEqual(
			changed("PendingChanged"),
		);
		expect(
			pending([agreement("msa", "review"), agreement("sow")], BOTH),
		).toEqual(changed("PendingChanged"));
	});

	it("answers the offer's refusal first", () => {
		expect(pending([], BOTH, { offer: null })).toEqual(OFFER_CHANGED);
		expect(pending([], BOTH, { signingEnabled: 0 })).toEqual(OFFER_CHANGED);
	});
});

const decide = (
	over: Partial<CountersignRequest & CountersignStamp> = {},
	overFacts: Partial<CountersignFacts> = {},
) => said(countersign.decide(request(over), facts(overFacts)));

const snapshot = (value: string | null) => ({
	offer: offer({ contractor_snapshot_json: value }),
});

describe("the countersignature's values", () => {
	const signature = (
		id: string,
		hash: string,
		intent: string,
		documents: string,
	) => ({
		agreement_id: id,
		party: "contractor",
		typed_name: "Kazon Wilson",
		title: "Founder",
		consent_text:
			"I agree to sign and receive these documents electronically, and I’m authorized to sign for The Superhuman Group LLC.",
		consent_at: AT,
		signed_at: AT,
		document_sha256: hash,
		session_token_hash: null,
		owner_subject: "Owner@Example.TEST",
		verified_email: "owner@example.test",
		verified_at: AT,
		verification_method: "verified by owner authentication",
		intent_text: intent,
		document_list_json: documents,
		receipt_id: RECEIPT,
		ip_address: "203.0.113.7",
		user_agent: "Mozilla/5.0",
	});

	const LIST = JSON.stringify(BOTH);

	const BOTH_INTENT =
		"Countersigning applies your name above as your electronic signature on the agreement and statement of work you reviewed.";

	it("signs each pending document in the order read, then a packet per document and the SOW's two copies", () => {
		expect(decide({ documents: [...BOTH].reverse() })).toEqual({
			wrote: {
				offerId: "o1",
				reusedMsaId: null,
				at: AT,
				actor: "Owner@Example.TEST",
				documents: [
					{
						id: MSA,
						hash: MSA_HASH,
						signature: signature(MSA, MSA_HASH, BOTH_INTENT, LIST),
					},
					{
						id: SOW,
						hash: SOW_HASH,
						signature: signature(SOW, SOW_HASH, BOTH_INTENT, LIST),
					},
				],
				packets: [MSA, SOW],
				copies: [
					{
						agreement_id: SOW,
						recipient_role: "client",
						email: "client@example.test",
					},
					{
						agreement_id: SOW,
						recipient_role: "contractor",
						email: "owner@example.test",
					},
				],
				sowId: SOW,
			},
		});
	});

	it("signs the SOW alone, with its own intent, when the offer reuses an MSA", () => {
		const answer = decide(
			{ documents: SOW_ONLY },
			{
				offer: offer({ reused_msa_id: "m0" }),
				agreements: [agreement("sow")],
			},
		);

		expect(answer).toMatchObject({
			wrote: {
				reusedMsaId: "m0",
				documents: [
					{
						id: SOW,
						signature: signature(
							SOW,
							SOW_HASH,
							"Countersigning applies your name above as your electronic signature on the statement of work you reviewed.",
							JSON.stringify(SOW_ONLY),
						),
					},
				],
				packets: [SOW],
			},
		});
	});

	it("reads an empty reused MSA id as none, as today's guard list did (it tests the id's truth)", () => {
		expect(decide({}, { offer: offer({ reused_msa_id: "" }) })).toMatchObject({
			wrote: { reusedMsaId: null },
		});
	});

	it("records missing headers as empty evidence", () => {
		expect(decide({ ip: null, userAgent: null })).toMatchObject({
			wrote: {
				documents: [
					{ signature: { ip_address: "", user_agent: "" } },
					{ signature: { ip_address: "", user_agent: "" } },
				],
			},
		});
	});

	it("reads the snapshot without its config version, with its notice email lower-cased", () => {
		expect(
			decide(
				{},
				snapshot(
					JSON.stringify({
						...CONTRACTOR,
						config_version: 7,
						notice_email: "NOTICE@EXAMPLE.TEST",
					}),
				),
			),
		).toMatchObject({
			wrote: {
				copies: [
					{ recipient_role: "client" },
					{ recipient_role: "contractor", email: "notice@example.test" },
				],
			},
		});
		expect(decide({}, snapshot(JSON.stringify(CONTRACTOR)))).toMatchObject({
			wrote: { sowId: SOW },
		});
	});

	it("sends the client's copy to an empty snapshot address, which only a missing one stops", () => {
		expect(
			decide({}, { offer: offer({ recipient_email_snapshot: "" }) }),
		).toMatchObject({
			wrote: { copies: [{ recipient_role: "client", email: "" }, {}] },
		});
	});
});

describe("the stored contractor snapshot", () => {
	it("refuses the five stored values today's code cannot read", () => {
		for (const value of [
			null,
			"{bad",
			"{}",
			JSON.stringify({ ...CONTRACTOR, config_version: 2, extra: "x" }),
			JSON.stringify({ ...CONTRACTOR, registered_agent_confirmed: false }),
		])
			expect(decide({}, snapshot(value)), String(value)).toEqual(
				changed("StoredDataRefused"),
			);
	});

	it("refuses JSON that is not the contractor's details: null, a number, a string, an array", () => {
		for (const value of ["null", "7", '"text"', "[1,2]", "true"])
			expect(decide({}, snapshot(value)), value).toEqual(
				changed("StoredDataRefused"),
			);
	});
});

describe("the typed name and the contractor's title", () => {
	const names = [
		"Kazon Wilson",
		"kazon wilson",
		"Kazön Wílson",
		"Казон Вилсон",
		"威尔逊",
		"Kazon 🙂 Wilson",
		`Kazon <b>"Wilson" & 'Co'</b>`,
		"Kazon‍Wilson",
		"Kazon‏Wilson",
		"Kazon\u0007Wilson",
		"Kazon\nWilson",
		"Kazon\tWilson",
		"Kazon\ud800Wilson",
		"K",
	];

	const titles = ["Founder", "总裁", "Café Owner"];

	it("refuses exactly what today's character check refuses, for the name and the title together", () => {
		let refused = 0;

		for (const typedName of names)
			for (const title of titles) {
				let throws = false;

				try {
					validateAgreementCharacters(typedName + title);
				} catch {
					throws = true;
				}

				const answer = decide(
					{ typedName },
					snapshot(JSON.stringify({ ...CONTRACTOR, signer_title: title })),
				);

				if (throws) refused += 1;
				expect("refused" in answer, `${typedName} / ${title}`).toBe(throws);

				if (throws) expect(answer).toEqual(changed("NameNotPrintable"));
			}

		expect(refused).toBeGreaterThan(0);
	});

	it("refuses the golden corpus's unprintable names and title", () => {
		for (const typedName of [
			"威尔逊",
			"Kazon 🙂 Wilson",
			"Kazon‍Wilson",
			"Kazon‏Wilson",
		])
			expect(decide({ typedName }), typedName).toEqual(
				changed("NameNotPrintable"),
			);
		expect(
			decide(
				{},
				snapshot(JSON.stringify({ ...CONTRACTOR, signer_title: "总裁" })),
			),
		).toEqual(changed("NameNotPrintable"));
	});
});

describe("the browser evidence", () => {
	it("allows an address of 100 characters and a user agent of 2,000", () => {
		expect(
			decide({ ip: "1".repeat(100), userAgent: "u".repeat(2000) }),
		).toHaveProperty("wrote");
	});

	it("refuses an address of 101 characters, a user agent of 2,001, and a control character in either", () => {
		expect(decide({ ip: "1".repeat(101) })).toEqual(changed("EvidenceTooLong"));
		expect(decide({ userAgent: "u".repeat(2001) })).toEqual(
			changed("EvidenceTooLong"),
		);
		expect(decide({ userAgent: "Mozilla\u0001" })).toEqual(
			changed("EvidenceTooLong"),
		);
		expect(decide({ ip: "203.0.113.7\u007f" })).toEqual(
			changed("EvidenceTooLong"),
		);
	});
});

describe("the SOW and the client's address", () => {
	it("refuses a pending MSA without its SOW as changed pending documents (today a TypeError)", () => {
		expect(
			decide(
				{ documents: [BOTH[0]] },
				{ agreements: [agreement("msa"), agreement("sow", "review")] },
			),
		).toEqual(changed("PendingChanged"));
	});

	it("refuses an offer with no client email snapshot (today the copy row's NOT NULL)", () => {
		expect(
			decide({}, { offer: offer({ recipient_email_snapshot: null }) }),
		).toEqual(changed("RecipientMissing"));
	});
});

describe("the order of the refusals, when several hold", () => {
	const msaAlone = {
		documents: [BOTH[0]],
	};

	const msaAloneFacts = {
		agreements: [agreement("msa"), agreement("sow", "review")],
	};

	it("answers the offer before the documents", () => {
		expect(
			decide({ documents: SOW_ONLY }, { offer: null, agreements: [] }),
		).toEqual(OFFER_CHANGED);
	});

	it("answers the documents before the snapshot", () => {
		expect(decide({ documents: SOW_ONLY }, snapshot(null))).toEqual(
			changed("PendingChanged"),
		);
	});

	it("answers the snapshot before the name, the name before the evidence", () => {
		expect(decide({ typedName: "威尔逊" }, snapshot("{}"))).toEqual(
			changed("StoredDataRefused"),
		);
		expect(decide({ typedName: "威尔逊", ip: "1".repeat(101) })).toEqual(
			changed("NameNotPrintable"),
		);
	});

	it("answers the evidence before a missing SOW, and a missing SOW before a missing address", () => {
		expect(decide({ ...msaAlone, ip: "1".repeat(101) }, msaAloneFacts)).toEqual(
			changed("EvidenceTooLong"),
		);
		expect(
			decide(msaAlone, {
				...msaAloneFacts,
				offer: offer({ recipient_email_snapshot: null }),
			}),
		).toEqual(changed("PendingChanged"));
		expect(
			decide(
				{ ip: "1".repeat(101) },
				{ offer: offer({ recipient_email_snapshot: null }) },
			),
		).toEqual(changed("EvidenceTooLong"));
	});
});

// ---- today's countersignAgreements, beside the rule ----

/**
 * What today's `countersignAgreements` does with the facts: whether it throws (a refusal the route answers with its
 * generic 409, a NOT NULL failure of the copy row included), or the batch it hands the database, read back into the
 * rule's words. Its reads answer the offer's documents that are not abandoned, as `offerAgreements` selects them; the
 * clock is frozen at AT and the ids it draws are counted, so its receipt is the first id.
 */
async function today(
	command: CountersignRequest,
	given: CountersignFacts,
): Promise<{ threw: true } | { threw: false; wrote: unknown }> {
	let batch: BoundStatement[] = [];
	let drawn = 0;

	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(AT));

	vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
		drawn += 1;

		return `00000000-0000-4000-8000-${String(drawn).padStart(12, "0")}`;
	});

	const db = double<D1Database>({
		prepare: (query: string) =>
			preparedStatement(query, [], () => ({
				all: async <T>() =>
					partial<D1Result<T>>({
						// SAFETY: the one read is offerAgreements', whose rows the test supplies as the rule's facts.
						results: given.agreements.filter(
							(row) => row.status !== "abandoned",
						) as T[],
					}),
			})),
		batch: fakeBatch((statements) => {
			batch = statements.map(boundStatement);

			return [];
		}),
	});

	const headers = new Headers();

	if (command.ip !== null) headers.set("cf-connecting-ip", command.ip);

	if (command.userAgent !== null) headers.set("user-agent", command.userAgent);

	try {
		await countersignAgreements(
			db,
			partial<SoftwareOffer>({ ...given.offer }),
			[...command.documents],
			command.typedName,
			command.actor,
			new Request("https://example.test/", { headers }),
		);
	} catch {
		return { threw: true };
	}

	const copies = batch.filter((statement) =>
		statement.query.startsWith("INSERT INTO software_agreement_deliveries"),
	);

	// The copy row's email is NOT NULL: the database refuses the batch, which the route answers as a refusal.
	if (copies.some((copy) => copy.args[2] === null)) return { threw: true };

	const signatures = batch.filter((statement) =>
		statement.query.startsWith("INSERT INTO software_agreement_signatures"),
	);

	const guards = batch.filter((statement) =>
		statement.query.startsWith("SELECT CASE WHEN EXISTS("),
	);

	return {
		threw: false,
		wrote: {
			offerId: guards[0]?.args[0],
			reusedMsaId: guards.some((guard) => guard.query.includes("kind='msa'"))
				? guards[1]?.args[0]
				: null,
			documents: signatures.map((statement) => {
				const [, agreementId, party, typed, title, consent, consentAt] =
					statement.args;

				const [signedAt, hash, session, owner, email, verifiedAt] =
					statement.args.slice(7, 13);

				const [method, intent, list, receipt, ip, ua] =
					statement.args.slice(13);

				return {
					id: agreementId,
					hash,
					signature: {
						agreement_id: agreementId,
						party,
						typed_name: typed,
						title,
						consent_text: consent,
						consent_at: consentAt,
						signed_at: signedAt,
						document_sha256: hash,
						session_token_hash: session,
						owner_subject: owner,
						verified_email: email,
						verified_at: verifiedAt,
						verification_method: method,
						intent_text: intent,
						document_list_json: list,
						receipt_id: receipt,
						ip_address: ip,
						user_agent: ua,
					},
				};
			}),
			packets: batch
				.filter((statement) =>
					statement.query.startsWith(
						"INSERT INTO software_agreement_artifacts",
					),
				)
				.map((statement) => statement.args[0]),
			copies: copies.map(({ args: [agreementId, role, email] }) => ({
				agreement_id: agreementId,
				recipient_role: role,
				email,
			})),
		},
	};
}

describe("today's countersignAgreements and the rule", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	const variants: [
		string,
		Partial<CountersignRequest>,
		Partial<CountersignFacts>,
	][] = [
		["both documents", {}, {}],
		[
			"both documents named the other way",
			{ documents: [...BOTH].reverse() },
			{},
		],
		[
			"the SOW alone with a reused MSA",
			{ documents: SOW_ONLY },
			{
				offer: offer({ reused_msa_id: "m0" }),
				agreements: [agreement("sow")],
			},
		],
		["an empty reused MSA id", {}, { offer: offer({ reused_msa_id: "" }) }],
		["no headers", { ip: null, userAgent: null }, {}],
		["an address of 100 characters", { ip: "1".repeat(100) }, {}],
		["an address of 101 characters", { ip: "1".repeat(101) }, {}],
		["a user agent of 2,001 characters", { userAgent: "u".repeat(2001) }, {}],
		["a tab in the user agent", { userAgent: "Mozilla\t5.0" }, {}],
		["a typed name in Chinese", { typedName: "威尔逊" }, {}],
		["a typed name with an emoji", { typedName: "Kazon 🙂 Wilson" }, {}],
		["a typed name in Cyrillic", { typedName: "Казон Вилсон" }, {}],
		["a typed name with accents", { typedName: "Kazön Wílson" }, {}],
		[
			"no client email snapshot",
			{},
			{ offer: offer({ recipient_email_snapshot: null }) },
		],
		[
			"an empty client email snapshot",
			{},
			{ offer: offer({ recipient_email_snapshot: "" }) },
		],
		["no contractor snapshot", {}, snapshot(null)],
		["a snapshot that is not JSON", {}, snapshot("{bad")],
		["an empty snapshot", {}, snapshot("{}")],
		["a snapshot of null", {}, snapshot("null")],
		["a snapshot that is a number", {}, snapshot("7")],
		[
			"a snapshot with an extra field",
			{},
			snapshot(JSON.stringify({ ...CONTRACTOR, extra: "x" })),
		],
		[
			"a snapshot that did not confirm the registered agent",
			{},
			snapshot(
				JSON.stringify({ ...CONTRACTOR, registered_agent_confirmed: false }),
			),
		],
		[
			"a title the fonts cannot print",
			{},
			snapshot(JSON.stringify({ ...CONTRACTOR, signer_title: "总裁" })),
		],
		[
			"a notice email in capitals",
			{},
			snapshot(
				JSON.stringify({ ...CONTRACTOR, notice_email: "NOTICE@EXAMPLE.TEST" }),
			),
		],
		["only the SOW named while both are pending", { documents: SOW_ONLY }, {}],
		["a wrong hash", { documents: [BOTH[0], { id: SOW, hash: MSA_HASH }] }, {}],
		["the same document twice", { documents: [BOTH[1], BOTH[1]] }, {}],
		[
			"nothing client-signed",
			{},
			{ agreements: [agreement("msa", "review"), agreement("sow", "review")] },
		],
		[
			"an abandoned MSA beside the pending pair",
			{},
			{
				agreements: [
					agreement("msa", "abandoned", { id: "x" }),
					agreement("msa"),
					agreement("sow"),
				],
			},
		],
		[
			"the MSA alone pending and named",
			{ documents: [BOTH[0]] },
			{ agreements: [agreement("msa"), agreement("sow", "review")] },
		],
		[
			"the MSA alone pending, named, with an unprintable name",
			{ documents: [BOTH[0]], typedName: "威尔逊" },
			{ agreements: [agreement("msa"), agreement("sow", "review")] },
		],
	];

	it.each(variants)("agree: %s", async (_name, over, overFacts) => {
		const command = request(over);
		const given = facts(overFacts);
		const before = await today(command, given);

		const rule = said(
			countersign.decide(
				{ ...command, receiptId: "00000000-0000-4000-8000-000000000001" },
				given,
			),
		);

		if (before.threw) {
			expect(rule).toHaveProperty("say", CHANGED_OR_FAILED);

			return;
		}

		expect(rule).toHaveProperty("wrote");
		expect(rule).toMatchObject({ wrote: before.wrote });
	});
});

// ---- the guards that re-check it, on sqlite ----

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS owner_requests; DROP TABLE IF EXISTS software_offers;
		DROP TABLE IF EXISTS software_signing_settings; DROP TABLE IF EXISTS software_agreements;
		CREATE TABLE owner_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL);
		CREATE TABLE software_offers (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL,
			contractor_snapshot_json TEXT, recipient_email_snapshot TEXT, reused_msa_id TEXT);
		CREATE TABLE software_signing_settings (id INTEGER PRIMARY KEY, software_signing_enabled INTEGER NOT NULL);
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, offer_id TEXT, request_id TEXT NOT NULL, kind TEXT NOT NULL,
			status TEXT NOT NULL, text_sha256 TEXT NOT NULL)`,
	);
});

/** Whether a guard refuses: it raises, and its batch rolls back. */
const refuses = (guard: D1PreparedStatement) =>
	guard.first().then(
		() => false,
		() => true,
	);

/** A10, copied from `countersignAgreements` (src/lib/software-agreements.ts), which does not export it. */
const A10 =
	"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND r.status NOT IN ('withdrawn','resolved') AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)";

/** A11 for countersign, copied from the same function. */
const A11 =
	"SELECT 1 FROM software_agreements WHERE id=? AND status='client_signed' AND text_sha256=?";

const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"] as const;
const REQUEST_STATUSES = ["new", "reviewed", "resolved", "withdrawn"] as const;

const AGREEMENT_STATUSES = [
	"review",
	"client_signed",
	"executed",
	"abandoned",
] as const;

describe("A10 and the offer's refusal", () => {
	it("refuses exactly when the rule does, for every offer status and setting, while the request is open", async () => {
		let checked = 0;

		for (const offerStatus of OFFER_STATUSES)
			for (const requestStatus of REQUEST_STATUSES)
				for (const setting of [1, 0, null]) {
					database.exec(
						"DELETE FROM owner_requests; DELETE FROM software_offers; DELETE FROM software_signing_settings",
					);
					database
						.prepare("INSERT INTO owner_requests VALUES (?,?)")
						.run("r1", requestStatus);
					database
						.prepare(
							"INSERT INTO software_offers(id,request_id,status) VALUES (?,?,?)",
						)
						.run("o1", "r1", offerStatus);

					if (setting !== null)
						database
							.prepare("INSERT INTO software_signing_settings VALUES (1,?)")
							.run(setting);

					// Read as the route reads them: the request's sent offer, then the setting.
					const sent = await db
						.prepare(
							"SELECT * FROM software_offers WHERE request_id=? AND status='sent'",
						)
						.bind("r1")
						.first<SentOfferRow>();

					const row = await db
						.prepare(
							"SELECT software_signing_enabled FROM software_signing_settings WHERE id=1",
						)
						.first<{ software_signing_enabled: number }>();

					const rule = said(
						countersignFront.decide(null, {
							offer: sent,
							signingEnabled: row?.software_signing_enabled ?? null,
						}),
					);

					const guard = await refuses(softwareGuard(db, A10, ["o1"]));
					const label = `${offerStatus} ${requestStatus} ${setting}`;

					if (requestStatus === "resolved" || requestStatus === "withdrawn")
						// Only A10 checks the request's status today, and the plan does not read it first: the guard refuses
						// whatever the rule says, and the route answers it as a refused guard, with the generic 409.
						expect(guard, label).toBe(true);
					else {
						expect(guard, label).toBe("refused" in rule);
						checked += 1;
					}
				}

		expect(checked).toBe(24);
	});
});

describe("A11 and the pending documents", () => {
	/** Stores the offer's documents as they are at the batch, read with the hashes `hashes` (the hash read, else another). */
	async function atTheBatch(
		documents: { kind: "msa" | "sow"; status: string; sameHash: boolean }[],
		named: { id: string; hash: string }[],
	) {
		database.exec("DELETE FROM software_agreements");

		for (const document of documents) {
			const row = agreement(document.kind);

			database
				.prepare(
					"INSERT INTO software_agreements(id,offer_id,request_id,kind,status,text_sha256) VALUES (?,?,?,?,?,?)",
				)
				.run(
					row.id,
					"o1",
					"r1",
					row.kind,
					document.status,
					document.sameHash ? row.text_sha256 : "e".repeat(64),
				);
		}

		const agreements = (
			await db
				.prepare(
					"SELECT id,kind,status,text_sha256 FROM software_agreements WHERE offer_id=? ORDER BY kind",
				)
				.bind("o1")
				.all<OfferAgreementRow>()
		).results;

		const rule = said(
			countersignPending.decide({ documents: named }, facts({ agreements })),
		);

		// Today the guard is built from each pending document as read, which the check made the documents named.
		const guards = await Promise.all(
			named.map((document) =>
				refuses(softwareGuard(db, A11, [document.id, document.hash])),
			),
		);

		return { rule: "refused" in rule, guard: guards.some(Boolean) };
	}

	it("refuses exactly when the rule, deciding on the rows as they are at the batch, does: both documents", async () => {
		let refused = 0;

		for (const msa of AGREEMENT_STATUSES)
			for (const sow of AGREEMENT_STATUSES)
				for (const [msaHash, sowHash] of [
					[true, true],
					[false, true],
					[true, false],
				]) {
					const { rule, guard } = await atTheBatch(
						[
							{ kind: "msa", status: msa, sameHash: msaHash },
							{ kind: "sow", status: sow, sameHash: sowHash },
						],
						BOTH,
					);

					if (guard) refused += 1;
					expect(guard, `${msa} ${sow} ${msaHash} ${sowHash}`).toBe(rule);
				}

		expect(refused).toBe(47);
	});

	it("refuses exactly when the rule does: the SOW alone, for an offer that reuses an MSA", async () => {
		for (const sow of AGREEMENT_STATUSES)
			for (const sameHash of [true, false]) {
				const { rule, guard } = await atTheBatch(
					[{ kind: "sow", status: sow, sameHash }],
					SOW_ONLY,
				);

				expect(guard, `${sow} ${sameHash}`).toBe(rule);
			}
	});
});
