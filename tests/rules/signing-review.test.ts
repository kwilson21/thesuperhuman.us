import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { agreementValues } from "../../src/lib/agreement-fields";
import {
	type AgreementTemplate,
	renderAgreement,
	templateFields,
} from "../../src/lib/agreement-templates";
import type { RawValue } from "../../src/lib/fields";
import { legalNameKey } from "../../src/lib/software-agreements";
import type { OfferTerms } from "../../src/lib/software-offers";
import {
	clientChangedElsewhere,
	type OfferAgreementRow,
	type PartyRequest,
	type PendingMsaRow,
	type ReusedMsaRow,
	type ReviewOffer,
	type ReviewParty,
	type ReviewStored,
	type ReviewTemplates,
	type ReviewTexts,
	type ReviewWrite,
	reviewDocument,
	reviewDocuments,
	reviewExisting,
	reviewParty,
	reviewPendingMsa,
	reviewStored,
	reviewTemplates,
	reviewTexts,
	type StoredText,
} from "../../src/server/rules/signing-review";
import {
	type Answer,
	agreementDetails,
	contractorValues,
	offerTerms,
	run,
	wrote,
} from "../helpers/offer-rules";

// The client's review as stories (docs/plans/2026-11-signing-conversion.md, sections 2 and 3, "review"): the document a
// review session may read, then the review's stages in the route's order, each refusal with today's sentence, the values
// written, and the re-decision after the two UNIQUE failures that back a fact (B7). The SQL each decision replaces or is
// re-checked by, and today's `reviewAgreements` itself, are held to these rules in signing-review-sql.test.ts.

const EMAIL = "client@example.com";

const SESSION = {
	token_hash: "s".repeat(64),
	link_hash: "l".repeat(64),
	recipient_email: EMAIL,
};

/** The client's details as `resolveClientDetails` resolves them. */
const CLIENT = {
	legal_name: "Sample LLC",
	entity_type: "LLC",
	jurisdiction: "Wyoming",
	business_address: "100 Example Street",
	notice_email: "notices@example.com",
	reviewer_name: "Reviewer",
	reviewer_email: "reviewer@example.com",
	approver_name: "Approver",
	approver_email: "approver@example.com",
	signer_name: "Example Signer",
	signer_title: "Representative",
	portfolio: "deny",
	naming: false,
};

const STORED: StoredText = {
	terms_json: JSON.stringify(offerTerms),
	agreement_details_json: JSON.stringify(agreementDetails),
	contractor_snapshot_json: JSON.stringify({
		...contractorValues,
		config_version: 3,
	}),
};

const OFFER: ReviewOffer = {
	id: "o1",
	request_id: "r1",
	version: 2,
	...STORED,
	reused_msa_id: null,
	msa_template_id: "t-msa",
	sow_template_id: "t-sow",
};

/** A template that names every field it must, one per line, as the template code's own tests build one. */
const fieldsOf = (kind: "msa" | "sow") =>
	templateFields[kind]
		.filter((field) => !field.startsWith("milestone."))
		.map((field) => `${field}: {{${field}}}`)
		.join("\n") +
	(kind === "sow"
		? `\n{{#milestones}}\n${templateFields.sow
				.filter((field) => field.startsWith("milestone."))
				.map((field) => `${field}: {{${field}}}`)
				.join("\n")}\n{{/milestones}}`
		: "");

const template = (
	kind: "msa" | "sow",
	over: Partial<AgreementTemplate> = {},
): AgreementTemplate => ({
	id: `t-${kind}`,
	kind,
	version: 2,
	text: fieldsOf(kind),
	sha256: "f".repeat(64),
	version_label: `${kind}-v2`,
	source_revision: `${kind}-rev`,
	published_at: "2026-11-01T00:00:00.000Z",
	...over,
});

const TEMPLATES: ReviewTemplates = {
	msa: template("msa"),
	sow: template("sow"),
};

const AT = "2026-11-14T03:30:00.000Z";

