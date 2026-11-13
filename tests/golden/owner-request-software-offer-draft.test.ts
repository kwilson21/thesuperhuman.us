import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	ATTACHMENT_KEY,
	attachment,
	attachmentBucket,
	attachmentRow,
	BASE,
	details,
	EARLIER,
	executedMsa,
	inserting,
	milestone,
	MSA_ID,
	offer,
	offerTables,
	project,
	projectTables,
	raw,
	readyArtifact,
	request,
	running,
	SECOND_KEY,
	secondsFromNow,
	terms,
	withOffers,
} from "./areas/software-offers";
import {
	asClientCookie,
	asVisitor,
	defineCorpus,
	generatedBody,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonObject, JsonValue } from "../helpers/json";

// The golden corpus for the draft action of POST /api/owner/requests/[id]/software: the owner saves the offer draft
// (terms, optional agreement details, a reused MSA, removed attachments) without sending anything. One batch guards the
// request and the draft's updated_at, inserts the next version or updates the open draft, pins the agreement details and the
// MSA choice, writes "offer-draft-saved" and deletes the metadata of removed attachments that nothing references; then the
// route deletes those objects from R2. No email. The guards shared by every action are recorded in
// owner-request-software-fit.
//
// Every response branch of the draft action, and the cases that reach it:
//
//   guards   403 a visitor, a forged cookie; 503 no database; 400 schema (expectedUpdatedAt missing or not text, a removed
//            key that is not an attachment key, 101 removed keys, a reusedMsaId that is not a UUID, confirmMsaReuse not a
//            boolean); 404 unknown id, another kind; 409 closed (withdrawn, empty email); 409 resolved; 409 project started
//   400 {ok:false,errors}  validateOfferTerms: terms missing, not an object, every field missing, wrong type, empty, over
//            its limit, with a newline or a control character or a lone surrogate, a payment mode that is not allowed,
//            milestone counts, deliverable and acceptance counts, duplicate deliverables (after case, space and Unicode
//            normalisation), fees of 0, 99, 1.5, text, null, over $1,000,000 and 1e21, checkpoint percentages 0, 50, 96, 100,
//            50.5, a text percentage, an estimate below the total or with high below low or beyond the safe integer
//   409 {ok:false,updatedAt,message}  the draft changed since the page loaded: no draft but a time expected, a draft but
//            null expected, a different time; also every failure of the batch (a guard, a unique index on the draft or the
//            version, a foreign key on reusedMsaId, an attachment guard, a throw) and a ZodError from malformed attachments
//            in agreementDetails, all answered with the current draft's updated_at
//   409 project started    a project that appears between the checks and the batch
//   200 {ok:true,version,updatedAt,attachmentCleanupPending}  a first draft (version 1), the next version after each offer
//            status, an update of the open draft, agreement details kept, cleared or replaced, an MSA reuse kept, set or
//            cleared, attachments pinned, removed attachments deleted from R2, cleanup pending when R2 fails or is unbound
//   rejected               a read fails with no handler around it (the request, the project pre-check) or the lookup after a
//            failed batch fails
//   effects: reads (offers, removed attachment metadata), one batch of guards, insert or update, details, MSA choice, audit and
//   one DELETE ... RETURNING per removed attachment, R2 deletes, and a statement that puts the metadata back when an R2
//   delete fails.

const d = (over: JsonObject = {}): JsonObject => ({
	action: "draft",
	terms: terms(),
	expectedUpdatedAt: null,
	...over,
});

const OFFER_TABLES = [...offerTables, ...projectTables];

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, { dump: { music: OFFER_TABLES }, ...extra });

const withDraft = (over: SeedRow = {}) => withOffers([offer("draft", 1, over)]);

const draftCase = (
	name: string,
	body: JsonValue | undefined,
	seed: Seed = withOffers([]),
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	steps: [step(body, over)],
	...extra,
});

/** A terms case: the body carries terms that differ from the valid ones. */
const termsCase = (name: string, termsValue: JsonValue | undefined): Case =>
	draftCase(name, d({ terms: termsValue }));

const ms = (over: JsonObject = {}) => terms({ milestones: [milestone(over)] });

const range = (over: JsonObject = {}) =>
	terms({ projectRange: { lowCents: 240_000, highCents: 300_000, ...over } });

const line = (n: number) => "l".repeat(n);

const bucket = { r2: attachmentBucket };

const withAttachmentRow = (offers: readonly SeedRow[] = [], extra: Seed = {}) =>
	withOffers(offers, {
		software_agreement_attachments: [attachmentRow()],
		...extra,
	});