/** New York's date at AT, the evening before. */
const EFFECTIVE_ON = "2026-11-13";

const stored = (client: RawValue = CLIENT, over: Partial<StoredText> = {}) =>
	reviewStored.decide(
		{ client, session: { recipient_email: EMAIL } },
		{ ...STORED, ...over },
	);

const STORED_READ: ReviewStored = wrote(run(stored()));

const agreement = (over: Partial<OfferAgreementRow>): OfferAgreementRow => ({
	id: "a1",
	kind: "sow",
	status: "review",
	client_id: "c1",
	canonical_text: "SOW text",
	review_session_hash: SESSION.token_hash,
	...over,
});

const reusedMsa = (over: Partial<ReusedMsaRow> = {}): ReusedMsaRow => ({
	id: "m1",
	kind: "msa",
	status: "executed",
	client_id: "c1",
	template_id: "t-msa-old",
	terminated_at: null,
	archive_closed_at: null,
	effective_on: "2026-10-02",
	canonical_text: "The executed MSA",
	text_sha256: "e".repeat(64),
	artifact_status: "ready",
	...over,
});

const party = (over: Partial<ReviewParty> = {}): ReviewParty => ({
	clientId: "c1",
	earlierClientId: null,
	reused: null,
	msaTemplateId: "t-msa",
	...over,
});

const texts = (
	over: {
		party?: ReviewParty;
		templates?: ReviewTemplates;
		stored?: ReviewStored;
	} = {},
) =>
	reviewTexts.decide(
		{
			offer: { version: 2 },
			stored: over.stored ?? STORED_READ,
			party: over.party ?? party(),
			templates: over.templates ?? TEMPLATES,
			msaId: over.party?.reused ? null : "a-msa",
			sowId: "a-sow",
			effectiveOn: EFFECTIVE_ON,
		},
		null,
	);

/** The refusal's name and sentence, or "writes". */
const said = <W>(answer: Answer<W>) =>
	"refused" in answer ? `${answer.refused}: ${answer.refusal.say}` : "writes";

/** What the rule threw while it read, as a route's `runRoute` would catch it: the defect itself. */
const defectOf = <A, E>(decide: () => Effect.Effect<A, E>) =>
	Effect.runSync(
		Effect.suspend(decide).pipe(
			Effect.match({ onFailure: () => null, onSuccess: () => null }),
			Effect.catchDefect((defect) => Effect.succeed(defect)),
		),
	);

describe("the document a review session reads (the GET)", () => {
	const rows = [
		agreement({ id: "a-msa", kind: "msa", canonical_text: "MSA text" }),
		agreement({ id: "a-sow", kind: "sow", canonical_text: "SOW text" }),
	];

	const read = (
		documentId: string | null,
		facts: readonly OfferAgreementRow[] = rows,
		sessionTokenHash = SESSION.token_hash,
	) => run(reviewDocument.decide({ documentId, sessionTokenHash }, facts));

	it("answers the kind and text of the document asked for", () => {
		expect(wrote(read("a-msa"))).toEqual({ kind: "msa", text: "MSA text" });
		expect(wrote(read("a-sow"))).toEqual({ kind: "sow", text: "SOW text" });
	});

	it("answers a signed or executed document as well, as today", () => {
		for (const status of ["client_signed", "executed"])
			expect(
				wrote(read("a1", [agreement({ status, canonical_text: "Signed" })])),
			).toEqual({ kind: "sow", text: "Signed" });
	});

	it("does not find an abandoned document, one of another review session, an unknown id or no id", () => {
		const notFound = "DocumentNotFound: Not found";

		expect(said(read("a1", [agreement({ status: "abandoned" })]))).toBe(
			notFound,
		);
		expect(said(read("a-sow", rows, "t".repeat(64)))).toBe(notFound);
		expect(said(read("a-other"))).toBe(notFound);
		expect(said(read(""))).toBe(notFound);
		expect(said(read(null))).toBe(notFound);
		expect(said(read("A-SOW"))).toBe(notFound);
		expect(said(read("a-sow", []))).toBe(notFound);
	});
});

describe("stage 1: the client's details and the offer's stored text", () => {
	it("reads the client, the terms, the details and the contractor, and makes the client's natural key", () => {
		expect(STORED_READ.client).toEqual(CLIENT);
		expect(STORED_READ.terms).toEqual(offerTerms);
		expect(STORED_READ.details.attachments).toEqual(
			agreementDetails.attachments,
		);
		expect(STORED_READ.contractor).toEqual(contractorValues);
		expect(STORED_READ.configVersion).toBe(3);
		expect(STORED_READ.key).toEqual({
			recipient_email: EMAIL,
			legal_name_key: legalNameKey(CLIENT.legal_name),
			entity_type: "LLC",
			jurisdiction: "Wyoming",
		});
	});

	it("reads a snapshot with no config version, or a null one, as version 1", () => {
		for (const config_version of [undefined, null])
			expect(
				wrote(
					run(
						stored(CLIENT, {
							contractor_snapshot_json: JSON.stringify({
								...contractorValues,
								config_version,
							}),
						}),
					),
				).configVersion,
			).toBe(1);
	});

	it("keys the client by the folded legal name", () => {
		expect(
			wrote(run(stored({ ...CLIENT, legal_name: "  STRASSE GmbH " }))).key
				.legal_name_key,
		).toBe(legalNameKey("STRASSE GmbH"));
	});

	it("refuses stored data a reader refuses with the route's sentence", () => {
		const refused = "StoredDataRefused: The agreement could not be reviewed.";

		expect(said(run(stored({ ...CLIENT, extra: "x" })))).toBe(refused);
		expect(said(run(stored(CLIENT, { terms_json: "{}" })))).toBe(refused);
		expect(said(run(stored(CLIENT, { agreement_details_json: null })))).toBe(
			refused,
		);
		expect(said(run(stored(CLIENT, { agreement_details_json: "{}" })))).toBe(
			refused,
		);
		expect(
			said(
				run(
					stored(CLIENT, { contractor_snapshot_json: '{"config_version":1}' }),
				),
			),
		).toBe(refused);
		expect(said(run(stored(CLIENT, { contractor_snapshot_json: "5" })))).toBe(
			refused,
		);
	});

	it("refuses details that fail their own checks with the check's sentence", () => {
		const terms = (over: Partial<OfferTerms>) =>
			JSON.stringify({ ...offerTerms, ...over });

		const twoMilestones = terms({
			milestones: [offerTerms.milestones[0], offerTerms.milestones[0]],
		});

		expect(said(run(stored(CLIENT, { terms_json: twoMilestones })))).toBe(
			"DetailsRefused: Complete details for every purchased milestone.",
		);
		expect(
			said(
				run(stored(CLIENT, { terms_json: terms({ paymentMode: "invoice" }) })),
			),
		).toBe(
			"DetailsRefused: Enter a first-milestone duration within its planned dates.",
		);
		expect(
			said(
				run(
					stored(CLIENT, {
						terms_json: terms({
							milestones: [
								{
									...offerTerms.milestones[0],
									checkpoint: { label: "Halfway", cancellationPercent: 60 },
								},
							],
						}),
					}),
				),
			),
		).toBe("DetailsRefused: Checkpoint criteria and evidence are required.");
		expect(
			said(
				run(
					stored(CLIENT, {
						agreement_details_json: JSON.stringify({
							...agreementDetails,
							environment: "x".repeat(66000),
						}),
					}),
				),
			),
		).toBe("DetailsRefused: Agreement details exceed 64 KiB.");
	});

	it("throws text that is not JSON, and a null snapshot, as today: a defect the route logs as the same error", () => {
		for (const over of [
			{ terms_json: "{" },
			{ agreement_details_json: "not json" },
			{ contractor_snapshot_json: "{" },
		]) {
			const defect = defectOf(() => stored(CLIENT, over));

			expect(defect).toBeInstanceOf(SyntaxError);
		}

		const missing = defectOf(() =>
			stored(CLIENT, { contractor_snapshot_json: null }),
		);

		expect(missing).toBeInstanceOf(TypeError);
		expect(missing).toHaveProperty(
			"message",
			"Cannot destructure property 'config_version' of 'object null' as it is null.",
		);
	});

	it("answers whichever failure today's order reaches first", () => {
		const refused = "StoredDataRefused: The agreement could not be reviewed.";

		expect(said(run(stored({}, { terms_json: "{" })))).toBe(refused);
		expect(
			said(
				run(stored(CLIENT, { terms_json: "{}", agreement_details_json: "{" })),
			),
		).toBe(refused);
		expect(
			said(
				run(
					stored(CLIENT, {
						agreement_details_json: JSON.stringify({
							...agreementDetails,
							milestones: [],
						}),
						contractor_snapshot_json: null,
					}),
				),
			),
		).toBe(refused);
		expect(
			defectOf(() =>
				stored(CLIENT, { terms_json: "{", agreement_details_json: "{}" }),
			),
		).toBeInstanceOf(SyntaxError);
	});
});