const dumpWithFiles: Partial<Step> = {
	dump: { music: OFFER_TABLES, r2: true },
};

const guardsCases: Case[] = [
	draftCase("a visitor", d(), withOffers([]), {}, { as: asVisitor() }),
	draftCase(
		"a forged studio cookie",
		d(),
		withOffers([]),
		{},
		{ as: asClientCookie("forged") },
	),
	{ name: "no database binding", music: { missing: true }, steps: [step(d())] },
	draftCase("no expectedUpdatedAt", d({ expectedUpdatedAt: undefined })),
	draftCase(
		"an expectedUpdatedAt that is a number",
		d({ expectedUpdatedAt: 5 }),
	),
	draftCase("no terms at all", { action: "draft", expectedUpdatedAt: null }),
	draftCase(
		"a removed key that is not an attachment key",
		d({ removedAttachmentKeys: ["../secret.pdf"] }),
	),
	draftCase(
		"a removed key in upper case",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY.toUpperCase()] }),
	),
	draftCase(
		"101 removed keys",
		d({
			removedAttachmentKeys: Array.from({ length: 101 }, () => ATTACHMENT_KEY),
		}),
	),
	draftCase(
		"100 removed keys of one attachment",
		d({
			removedAttachmentKeys: Array.from({ length: 100 }, () => ATTACHMENT_KEY),
		}),
	),
	draftCase(
		"removedAttachmentKeys that is not a list",
		d({ removedAttachmentKeys: ATTACHMENT_KEY }),
	),
	draftCase(
		"a reusedMsaId that is not a UUID",
		d({ reusedMsaId: "msa-1", confirmMsaReuse: true }),
	),
	draftCase(
		"a confirmMsaReuse that is not a boolean",
		d({ confirmMsaReuse: "yes" }),
	),
	draftCase(
		"an unknown request id",
		d(),
		withOffers([]),
		{},
		{ path: `${BASE}/nope`, params: { id: "nope" } },
	),
	draftCase("a request of another kind", d(), {
		owner_requests: [rows.ownerRequest("r1")],
	}),
	draftCase(
		"a withdrawn request",
		d(),
		withOffers([], {}, { status: "withdrawn" }),
	),
	draftCase(
		"a request with an empty email",
		d(),
		withOffers([], {}, { email: "" }),
	),
	draftCase(
		"a resolved request",
		d(),
		withOffers([], {}, { status: "resolved" }),
	),
	draftCase(
		"a request with a started project",
		d(),
		withOffers([offer("sent")], { software_projects: [project()] }),
	),
	draftCase("a new request", d(), withOffers([], {}, { status: "new" })),
	{
		name: "a body of one byte over 80 KiB",
		music: { seed: withOffers([]) },
		steps: [
			step(undefined, {
				json: undefined,
				body: generatedBody(80 * 1024 + 1),
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json",
				},
			}),
		],
	},
	draftCase(
		"agreement details of about 70 KB are saved as written",
		d({ agreementDetails: { note: "x".repeat(70 * 1024) } }),
	),
	{
		name: "terms with a lone surrogate",
		music: { seed: withOffers([]) },
		steps: [
			raw(
				'{"action":"draft","expectedUpdatedAt":null,"terms":{"outcome":"bad \\ud800 text","summary":"s","milestones":[{"name":"m","deliverables":["d"],"acceptance":["a"],"feeCents":240000}],"clientInputs":"","exclusions":"","timing":"","paymentMode":"standard"}}',
				{ dump: { music: OFFER_TABLES } },
			),
		],
	},
];