describe("stage 2: the offer's agreements", () => {
	const existing = (rows: readonly OfferAgreementRow[]) =>
		run(reviewExisting.decide(null, rows));

	it("finds the clients of the documents in review, each once, in the order read", () => {
		expect(wrote(existing([]))).toEqual({ replacedClientIds: [] });
		expect(
			wrote(
				existing([
					agreement({ id: "a-msa", kind: "msa", client_id: "c2" }),
					agreement({ id: "a-sow", client_id: "c2" }),
					agreement({ id: "a-old", client_id: "c1", status: "abandoned" }),
				]),
			),
		).toEqual({ replacedClientIds: ["c2"] });
		expect(
			wrote(
				existing([
					agreement({ id: "a-msa", kind: "msa", client_id: "c2" }),
					agreement({ id: "a-sow", client_id: "c1" }),
				]),
			),
		).toEqual({ replacedClientIds: ["c2", "c1"] });
	});

	it("refuses once a document is client_signed or executed, and ignores an abandoned one", () => {
		const saved =
			"SignatureSaved: A signature is already saved. These documents cannot change.";

		expect(said(existing([agreement({ status: "client_signed" })]))).toBe(
			saved,
		);
		expect(
			said(
				existing([
					agreement({ id: "a-msa", kind: "msa", status: "executed" }),
					agreement({ id: "a-sow" }),
				]),
			),
		).toBe(saved);
		expect(said(existing([agreement({ status: "abandoned" })]))).toBe("writes");
	});
});

describe("stage 3: the client and the MSA the offer reuses", () => {
	const reusing = { reused_msa_id: "m1", msa_template_id: "t-msa" };
	const pinning = { reused_msa_id: null, msa_template_id: "t-msa" };

	const decide = (
		offer: PartyRequest["offer"],
		client: { readonly id: string } | null,
		reused: ReusedMsaRow | null,
		newClientId: string | null = client ? null : "c-new",
	) =>
		run(
			reviewParty.decide({ offer, newClientId }, { client, reusedMsa: reused }),
		);

	it("writes for a new client with the id drawn, and the pinned MSA template", () => {
		expect(wrote(decide(pinning, null, null))).toEqual({
			clientId: "c-new",
			earlierClientId: null,
			reused: null,
			msaTemplateId: "t-msa",
		});
	});

	it("writes for the client the natural key names, which the review found before", () => {
		expect(wrote(decide(pinning, { id: "c1" }, null))).toEqual({
			clientId: "c1",
			earlierClientId: "c1",
			reused: null,
			msaTemplateId: "t-msa",
		});
	});

	it("reuses an executed, current, ready MSA of this client, and reads its template", () => {
		expect(wrote(decide(reusing, { id: "c1" }, reusedMsa()))).toEqual({
			clientId: "c1",
			earlierClientId: "c1",
			reused: reusedMsa(),
			msaTemplateId: "t-msa-old",
		});
	});

	it("refuses a reused MSA that is not this client's executed, current, ready MSA", () => {
		const mismatch =
			"MsaMismatch: The confirmed MSA does not match this legal party. Ask Kazon for a new offer.";

		for (const row of [
			null,
			reusedMsa({ id: "m2" }),
			reusedMsa({ kind: "sow" }),
			reusedMsa({ status: "review" }),
			reusedMsa({ status: "client_signed" }),
			reusedMsa({ status: "abandoned" }),
			reusedMsa({ terminated_at: "2026-11-01T00:00:00.000Z" }),
			reusedMsa({ archive_closed_at: "2026-11-01T00:00:00.000Z" }),
			reusedMsa({ artifact_status: null }),
			reusedMsa({ artifact_status: "pending" }),
			reusedMsa({ artifact_status: "rendering" }),
			reusedMsa({ artifact_status: "failed" }),
			reusedMsa({ client_id: "c2" }),
		])
			expect(said(decide(reusing, { id: "c1" }, row))).toBe(mismatch);

		expect(said(decide(reusing, null, reusedMsa()))).toBe(mismatch);
	});

	it("reuses no MSA when the offer names none, whatever was read", () => {
		for (const reused_msa_id of [null, undefined, ""])
			expect(
				wrote(
					decide(
						{ reused_msa_id, msa_template_id: "t-msa" },
						{ id: "c1" },
						reusedMsa(),
					),
				).reused,
			).toBeNull();
	});
});

describe("stage 4: the templates", () => {
	it("refuses when either template is not found", () => {
		const unavailable =
			"TemplatesUnavailable: The pinned templates are unavailable.";

		for (const facts of [
			{ msa: null, sow: TEMPLATES.sow },
			{ msa: TEMPLATES.msa, sow: null },
			{ msa: null, sow: null },
		])
			expect(said(run(reviewTemplates.decide(null, facts)))).toBe(unavailable);

		expect(wrote(run(reviewTemplates.decide(null, TEMPLATES)))).toEqual(
			TEMPLATES,
		);
	});
});

describe("stage 5: the texts", () => {
	const values = (reused: ReusedMsaRow | null) =>
		agreementValues(
			STORED_READ.terms,
			STORED_READ.details,
			STORED_READ.client,
			{ ...STORED_READ.contractor, config_version: 3 },
			{
				effective_on: EFFECTIVE_ON,
				msa_version: `${reused?.effective_on ?? EFFECTIVE_ON} / template 2`,
				sow_number: "SOW-a-sow",
				offer_version: 2,
				template_version: 2,
				msa_version_label: "msa-v2",
				msa_source_revision: "msa-rev",
				sow_version_label: "sow-v2",
				sow_source_revision: "sow-rev",
			},
		);

	it("renders the MSA and then the SOW from the values today's code makes", () => {
		const rendered = wrote(run(texts()));

		expect(rendered.values).toEqual(values(null));
		expect(rendered.documents).toEqual([
			{
				id: "a-msa",
				kind: "msa",
				text: renderAgreement("msa", TEMPLATES.msa.text, values(null)),
			},
			{
				id: "a-sow",
				kind: "sow",
				text: renderAgreement("sow", TEMPLATES.sow.text, values(null)),
			},
		]);
		expect(rendered.documents[1]?.text).toContain("sow.number: SOW-a-sow\n");
		expect(rendered.documents[0]?.text).toContain(
			`msa.effective_on: ${EFFECTIVE_ON}\n`,
		);
		expect(rendered).toMatchObject({
			msaId: "a-msa",
			sowId: "a-sow",
			effectiveOn: EFFECTIVE_ON,
		});
	});

	it("renders only the SOW for a reused MSA, dated by that MSA", () => {
		const rendered = wrote(
			run(texts({ party: party({ reused: reusedMsa() }) })),
		);

		expect(rendered.msaId).toBe("m1");
		expect(rendered.documents.map((document) => document.kind)).toEqual([
			"sow",
		]);
		expect(rendered.values).toEqual(values(reusedMsa()));
		expect(rendered.documents[0]?.text).toContain(
			"msa.effective_on: 2026-10-02\n",
		);
	});

	it("refuses with the template code's sentence", () => {
		const unsupported = {
			...STORED_READ,
			client: { ...STORED_READ.client, legal_name: "株式会社" },
		};

		expect(said(run(texts({ stored: unsupported })))).toBe(
			"RenderRefused: Unsupported character. Arrange outside-site signing.",
		);

		const blank = {
			...STORED_READ,
			details: { ...STORED_READ.details, environment: "Browser [TBD]" },
		};

		expect(said(run(texts({ stored: blank })))).toBe(
			"RenderRefused: The filled agreement has unresolved blanks or exceeds 256 KiB.",
		);

		const unknownField = template("sow", {
			text: `sow.extra: {{sow.extra}}\n${fieldsOf("sow")}`,
		});

		expect(
			said(run(texts({ templates: { ...TEMPLATES, sow: unknownField } }))),
		).toBe(
			"RenderRefused: Line 1: unknown field sow.extra. Use the field reference.",
		);
	});

	it("answers the MSA's refusal before the SOW's, and none for an MSA it does not render", () => {
		const broken = (kind: "msa" | "sow", field: string) =>
			template(kind, { text: `${field}: {{${field}}}\n${fieldsOf(kind)}` });

		const both = {
			msa: broken("msa", "msa.extra"),
			sow: broken("sow", "sow.extra"),
		};

		expect(said(run(texts({ templates: both })))).toBe(
			"RenderRefused: Line 1: unknown field msa.extra. Use the field reference.",
		);
		expect(
			said(
				run(
					texts({
						templates: { ...TEMPLATES, msa: broken("msa", "msa.extra") },
						party: party({ reused: reusedMsa() }),
					}),
				),
			),
		).toBe("writes");
	});
});