const termsCases: Case[] = [
	termsCase("terms that are a string", "terms"),
	termsCase("terms that are null", null),
	termsCase("terms that are an array", []),
	termsCase("terms that are a number", 5),
	termsCase("terms that are an empty object", {}),
	termsCase("an outcome that is missing", terms({ outcome: undefined })),
	termsCase("an empty outcome", terms({ outcome: "" })),
	termsCase("an outcome of only spaces", terms({ outcome: "   " })),
	termsCase("an outcome of 121 characters", terms({ outcome: line(121) })),
	termsCase(
		"an outcome of exactly 120 characters",
		terms({ outcome: line(120) }),
	),
	termsCase("an outcome with a newline", terms({ outcome: "one\ntwo" })),
	termsCase(
		"an outcome with a control character",
		terms({ outcome: "bell\u0007here" }),
	),
	termsCase(
		"an outcome with unicode and markup",
		terms({ outcome: `Café 日本語 🙂 <b>&</b> "q"` }),
	),
	termsCase("an outcome that is not text", terms({ outcome: 5 })),
	termsCase("a summary of 301 characters", terms({ summary: line(301) })),
	termsCase(
		"a summary of exactly 300 characters",
		terms({ summary: line(300) }),
	),
	termsCase("a summary with a tab", terms({ summary: "a\tb" })),
	termsCase("a summary that is missing", terms({ summary: undefined })),
	termsCase(
		"clientInputs that are missing",
		terms({ clientInputs: undefined }),
	),
	termsCase(
		"clientInputs of 1001 characters",
		terms({ clientInputs: line(1001) }),
	),
	termsCase(
		"clientInputs of 1000 characters with newlines",
		terms({ clientInputs: `${line(500)}\n${line(499)}` }),
	),
	termsCase("exclusions of 1001 characters", terms({ exclusions: line(1001) })),
	termsCase("timing of 501 characters", terms({ timing: line(501) })),
	termsCase("timing with a control character", terms({ timing: "a\u0000b" })),
	termsCase("no payment mode", terms({ paymentMode: undefined })),
	termsCase(
		"a payment mode that is not allowed",
		terms({ paymentMode: "Standard" }),
	),
	termsCase("the invoice payment mode", terms({ paymentMode: "invoice" })),
	termsCase("milestones that are missing", terms({ milestones: undefined })),
	termsCase("no milestones", terms({ milestones: [] })),
	termsCase(
		"four milestones",
		terms({ milestones: [milestone(), milestone(), milestone(), milestone()] }),
	),
	termsCase(
		"three milestones",
		terms({
			milestones: [
				milestone(),
				milestone({ name: "Two" }),
				milestone({ name: "Three" }),
			],
		}),
	),
	termsCase("a milestone name of 81 characters", ms({ name: line(81) })),
	termsCase("a milestone with no name", ms({ name: undefined })),
	termsCase("no deliverables", ms({ deliverables: [] })),
	termsCase(
		"nine deliverables",
		ms({
			deliverables: Array.from({ length: 9 }, (_, i) => `Deliverable ${i}`),
		}),
	),
	termsCase(
		"eight deliverables",
		ms({
			deliverables: Array.from({ length: 8 }, (_, i) => `Deliverable ${i}`),
		}),
	),
	termsCase(
		"a deliverable of 201 characters",
		ms({ deliverables: [line(201)] }),
	),
	termsCase("an empty deliverable", ms({ deliverables: [""] })),
	termsCase(
		"deliverables that repeat in another case",
		ms({ deliverables: ["Status view", "STATUS VIEW"] }),
	),
	termsCase(
		"deliverables that repeat with other spacing",
		ms({ deliverables: ["Status view", "  status \t view "] }),
	),
	termsCase(
		"deliverables that repeat in another Unicode form",
		ms({ deliverables: ["Café", "Café"] }),
	),
	termsCase(
		"deliverables that repeat across a non-breaking space",
		ms({ deliverables: ["a b", "a b"] }),
	),
	termsCase(
		"the same deliverable in two milestones",
		terms({ milestones: [milestone(), milestone({ name: "Two" })] }),
	),
	termsCase("no acceptance lines", ms({ acceptance: [] })),
	termsCase(
		"six acceptance lines",
		ms({ acceptance: Array.from({ length: 6 }, (_, i) => `Accept ${i}`) }),
	),
	termsCase(
		"an acceptance line of 301 characters",
		ms({ acceptance: [line(301)] }),
	),
	termsCase("a fee of 0", ms({ feeCents: 0 })),
	termsCase("a fee of 99 cents", ms({ feeCents: 99 })),
	termsCase("a fee of exactly 100 cents", ms({ feeCents: 100 })),
	termsCase("a fee of an odd 12345 cents", ms({ feeCents: 12_345 })),
	termsCase("a fee of 101 cents", ms({ feeCents: 101 })),
	termsCase("a fee of 1.5 cents", ms({ feeCents: 1.5 })),
	termsCase("a fee of -1", ms({ feeCents: -1 })),
	termsCase("a fee as text", ms({ feeCents: "240000" })),
	termsCase("a fee of null", ms({ feeCents: null })),
	termsCase("a fee of exactly $1,000,000", ms({ feeCents: 100_000_000 })),
	termsCase("a fee of $1,000,000.01", ms({ feeCents: 100_000_001 })),
	termsCase("a fee of 1e21", ms({ feeCents: 1e21 })),
	termsCase(
		"three milestones of $1,000,000 each",
		terms({
			milestones: [
				milestone({ feeCents: 100_000_000 }),
				milestone({ name: "Two", feeCents: 100_000_000 }),
				milestone({ name: "Three", feeCents: 100_000_000 }),
			],
		}),
	),
	termsCase(
		"a checkpoint at 0 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 0 } }),
	),
	termsCase(
		"a checkpoint at 50 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 50 } }),
	),
	termsCase(
		"a checkpoint at 51 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 51 } }),
	),
	termsCase(
		"a checkpoint at 95 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 95 } }),
	),
	termsCase(
		"a checkpoint at 96 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 96 } }),
	),
	termsCase(
		"a checkpoint at 100 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 100 } }),
	),
	termsCase(
		"a checkpoint at 50.5 percent",
		ms({ checkpoint: { label: "Review", cancellationPercent: 50.5 } }),
	),
	termsCase(
		"a checkpoint percent as text",
		ms({ checkpoint: { label: "Review", cancellationPercent: "60" } }),
	),
	termsCase(
		"a checkpoint with no label",
		ms({ checkpoint: { cancellationPercent: 60 } }),
	),
	termsCase(
		"a checkpoint label of 121 characters",
		ms({ checkpoint: { label: line(121), cancellationPercent: 60 } }),
	),
	termsCase("a checkpoint of null", ms({ checkpoint: null })),
	termsCase(
		"an estimate equal to the total",
		range({ lowCents: 240_000, highCents: 240_000 }),
	),
	termsCase("an estimate below the total", range({ lowCents: 239_999 })),
	termsCase("an estimate of 0 to 0", range({ lowCents: 0, highCents: 0 })),
	termsCase(
		"an estimate with high below low",
		range({ lowCents: 300_000, highCents: 250_000 }),
	),
	termsCase(
		"an estimate up to the largest safe integer",
		range({ highCents: Number.MAX_SAFE_INTEGER }),
	),
	termsCase(
		"an estimate beyond the largest safe integer",
		range({ highCents: Number.MAX_SAFE_INTEGER + 1 }),
	),
	termsCase("an estimate with a negative low", range({ lowCents: -1 })),
	termsCase("an estimate with half a cent", range({ highCents: 300_000.5 })),
	termsCase("an estimate as text", terms({ projectRange: "300000" })),
	termsCase("an estimate of null", terms({ projectRange: null })),
	termsCase(
		"an estimate with no high",
		terms({ projectRange: { lowCents: 240_000 } }),
	),
	termsCase("terms with extra fields", terms({ extra: "ignored" })),
	termsCase(
		"terms with several problems at once",
		terms({
			outcome: "",
			summary: line(301),
			paymentMode: "x",
			milestones: [],
		}),
	),
];

const stateCases: Case[] = [
	draftCase("the first draft of a request with no offers", d()),
	draftCase(
		"a first draft that expects a time",
		d({ expectedUpdatedAt: EARLIER }),
	),
	draftCase(
		"a draft that expects null when a draft is saved",
		d(),
		withDraft(),
	),
	draftCase(
		"an update that expects the saved time",
		d({ expectedUpdatedAt: EARLIER, terms: terms({ summary: "Changed." }) }),
		withDraft(),
	),
	draftCase(
		"an update that expects a stale time",
		d({ expectedUpdatedAt: "2026-11-13T10:00:00.000Z" }),
		withDraft(),
	),
	draftCase(
		"an update that expects an empty time",
		d({ expectedUpdatedAt: "" }),
		withDraft(),
	),
	draftCase(
		"a new draft after a sent offer is version 2",
		d(),
		withOffers([offer("sent")]),
	),
	draftCase(
		"a new draft after versions 1 to 3 is version 4",
		d(),
		withOffers([
			offer("sent", 3),
			offer("superseded", 2),
			offer("withdrawn", 1),
		]),
	),
	draftCase(
		"a new draft after a lone sent offer of version 3 is version 4",
		d(),
		withOffers([offer("sent", 3)]),
	),
	draftCase(
		"a new draft after versions 2 and 5 is version 6",
		d(),
		withOffers([offer("superseded", 2), offer("withdrawn", 5)]),
	),
	draftCase(
		"a new draft after only a superseded offer",
		d(),
		withOffers([offer("superseded")]),
	),
	draftCase(
		"a new draft after only a withdrawn offer",
		d(),
		withOffers([offer("withdrawn")]),
	),
	draftCase(
		"a draft and a sent offer: the update keeps the draft's version",
		d({ expectedUpdatedAt: EARLIER }),
		withOffers([offer("sent"), offer("draft", 2)]),
	),
	draftCase(
		"an update of a draft whose updated_at is ahead of the clock",
		d({ expectedUpdatedAt: secondsFromNow(3600) }),
		withDraft({ updated_at: secondsFromNow(3600) }),
	),
	draftCase(
		"an update of a draft saved in this very millisecond",
		d({ expectedUpdatedAt: secondsFromNow(0) }),
		withDraft({ updated_at: secondsFromNow(0) }),
	),
	draftCase(
		"an update that changes the payment mode",
		d({ expectedUpdatedAt: EARLIER, terms: terms({ paymentMode: "invoice" }) }),
		withDraft(),
	),
	draftCase(
		"terms saved with unicode and markup",
		d({
			terms: terms({
				outcome: `<script>alert("x")</script> & café 🙂`,
				summary: "Don't <b>stop</b> & go",
			}),
		}),
	),
	draftCase(
		"a draft saved with every optional field",
		d({
			terms: terms({
				clientInputs: "Access to the data.",
				exclusions: "No mobile app.",
				timing: "Start in January.",
				projectRange: { lowCents: 240_000, highCents: 360_000 },
				milestones: [
					milestone({
						checkpoint: { label: "Mid review", cancellationPercent: 60 },
					}),
				],
			}),
		}),
	),
	draftCase(
		"extra top-level fields are dropped",
		d({ extra: true, status: "sent" }),
	),
	draftCase(
		"a draft of a new request",
		d(),
		withOffers([], {}, { status: "new" }),
	),
	draftCase(
		"a client email in capitals",
		d(),
		withOffers([], {}, { email: " Grace@Example.TEST " }),
	),
];