describe("stage 6: a pending MSA of another offer", () => {
	const pendingRow = (over: Partial<PendingMsaRow> = {}): PendingMsaRow => ({
		id: "m-other",
		kind: "msa",
		status: "review",
		offer_id: "o2",
		client_id: "c1",
		template_id: "t-msa",
		...over,
	});

	const pending = (rows: readonly PendingMsaRow[]) =>
		said(
			run(
				reviewPendingMsa.decide(
					{
						offer: { id: "o1" },
						party: { clientId: "c1" },
						templates: TEMPLATES,
					},
					rows,
				),
			),
		);

	const elsewhere =
		"PendingMsaElsewhere: Another offer has a pending MSA for this party. Ask Kazon to resolve it.";

	it("refuses an MSA of another offer in review or client_signed for this client and template", () => {
		expect(pending([pendingRow()])).toBe(elsewhere);
		expect(pending([pendingRow({ status: "client_signed" })])).toBe(elsewhere);
	});

	it("passes an executed or abandoned MSA, this offer's own, one of no offer, a SOW, and another client's or template's", () => {
		for (const row of [
			pendingRow({ status: "executed" }),
			pendingRow({ status: "abandoned" }),
			pendingRow({ offer_id: "o1" }),
			pendingRow({ offer_id: null }),
			pendingRow({ kind: "sow" }),
			pendingRow({ client_id: "c2" }),
			pendingRow({ template_id: "t-other" }),
		])
			expect(pending([row])).toBe("writes");

		expect(pending([])).toBe("writes");
	});
});