const detailsCases: Case[] = [
	draftCase(
		"agreement details left out keep the saved ones",
		d({ expectedUpdatedAt: EARLIER }),
		withDraft({ agreement_details_json: JSON.stringify(details()) }),
	),
	draftCase(
		"agreement details of null clear the saved ones",
		d({ expectedUpdatedAt: EARLIER, agreementDetails: null }),
		withDraft({ agreement_details_json: JSON.stringify(details()) }),
	),
	draftCase(
		"agreement details saved on a first draft",
		d({ agreementDetails: details() }),
	),
	draftCase(
		"agreement details that are not valid are saved anyway",
		d({ agreementDetails: { planned_start: "not a date" } }),
	),
	draftCase(
		"agreement details that are a string",
		d({ agreementDetails: "junk" }),
	),
	draftCase("agreement details that are a number", d({ agreementDetails: 5 })),
	draftCase(
		"agreement details that are an array",
		d({ agreementDetails: [1, 2] }),
	),
	draftCase(
		"agreement details with attachments that are not a list",
		d({ agreementDetails: { attachments: "none" } }),
	),
	draftCase(
		"agreement details with a malformed attachment",
		d({ agreementDetails: { attachments: [{ filename: "x" }] } }),
	),
	draftCase(
		"agreement details with six attachments",
		d({
			agreementDetails: {
				attachments: Array.from({ length: 6 }, () => attachment()),
			},
		}),
	),
	draftCase(
		"an attachment with no metadata row",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
	),
	draftCase(
		"an attachment with its metadata row",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
		withAttachmentRow(),
	),
	draftCase(
		"an attachment whose hash differs from the metadata row",
		d({
			agreementDetails: details({
				attachments: [attachment({ sha256: "a".repeat(64) })],
			}),
		}),
		withAttachmentRow(),
	),
	draftCase(
		"an attachment whose size differs from the metadata row",
		d({
			agreementDetails: details({ attachments: [attachment({ bytes: 5 })] }),
		}),
		withAttachmentRow(),
	),
	draftCase(
		"an attachment whose filename differs from the metadata row",
		d({
			agreementDetails: details({
				attachments: [attachment({ filename: "Other.pdf" })],
			}),
		}),
		withAttachmentRow(),
	),
	draftCase(
		"an attachment of another request",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
		{
			owner_requests: [request(), rows.softwareRequest("r2")],
			software_agreement_attachments: [attachmentRow({ request_id: "r2" })],
		},
	),
	draftCase(
		"an attachment already in a closed archive",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
		{
			...rows.agreementBase(),
			...withAttachmentRow([offer("sent")], {}),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "executed",
					attachment_manifest_json: JSON.stringify([{ key: ATTACHMENT_KEY }]),
					archive_closed_at: EARLIER,
				}),
			],
		},
	),
	draftCase(
		"two attachments, one with a metadata row and one without",
		d({
			agreementDetails: details({
				attachments: [attachment(), attachment({ key: SECOND_KEY })],
			}),
		}),
		withAttachmentRow(),
	),
	// MSA reuse
	draftCase(
		"an MSA reuse confirmed with an MSA that exists",
		d({ reusedMsaId: MSA_ID, confirmMsaReuse: true }),
		{
			owner_requests: [request()],
			...rows.agreementBase(),
			software_agreements: [executedMsa()],
			software_agreement_artifacts: [readyArtifact()],
		},
	),
	draftCase("an MSA reuse confirmed with no id", d({ confirmMsaReuse: true })),
	draftCase(
		"an MSA reuse confirmed with a null id",
		d({ confirmMsaReuse: true, reusedMsaId: null }),
	),
	draftCase(
		"an MSA reuse declined with an id",
		d({ confirmMsaReuse: false, reusedMsaId: MSA_ID }),
	),
	draftCase(
		"an MSA id with no confirmation is ignored",
		d({ reusedMsaId: MSA_ID }),
	),
	draftCase(
		"an MSA reuse confirmed with an MSA that does not exist",
		d({ reusedMsaId: MSA_ID, confirmMsaReuse: true }),
	),
	draftCase(
		"an MSA reuse declined clears a saved one",
		d({ expectedUpdatedAt: EARLIER, confirmMsaReuse: false }),
		{
			owner_requests: [request()],
			...rows.agreementBase(),
			software_agreements: [executedMsa()],
			software_offers: [offer("draft", 1, { reused_msa_id: MSA_ID })],
		},
	),
	draftCase(
		"a saved MSA reuse is kept when the field is left out",
		d({ expectedUpdatedAt: EARLIER }),
		{
			owner_requests: [request()],
			...rows.agreementBase(),
			software_agreements: [executedMsa()],
			software_offers: [offer("draft", 1, { reused_msa_id: MSA_ID })],
		},
	),
];

const attachmentCases: Case[] = [
	draftCase(
		"a removed attachment is deleted from the table and from R2",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment that the new details still name is kept",
		d({
			removedAttachmentKeys: [ATTACHMENT_KEY],
			agreementDetails: details({ attachments: [attachment()] }),
		}),
		withAttachmentRow(),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment that another offer's details name is kept",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow([
			offer("sent", 1, {
				agreement_details_json: JSON.stringify(
					details({ attachments: [attachment()] }),
				),
			}),
		]),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment that an agreement manifest names is kept",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		{
			...rows.agreementBase(),
			...withAttachmentRow([offer("sent")]),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "client_signed",
					attachment_manifest_json: JSON.stringify([{ key: ATTACHMENT_KEY }]),
				}),
			],
		},
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed key with no metadata row",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withOffers([]),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed key of another request's attachment",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		{
			owner_requests: [request(), rows.softwareRequest("r2")],
			software_agreement_attachments: [attachmentRow({ request_id: "r2" })],
		},
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"two removed attachments",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY, SECOND_KEY] }),
		withOffers([], {
			software_agreement_attachments: [
				attachmentRow(),
				attachmentRow({ id: "att2", object_key: SECOND_KEY }),
			],
		}),
		{
			r2: {
				seed: { [ATTACHMENT_KEY]: { body: "a" }, [SECOND_KEY]: { body: "b" } },
			},
		},
		dumpWithFiles,
	),
	draftCase(
		"a removed key listed twice",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY, ATTACHMENT_KEY] }),
		withAttachmentRow(),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment whose R2 object is already gone",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		{},
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment whose R2 delete fails",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		{ r2: { ...attachmentBucket, fails: ["delete"] } },
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment with no R2 binding",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		{ r2: { missing: true } },
		dumpWithFiles,
	),
	draftCase(
		"a failed R2 delete and the metadata put back also fails",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		{
			r2: { ...attachmentBucket, fails: ["delete"] },
			failures: [
				{
					on: /INSERT OR IGNORE INTO software_agreement_attachments/,
					message: "D1 is down",
				},
			],
		},
		dumpWithFiles,
	),
	draftCase(
		"a removed attachment that the saved draft still names is kept",
		d({ expectedUpdatedAt: EARLIER, removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow([
			offer("draft", 1, {
				agreement_details_json: JSON.stringify(
					details({ attachments: [attachment()] }),
				),
			}),
		]),
		bucket,
		dumpWithFiles,
	),
];

const signedCases: Case[] = [
	...["client_signed", "executed"].map((status) =>
		draftCase(`a draft saved while an agreement is ${status}`, d(), {
			...rows.agreementBase(),
			...withOffers([offer("sent")]),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status,
					executed_at: status === "executed" ? EARLIER : null,
				}),
			],
		}),
	),
	draftCase(
		"an agreement with a malformed manifest does not break the attachment guard",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
		{
			...rows.agreementBase(),
			...withAttachmentRow([offer("sent")]),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "client_signed",
					attachment_manifest_json: "{bad",
				}),
			],
		},
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a malformed agreement manifest breaks the removed attachment delete",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		{
			...rows.agreementBase(),
			...withAttachmentRow([offer("sent")]),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "client_signed",
					attachment_manifest_json: "{bad",
				}),
			],
		},
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"another offer's saved details are not JSON when an attachment is removed",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow([offer("sent", 1, { agreement_details_json: "{bad" })]),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"another offer's saved details have no attachments when one is removed",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow([offer("sent", 1, { agreement_details_json: "[]" })]),
		bucket,
		dumpWithFiles,
	),
	draftCase(
		"a malformed agreement manifest is not read when no attachment is removed or pinned",
		d(),
		{
			...rows.agreementBase(),
			...withOffers([offer("sent")]),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "client_signed",
					attachment_manifest_json: "{bad",
				}),
			],
		},
	),
];