/** Every stage, run on the facts given, with the hashes the flow would make; the write, or the first refusal. */
function review(facts: {
	readonly offer?: ReviewOffer;
	readonly existing?: readonly OfferAgreementRow[];
	readonly client?: { readonly id: string } | null;
	readonly newClientId?: string | null;
	readonly reusedMsa?: ReusedMsaRow | null;
	readonly pending?: readonly PendingMsaRow[];
}): { readonly write: ReviewWrite } | { readonly refused: string } {
	const offer = facts.offer ?? OFFER;
	const read = wrote(run(stored()));
	const existing = run(reviewExisting.decide(null, facts.existing ?? []));

	if ("refused" in existing) return { refused: existing.refused };
	const client = facts.client ?? null;

	const chosen = run(
		reviewParty.decide(
			{ offer, newClientId: facts.newClientId ?? (client ? null : "c-new") },
			{ client, reusedMsa: facts.reusedMsa ?? null },
		),
	);

	if ("refused" in chosen) return { refused: chosen.refused };

	const templates = wrote(
		run(
			reviewTemplates.decide(null, {
				msa: chosen.wrote.reused
					? template("msa", { id: "t-msa-old" })
					: TEMPLATES.msa,
				sow: TEMPLATES.sow,
			}),
		),
	);

	const rendered: ReviewTexts = wrote(
		run(
			reviewTexts.decide(
				{
					offer,
					stored: read,
					party: chosen.wrote,
					templates,
					msaId: chosen.wrote.reused ? null : "a-msa",
					sowId: "a-sow",
					effectiveOn: EFFECTIVE_ON,
				},
				null,
			),
		),
	);

	const none = run(
		reviewPendingMsa.decide(
			{ offer, party: chosen.wrote, templates },
			facts.pending ?? [],
		),
	);

	if ("refused" in none) return { refused: none.refused };

	return {
		write: wrote(
			run(
				reviewDocuments.decide(
					{
						offer,
						session: SESSION,
						stored: read,
						existing: existing.wrote,
						party: chosen.wrote,
						templates,
						texts: rendered,
						hashes: rendered.documents.map(
							(document) => `${document.kind}-hash`,
						),
						at: AT,
						sessionNow: "2026-11-14T03:30:00.005Z",
						eventId: "e1",
					},
					null,
				),
			),
		),
	};
}

const written = (facts: Parameters<typeof review>[0]) => {
	const reviewed = review(facts);

	if ("refused" in reviewed) throw new Error(`refused ${reviewed.refused}`);

	return reviewed.write;
};

describe("stage 7: the review batch and the answer", () => {
	it("writes the client, the documents, the stale clients, the event and the guards' values", () => {
		const write = written({
			existing: [agreement({ id: "a-old", client_id: "c-old" })],
		});

		const valuesJson = JSON.stringify(
			wrote(run(texts({ party: party({ clientId: "c-new" }) }))).values,
		);

		expect(write).toEqual({
			offerId: "o1",
			linkHash: SESSION.link_hash,
			recipientEmail: EMAIL,
			sessionTokenHash: SESSION.token_hash,
			sessionNow: "2026-11-14T03:30:00.005Z",
			client: {
				id: "c-new",
				recipient_email: EMAIL,
				legal_name: "Sample LLC",
				legal_name_key: legalNameKey("Sample LLC"),
				entity_type: "LLC",
				jurisdiction: "Wyoming",
				business_address: "100 Example Street",
				notice_email: "notices@example.com",
				created_at: AT,
			},
			earlierClientId: null,
			documents: [
				expect.objectContaining({
					id: "a-msa",
					kind: "msa",
					offer_id: "o1",
					request_id: "r1",
					client_id: "c-new",
					template_id: "t-msa",
					msa_id: null,
					sow_number: null,
					text_sha256: "msa-hash",
					values_json: valuesJson,
					attachment_manifest_json: "[]",
					created_at: AT,
					effective_on: EFFECTIVE_ON,
					review_session_hash: SESSION.token_hash,
				}),
				expect.objectContaining({
					id: "a-sow",
					kind: "sow",
					template_id: "t-sow",
					msa_id: "a-msa",
					sow_number: "SOW-a-sow",
					text_sha256: "sow-hash",
					values_json: valuesJson,
					attachment_manifest_json: JSON.stringify(
						agreementDetails.attachments,
					),
				}),
			],
			staleClientIds: ["c-old"],
			event: {
				id: "e1",
				agreement_id: null,
				offer_id: "o1",
				action: "reviewed",
				actor: SESSION.token_hash,
				occurred_at: AT,
				reason: null,
			},
			answer: expect.anything(),
		});
	});

	it("answers in today's key order: each document's id, kind, hash and text, then the reused MSA", () => {
		const write = written({});
		const [msa, sow] = write.documents;

		expect(JSON.stringify({ ok: true, ...write.answer })).toBe(
			JSON.stringify({
				ok: true,
				documents: [
					{
						id: "a-msa",
						kind: "msa",
						hash: "msa-hash",
						text: msa?.canonical_text,
					},
					{
						id: "a-sow",
						kind: "sow",
						hash: "sow-hash",
						text: sow?.canonical_text,
					},
				],
				reused_msa: null,
			}),
		);
	});

	it("writes only the SOW against a reused MSA, and answers that MSA's id, text and hash", () => {
		const write = written({
			offer: { ...OFFER, reused_msa_id: "m1" },
			client: { id: "c1" },
			reusedMsa: reusedMsa(),
		});

		expect(
			write.documents.map((document) => [
				document.kind,
				document.msa_id,
				document.template_id,
			]),
		).toEqual([["sow", "m1", "t-sow"]]);
		expect(JSON.stringify(write.answer.reused_msa)).toBe(
			JSON.stringify({
				id: "m1",
				text: "The executed MSA",
				hash: "e".repeat(64),
			}),
		);
	});
});