const raceCases: Case[] = [
	draftCase("the first read fails", d(), withOffers([]), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	draftCase("the project pre-check fails", d(), withOffers([]), {
		failures: [
			{ on: /^SELECT 1 FROM software_projects/, message: "D1 is down" },
		],
	}),
	draftCase("the offers read fails", d(), withOffers([]), {
		failures: [
			{
				on: /^SELECT \* FROM software_offers WHERE request_id/,
				message: "D1 is down",
			},
		],
	}),
	draftCase("the offers read fails twice", d(), withOffers([]), {
		failures: [
			{
				on: /^SELECT \* FROM software_offers WHERE request_id/,
				message: "D1 is down",
			},
			{
				on: /^SELECT \* FROM software_offers WHERE request_id/,
				nth: 2,
				message: "D1 is down again",
			},
		],
	}),
	draftCase(
		"the removed attachment lookup fails",
		d({ removedAttachmentKeys: [ATTACHMENT_KEY] }),
		withAttachmentRow(),
		{
			...bucket,
			failures: [
				{
					on: /SELECT \* FROM software_agreement_attachments/,
					message: "D1 is down",
				},
			],
		},
		dumpWithFiles,
	),
	draftCase("the draft batch fails on a new draft", d(), withOffers([]), {
		failures: [{ on: /INSERT INTO software_offers/, message: "D1 is down" }],
	}),
	draftCase(
		"the draft batch fails on an update",
		d({ expectedUpdatedAt: EARLIER }),
		withDraft(),
		{
			failures: [
				{ on: /UPDATE software_offers SET terms_json/, message: "D1 is down" },
			],
		},
	),
	draftCase(
		"the draft batch fails and the offers read after it fails too",
		d(),
		withOffers([]),
		{
			failures: [
				{ on: /INSERT INTO software_offers/, message: "D1 is down" },
				{
					on: /^SELECT \* FROM software_offers WHERE request_id/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	draftCase(
		"the request's updated_at moves before the batch",
		d(),
		withOffers([]),
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "another change moves updated_at",
					run: running(
						"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
					),
				},
			],
		},
	),
	draftCase("the request is withdrawn before the batch", d(), withOffers([]), {
		interleave: [
			{
				on: /INSERT INTO software_offers/,
				label: "the client withdraws",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	draftCase(
		"a project starts before the batch",
		d(),
		withOffers([offer("sent")]),
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "a project starts",
					run: inserting("software_projects", project()),
				},
			],
		},
	),
	draftCase(
		"another draft is saved before the batch inserts one",
		d(),
		withOffers([]),
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "another tab saves a draft",
					run: inserting(
						"software_offers",
						offer("draft", 1, {
							id: "other",
							updated_at: "2026-11-13T11:45:00.000Z",
						}),
					),
				},
			],
		},
	),
	draftCase(
		"another writer takes the version before the batch inserts it",
		d(),
		withOffers([]),
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "a withdrawn offer takes version 1",
					run: inserting(
						"software_offers",
						offer("withdrawn", 1, { id: "other" }),
					),
				},
			],
		},
	),
	draftCase(
		"the draft changes before the batch updates it",
		d({ expectedUpdatedAt: EARLIER }),
		withDraft(),
		{
			interleave: [
				{
					on: /UPDATE software_offers SET terms_json/,
					label: "another tab saves the draft",
					run: running(
						"UPDATE software_offers SET updated_at='2026-11-13T11:45:00.000Z'",
					),
				},
			],
		},
	),
	draftCase(
		"the draft is sent before the batch updates it",
		d({ expectedUpdatedAt: EARLIER }),
		withDraft(),
		{
			interleave: [
				{
					on: /UPDATE software_offers SET terms_json/,
					label: "the draft is sent",
					run: running("UPDATE software_offers SET status='sent'"),
				},
			],
		},
	),
	draftCase(
		"the draft is removed before the batch updates it",
		d({ expectedUpdatedAt: EARLIER }),
		withDraft(),
		{
			interleave: [
				{
					on: /UPDATE software_offers SET terms_json/,
					label: "the draft is withdrawn",
					run: running("UPDATE software_offers SET status='withdrawn'"),
				},
			],
		},
	),
	draftCase(
		"the metadata row is removed before an attachment is pinned",
		d({ agreementDetails: details({ attachments: [attachment()] }) }),
		withAttachmentRow(),
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "the metadata is deleted",
					run: running("DELETE FROM software_agreement_attachments"),
				},
			],
		},
	),
	draftCase(
		"an MSA that a draft reuses is deleted before the batch",
		d({ reusedMsaId: MSA_ID, confirmMsaReuse: true }),
		{
			owner_requests: [request()],
			...rows.agreementBase(),
			software_agreements: [executedMsa()],
		},
		{
			interleave: [
				{
					on: /INSERT INTO software_offers/,
					label: "the MSA is deleted",
					run: running("DELETE FROM software_agreements"),
				},
			],
		},
	),
];

const sequenceCases: Case[] = [
	{
		name: "save, update with the saved time, then a stale update",
		music: { seed: withOffers([]) },
		steps: [
			step(d()),
			step(
				d({
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					terms: terms({ summary: "Second." }),
				}),
				{ advanceMs: 5000 },
			),
			step(
				d({
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					terms: terms({ summary: "Third." }),
				}),
				{ advanceMs: 5000 },
			),
		],
	},
	{
		name: "two saves in the same millisecond",
		music: { seed: withOffers([]) },
		steps: [
			step(d()),
			step(
				d({
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					terms: terms({ summary: "Second." }),
				}),
			),
		],
	},
	{
		name: "save a draft with details and an attachment, then clear the details and remove the attachment",
		music: { seed: withAttachmentRow(), ...bucket },
		steps: [
			step(
				d({ agreementDetails: details({ attachments: [attachment()] }) }),
				dumpWithFiles,
			),
			step(
				d({
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					agreementDetails: null,
					removedAttachmentKeys: [ATTACHMENT_KEY],
				}),
				{ advanceMs: 5000, ...dumpWithFiles },
			),
		],
	},
	{
		name: "save the same terms twice with the saved time",
		music: { seed: withOffers([]) },
		steps: [
			step(d()),
			step(d({ expectedUpdatedAt: "2026-11-13T12:00:00.000Z" }), {
				advanceMs: 1000,
			}),
			step(d({ expectedUpdatedAt: "2026-11-13T12:00:01.000Z" }), {
				advanceMs: 1000,
			}),
		],
	},
	{
		name: "a draft, an invalid update, then a valid update",
		music: { seed: withOffers([]) },
		steps: [
			step(d()),
			step(
				d({
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					terms: terms({ outcome: "" }),
				}),
				{ advanceMs: 1000 },
			),
			step(d({ expectedUpdatedAt: "2026-11-13T12:00:00.000Z" }), {
				advanceMs: 1000,
			}),
		],
	},
	{
		name: "a draft after the request is resolved is refused, then allowed after it is reopened",
		music: { seed: withOffers([]) },
		steps: [
			step(d(), {
				before: {
					label: "the request is resolved",
					run: (world) =>
						world.music.exec("UPDATE owner_requests SET status='resolved'"),
				},
			}),
			step(d(), {
				advanceMs: 1000,
				before: {
					label: "the request is reopened",
					run: (world) =>
						world.music.exec("UPDATE owner_requests SET status='reviewed'"),
				},
			}),
		],
	},
];

const cases: Case[] = [
	...guardsCases,
	...termsCases,
	...stateCases,
	...detailsCases,
	...attachmentCases,
	...signedCases,
	...raceCases,
	...sequenceCases,
];

defineCorpus("owner-request-software-offer-draft", POST, cases);