describe("the re-decision after a UNIQUE failure that backs a fact (B7)", () => {
	it("another tab created the same legal party: the evidence says so, and the retry writes for the other tab's client", () => {
		const first = written({});

		expect(first.client.id).toBe("c-new");
		// After the FOREIGN KEY failure, the read by the natural key finds the other tab's row.
		expect(clientChangedElsewhere(first, [{ id: "c-other" }])).toBe(true);

		const retry = written({ client: { id: "c-other" } });

		expect(retry.client.id).toBe("c-other");
		expect(retry.earlierClientId).toBe("c-other");
		expect(retry.documents.map((document) => document.client_id)).toEqual([
			"c-other",
			"c-other",
		]);
	});

	it("another tab's review removed the client the review found: the evidence says so, and the retry writes a new client", () => {
		const first = written({ client: { id: "c-old" } });

		expect(first.client.id).toBe("c-old");
		expect(clientChangedElsewhere(first, [])).toBe(true);

		const retry = written({ client: null, newClientId: "c-next" });

		expect(retry.client.id).toBe("c-next");
		expect(retry.earlierClientId).toBeNull();
	});

	it("no other request changed the client: the evidence does not say so, so the failure stands", () => {
		expect(clientChangedElsewhere(written({}), [])).toBe(false);
		expect(clientChangedElsewhere(written({}), [{ id: "c-new" }])).toBe(false);
		expect(
			clientChangedElsewhere(written({ client: { id: "c-old" } }), [
				{ id: "c-old" },
			]),
		).toBe(false);
	});

	it("another offer's MSA for the party appeared: the retry reads it and refuses as today", () => {
		expect("write" in review({})).toBe(true);
		expect(
			review({
				pending: [
					{
						id: "m-other",
						kind: "msa",
						status: "review",
						offer_id: "o2",
						client_id: "c-new",
						template_id: "t-msa",
					},
				],
			}),
		).toEqual({ refused: "PendingMsaElsewhere" });
	});

	it("the other tab's client has another offer's pending MSA: the retry, deciding for that client, refuses", () => {
		expect(
			review({
				client: { id: "c-other" },
				pending: [
					{
						id: "m-other",
						kind: "msa",
						status: "client_signed",
						offer_id: "o2",
						client_id: "c-other",
						template_id: "t-msa",
					},
				],
			}),
		).toEqual({ refused: "PendingMsaElsewhere" });
	});

	it("a signature saved before the retry's read is refused by the retry", () => {
		expect(
			review({ existing: [agreement({ status: "client_signed" })] }),
		).toEqual({ refused: "SignatureSaved" });
	});
});
