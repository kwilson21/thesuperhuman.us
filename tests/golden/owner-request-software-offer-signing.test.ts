import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	ATTACHMENT_KEY,
	attachment,
	attachmentBucket,
	attachmentRow,
	client,
	contractor,
	contractorConfig,
	details,
	EARLIER,
	executedMsa,
	inserting,
	mail,
	milestone,
	MSA_ID,
	MSA_PDF_KEY,
	PDF_BYTES,
	msaBucket,
	NOW,
	offer,
	offerTables,
	readyArtifact,
	refused,
	request,
	revokedLink,
	running,
	SECOND_KEY,
	sha256Of,
	signingOn,
	template,
	terms,
} from "./areas/software-offers";
import {
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonObject, JsonValue } from "../helpers/json";

// The golden corpus for the send action of POST /api/owner/requests/[id]/software with signing on: before the offer goes
// out, the route validates the draft's agreement details against its terms, reads the current MSA and SOW templates and the
// contractor details, checks a reused MSA, checks every attachment against its metadata row and its bytes in R2, renders the
// whole agreement packet once to prove it fits (preflightAgreementPacket, real PDF code), and pins the details, template ids,
// contractor snapshot and the client's lower-cased email on the offer in the send batch. Offers with signing off, and the
// parts of sending that do not depend on signing, are in owner-request-software-offer-send. The draft action with agreement
// details is in owner-request-software-offer-draft.
//
// Every response branch that only signing reaches, and the cases that reach it:
//
//   200 {ok:true,...}       a standard offer, an invoice offer, three milestones with checkpoints, one and two attachments,
//                           a reused MSA, a request email seeded in capitals by hand (the app stores it lower-cased and trimmed; the send batch lower-cases it again); a sent offer
//                           reissued (nothing is validated again; the email says to sign on the website only when the offer
//                           has a pinned MSA template); signing off with agreement details that are not valid
//   400 {ok:false,message:"Complete and validate Agreement details before sending.",errors?}  every failure inside the
//                           signing block: details missing, null, not JSON, or with an unknown key; a date that is not a
//                           date; an end before the start or a period over 90 days; milestone dates out of order or a
//                           milestone count that differs from the terms; an invoice offer without a first-milestone
//                           duration, or one longer than the milestone; checkpoint criteria or evidence missing; a review
//                           period over 30 days not confirmed; retention and handoff texts that do not name the days; more
//                           than five attachments or over 25 MiB; details over 64 KiB; contractor details of the wrong shape,
//                           with an extra key or with the registered agent unconfirmed; an attachment with no metadata row,
//                           missing in R2, of another size, with another hash, with a R2 read that throws, with no R2
//                           binding or that is not a PDF; characters the packet font cannot draw, in the details or in the
//                           contractor details (the preflight refuses them); a reused MSA whose signed copy has no
//                           artifact record, is not in R2, has another hash or is not a PDF; and every database outage in
//                           these steps (reported as this same message, with no errors). ZodError failures carry errors keyed
//                           "agreement.<path>"; every other failure carries the message alone
//   400 "Publish both templates and complete contractor details before sending."  no MSA template, no SOW template or no
//                           contractor details
//   409 "The confirmed MSA is unavailable for this recipient."  the reused MSA is missing, not executed, terminated, closed,
//                           has no ready artifact, or belongs to another recipient
//   409 generic             an attachment guard fails in the batch (the metadata row deleted, or the attachment named in a
//                           closed archive) after validation passed
//   effects: reads (signing setting, templates, contractor config, reused MSA, attachment metadata), R2 get and a hash per
//   attachment, the batch (attachment guards, the offer pinned with its snapshots), Resend POSTs, the live-link read.

const sendBody: JsonObject = {
	action: "send",
	version: 1,
	expectedUpdatedAt: EARLIER,
};

const SIGN_TABLES = [...offerTables, "software_agreement_artifacts"];

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, { dump: { music: SIGN_TABLES }, ...extra });

type SignOptions = {
	/** Columns of the draft offer. */
	offer?: SeedRow;
	request?: SeedRow;
	/** Replaces the templates, contractor details and client, as seeded. */
	base?: Seed;
	/** Seed an executed MSA with a ready artifact (columns to override on each). */
	msa?: { agreement?: SeedRow; artifact?: SeedRow } | true;
	attachments?: readonly SeedRow[];
	extra?: Seed;
};

const defaultBase = () => ({
	software_agreement_templates: [template("msa"), template("sow")],
	software_contractor_config: [contractorConfig()],
	software_agreement_clients: [client()],
});

/** A request with a draft offer v1 carrying valid agreement details, and what signing needs. */
const signSeed = ({
	offer: over = {},
	request: req = {},
	base,
	msa,
	attachments,
	extra,
}: SignOptions = {}): Seed => {
	const msaRows: Seed =
		msa === undefined
			? {}
			: {
					software_agreements: [executedMsa(msa === true ? {} : msa.agreement)],
					software_agreement_artifacts: [
						readyArtifact(msa === true ? {} : msa.artifact),
					],
				};

	const attachmentRows = {
		software_agreement_attachments: attachments ?? [],
	};

	return {
		...(base ?? defaultBase()),
		owner_requests: [request(req)],
		...msaRows,
		...attachmentRows,
		software_offers: [
			offer("draft", 1, {
				agreement_details_json: JSON.stringify(details()),
				...over,
			}),
		],
		...extra,
	};
};

const withTerms = (value: JsonValue): SeedRow => ({
	terms_json: JSON.stringify(value),
});

const withDetails = (value: JsonValue): SeedRow => ({
	agreement_details_json: JSON.stringify(value),
});

/** Stored details that are not JSON at all. */
const NOT_JSON: SeedRow = { agreement_details_json: "{bad" };

const signCase = (
	name: string,
	seed: ReturnType<typeof signSeed> = signSeed(),
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	fetches: mail(),
	setup: signingOn,
	steps: [step(sendBody, over)],
	...extra,
});

const detailsCase = (name: string, value: JsonValue, over: SeedRow = {}) =>
	signCase(name, signSeed({ offer: { ...withDetails(value), ...over } }));

const invoiceTerms = terms({ paymentMode: "invoice" });

const threeMilestoneTerms = terms({
	milestones: [
		milestone({ checkpoint: { label: "Mid review", cancellationPercent: 60 } }),
		milestone({ name: "Two", deliverables: ["Two view"] }),
		milestone({
			name: "Three",
			deliverables: ["Three view"],
			checkpoint: { label: "Final review", cancellationPercent: 90 },
		}),
	],
});

const threeMilestoneDetails = details({
	milestones: [
		{
			start: "2026-12-01",
			target: "2026-12-07",
			handoff: "Source one",
			checkpoint_criteria: "Demo accepted",
			checkpoint_evidence: "Recording",
		},
		{ start: "2026-12-08", target: "2026-12-14", handoff: "Source two" },
		{
			start: "2026-12-15",
			target: "2026-12-20",
			handoff: "Source three",
			checkpoint_criteria: "Final accepted",
			checkpoint_evidence: "Signed note",
		},
	],
});

const withAttachment = (over: SignOptions = {}, row: SeedRow = {}) =>
	signSeed({
		offer: withDetails(details({ attachments: [attachment()] })),
		attachments: [attachmentRow(row)],
		...over,
	});

const bucket = { r2: attachmentBucket };

const dumpFiles: Partial<Step> = { dump: { music: SIGN_TABLES, r2: true } };

const onBatch = /INSERT INTO software_offer_links/;

const cases: Case[] = [
	// success
	signCase("a standard offer with valid details"),
	signCase(
		"an invoice offer with a first-milestone duration",
		signSeed({
			offer: {
				...withTerms(invoiceTerms),
				...withDetails(details({ invoice_first_duration: 14 })),
			},
		}),
	),
	signCase(
		"an invoice offer with a first-milestone duration of exactly the milestone's days",
		signSeed({
			offer: {
				...withTerms(invoiceTerms),
				...withDetails(details({ invoice_first_duration: 20 })),
			},
		}),
	),
	signCase(
		"three milestones with two checkpoints",
		signSeed({
			offer: {
				...withTerms(threeMilestoneTerms),
				...withDetails(threeMilestoneDetails),
			},
		}),
	),
	signCase(
		"details that fill every optional field",
		signSeed({
			offer: withDetails(
				details({
					update_channel: "Email",
					visual_approvals: "Home page",
					review_business_days: 40,
					longer_review_confirmed: true,
					correction_calendar_days: 60,
					po_requirement: "before_start",
					expenses_taxes: "Client pays tax",
					recurring_charges: "None agreed",
					ai_permission: "No",
					sensitive_addenda: "None",
					support: "30 days",
					msa_changes: "None",
					data_retention: "Kept for 90 days",
					project_retention_days: 90,
					handoff_access: "Access for 45 days",
					handoff_access_days: 45,
				}),
			),
		}),
	),
	signCase(
		"a request email seeded in capitals with spaces by hand (cannot arise through the app)",
		signSeed({ request: { email: " Grace@Example.TEST " } }),
	),
	signCase("one attachment", withAttachment(), bucket, dumpFiles),
	signCase(
		"two attachments",
		signSeed({
			offer: withDetails(
				details({
					attachments: [
						attachment(),
						attachment({ key: SECOND_KEY, filename: "Second.pdf" }),
					],
				}),
			),
			attachments: [
				attachmentRow(),
				attachmentRow({
					id: "att2",
					object_key: SECOND_KEY,
					filename: "Second.pdf",
				}),
			],
		}),
		{
			r2: {
				seed: {
					[ATTACHMENT_KEY]: { body: PDF_BYTES },
					[SECOND_KEY]: { body: PDF_BYTES },
				},
			},
		},
		dumpFiles,
	),
	signCase(
		"a reused MSA",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
		{ r2: msaBucket },
		{ dump: { music: SIGN_TABLES, r2: true } },
	),
	signCase(
		"a reused MSA for a request email seeded in capitals by hand (cannot arise through the app)",
		signSeed({
			msa: true,
			offer: { reused_msa_id: MSA_ID },
			request: { email: "GRACE@example.test" },
		}),
		{ r2: msaBucket },
	),
	signCase(
		"a reused MSA whose signed copy is not in R2",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
	),
	signCase(
		"a reused MSA whose signed copy has another hash",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
		{ r2: { seed: { [MSA_PDF_KEY]: { body: "other bytes" } } } },
	),
	signCase(
		"a reused MSA whose signed copy is not a PDF",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
		{
			r2: { seed: { [MSA_PDF_KEY]: { body: "not a pdf" } } },
			setup: (world) => {
				signingOn(world);
				world.music.exec(
					`UPDATE software_agreement_artifacts SET pdf_sha256='${sha256Of("not a pdf")}'`,
				);
			},
		},
	),
	signCase(
		"a reused MSA with no signed copy recorded",
		signSeed({
			msa: { artifact: { pdf_key: null, pdf_sha256: null } },
			offer: { reused_msa_id: MSA_ID },
		}),
	),
	signCase(
		"a reused MSA with an attachment on the new SOW",
		signSeed({
			msa: true,
			offer: {
				reused_msa_id: MSA_ID,
				...withDetails(details({ attachments: [attachment()] })),
			},
			attachments: [attachmentRow()],
		}),
		{
			r2: {
				seed: {
					[MSA_PDF_KEY]: { body: PDF_BYTES },
					[ATTACHMENT_KEY]: { body: PDF_BYTES },
				},
			},
		},
	),
	signCase(
		"the original MSA read fails in the preflight",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
		{
			r2: msaBucket,
			failures: [
				{
					on: /FROM software_agreements WHERE id=\? AND status='executed'/,
					message: "D1 is down",
				},
			],
		},
	),
	signCase(
		"a draft sent over a sent offer with a pinned template",
		{
			...signSeed(),
			software_offers: [
				offer("sent", 1, {
					msa_template_id: "template-msa",
					sow_template_id: "template-sow",
				}),
				offer("draft", 2, {
					agreement_details_json: JSON.stringify(details()),
				}),
			],
			software_offer_links: [rows.offerLink("r1")],
		},
		{},
		{ json: { action: "send", version: 2, expectedUpdatedAt: EARLIER } },
	),
	signCase(
		"a sent offer with a pinned template is reissued without validation",
		{
			...defaultBase(),
			owner_requests: [request()],
			software_offers: [
				offer("sent", 1, {
					msa_template_id: "template-msa",
					sow_template_id: "template-sow",
					agreement_details_json: "{bad",
				}),
			],
			software_offer_links: [revokedLink()],
		},
	),
	signCase("a sent offer with no pinned template is reissued", {
		...defaultBase(),
		owner_requests: [request()],
		software_offers: [offer("sent")],
		software_offer_links: [revokedLink()],
	}),
	signCase("signing on with the email refused", signSeed(), {
		fetches: mail(refused),
	}),
	// details
	detailsCase("details that are null", null),
	signCase(
		"no details saved",
		signSeed({ offer: { agreement_details_json: null } }),
	),
	signCase("details that are not JSON", signSeed({ offer: NOT_JSON })),
	detailsCase("details that are an empty object", {}),
	detailsCase("details that are a text", "details"),
	detailsCase("details with an unknown key", { ...details(), extra: "x" }),
	detailsCase(
		"a planned start that is not a date",
		details({ planned_start: "2026-02-30" }),
	),
	detailsCase(
		"a planned end before the planned start",
		details({ planned_end: "2026-11-30" }),
	),
	detailsCase(
		"a period of 90 days",
		details({
			planned_end: "2027-02-28",
			milestones: [
				{ start: "2026-12-01", target: "2027-02-28", handoff: "Source" },
			],
		}),
	),
	detailsCase(
		"a period of 89 days",
		details({
			planned_end: "2027-02-27",
			milestones: [
				{ start: "2026-12-01", target: "2027-02-27", handoff: "Source" },
			],
		}),
	),
	detailsCase(
		"a milestone that starts before the period",
		details({
			milestones: [
				{ start: "2026-11-30", target: "2026-12-20", handoff: "Source" },
			],
		}),
	),
	detailsCase(
		"a milestone that ends after the period",
		details({
			milestones: [
				{ start: "2026-12-01", target: "2026-12-21", handoff: "Source" },
			],
		}),
	),
	detailsCase(
		"a milestone whose target is before its start",
		details({
			milestones: [
				{ start: "2026-12-10", target: "2026-12-05", handoff: "Source" },
			],
		}),
	),
	detailsCase("no milestones in the details", details({ milestones: [] })),
	detailsCase(
		"two milestones in the details for one in the terms",
		details({
			milestones: [
				{ start: "2026-12-01", target: "2026-12-10", handoff: "A" },
				{ start: "2026-12-11", target: "2026-12-20", handoff: "B" },
			],
		}),
	),
	detailsCase(
		"a milestone with no handoff",
		details({ milestones: [{ start: "2026-12-01", target: "2026-12-20" }] }),
	),
	detailsCase("an environment of only spaces", details({ environment: "   " })),
	detailsCase(
		"an environment with a control character",
		details({ environment: "a\u0007b" }),
	),
	detailsCase(
		"an update rhythm of 501 characters",
		details({ update_rhythm: "u".repeat(501) }),
	),
	detailsCase(
		"a review period of 31 days that is not confirmed",
		details({ review_business_days: 31 }),
	),
	detailsCase(
		"a review period of 4 days",
		details({ review_business_days: 4 }),
	),
	detailsCase(
		"a data retention text that does not name the days",
		details({ data_retention: "Kept a while", project_retention_days: 90 }),
	),
	detailsCase(
		"a default data retention with 90 days",
		details({ project_retention_days: 90 }),
	),
	detailsCase(
		"a handoff text that does not name the days",
		details({ handoff_access: "Some access", handoff_access_days: 60 }),
	),
	detailsCase(
		"a default handoff with 60 days",
		details({ handoff_access_days: 60 }),
	),
	detailsCase(
		"six attachments",
		details({ attachments: Array.from({ length: 6 }, () => attachment()) }),
	),
	detailsCase(
		"attachments over 25 MiB together",
		details({
			attachments: [
				attachment({ bytes: 10 * 1024 * 1024 }),
				attachment({ key: SECOND_KEY, bytes: 10 * 1024 * 1024 }),
				attachment({
					key: "agreements/attachments/00000000-0000-4000-8000-000000000003.pdf",
					bytes: 6 * 1024 * 1024,
				}),
			],
		}),
	),
	detailsCase(
		"details larger than 64 KiB",
		details({ environment: "e".repeat(4000), extra_note: "x".repeat(66_000) }),
	),
	detailsCase(
		"an invoice offer with no first-milestone duration",
		details(),
		withTerms(invoiceTerms),
	),
	detailsCase(
		"an invoice offer with a duration longer than the milestone",
		details({ invoice_first_duration: 21 }),
		withTerms(invoiceTerms),
	),
	detailsCase(
		"an invoice offer with a duration of 91 days",
		details({ invoice_first_duration: 91 }),
		withTerms(invoiceTerms),
	),
	detailsCase(
		"a checkpoint with no criteria",
		details(),
		withTerms(
			terms({
				milestones: [
					milestone({
						checkpoint: { label: "Review", cancellationPercent: 60 },
					}),
				],
			}),
		),
	),
	detailsCase(
		"a checkpoint with criteria and no evidence",
		details({
			milestones: [
				{
					start: "2026-12-01",
					target: "2026-12-20",
					handoff: "Source",
					checkpoint_criteria: "Demo",
				},
			],
		}),
		withTerms(
			terms({
				milestones: [
					milestone({
						checkpoint: { label: "Review", cancellationPercent: 60 },
					}),
				],
			}),
		),
	),
	detailsCase(
		"details with accents and markup",
		details({
			environment: `<b>Café</b> & "q" 'x'`,
			operating_responsibilities: "Client <script>alert(1)</script>",
		}),
	),
	detailsCase(
		"details with Japanese text the packet font cannot draw",
		details({ environment: "ブラウザ" }),
	),
	detailsCase(
		"details with an emoji the packet font cannot draw",
		details({ environment: "Browser 🙂" }),
	),
	// contractor and templates
	signCase(
		"no contractor details",
		signSeed({
			base: {
				software_agreement_templates: [template("msa"), template("sow")],
				software_agreement_clients: [client()],
			},
		}),
	),
	signCase(
		"no MSA template",
		signSeed({
			base: {
				software_agreement_templates: [template("sow")],
				software_contractor_config: [contractorConfig()],
				software_agreement_clients: [client()],
			},
		}),
	),
	signCase(
		"no SOW template",
		signSeed({
			base: {
				software_agreement_templates: [template("msa")],
				software_contractor_config: [contractorConfig()],
				software_agreement_clients: [client()],
			},
		}),
	),
	signCase(
		"no templates and no contractor details",
		signSeed({ base: { software_agreement_clients: [client()] } }),
	),
	signCase(
		"contractor details that are an empty object",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [contractorConfig({}, {})],
			},
		}),
	),
	signCase(
		"contractor details with an extra key",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [
					contractorConfig({}, { ...contractor, extra: "x" }),
				],
			},
		}),
	),
	signCase(
		"contractor details with the registered agent unconfirmed",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [
					contractorConfig(
						{},
						{ ...contractor, registered_agent_confirmed: false },
					),
				],
			},
		}),
	),
	signCase(
		"contractor details that are a text",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [
					{ ...contractorConfig(), values_json: '"text"' },
				],
			},
		}),
	),
	signCase(
		"contractor details with Japanese text the packet font cannot draw",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [
					contractorConfig({}, { ...contractor, legal_name: "株式会社" }),
				],
			},
		}),
	),
	signCase(
		"the newest of two contractor versions is used",
		signSeed({
			base: {
				...defaultBase(),
				software_contractor_config: [
					contractorConfig(),
					contractorConfig(
						{ version: 2 },
						{ ...contractor, legal_name: "Newer LLC" },
					),
				],
			},
		}),
	),
	signCase(
		"the newest of two template versions is used",
		signSeed({
			base: {
				...defaultBase(),
				software_agreement_templates: [
					template("msa"),
					template("sow"),
					template("msa", {
						id: "template-msa-2",
						version: 2,
						version_label: "v2",
					}),
				],
			},
		}),
	),
	// reused MSA
	signCase("a reused MSA that does not exist", signSeed({ offer: {} }), {
		setup: (world) => {
			signingOn(world);
			world.music.exec("PRAGMA foreign_keys=OFF");
			world.music.exec(`UPDATE software_offers SET reused_msa_id='${MSA_ID}'`);
		},
	}),
	signCase(
		"a reused MSA that is not executed",
		signSeed({
			msa: { agreement: { status: "client_signed" } },
			offer: { reused_msa_id: MSA_ID },
		}),
	),
	signCase(
		"a reused MSA that was terminated",
		signSeed({
			msa: { agreement: { terminated_at: EARLIER } },
			offer: { reused_msa_id: MSA_ID },
		}),
	),
	signCase(
		"a reused MSA whose archive is closed",
		signSeed({
			msa: { agreement: { archive_closed_at: EARLIER } },
			offer: { reused_msa_id: MSA_ID },
		}),
	),
	signCase(
		"a reused MSA whose artifact is not ready",
		signSeed({
			msa: { artifact: { status: "pending" } },
			offer: { reused_msa_id: MSA_ID },
		}),
	),
	signCase(
		"a reused MSA of another recipient",
		signSeed({
			msa: true,
			offer: { reused_msa_id: MSA_ID },
			request: { email: "other@example.test" },
		}),
	),
	// attachments
	signCase(
		"an attachment with no metadata row",
		withAttachment({ attachments: [] }),
		bucket,
		dumpFiles,
	),
	signCase(
		"an attachment whose metadata row names another file",
		withAttachment({}, { filename: "Other.pdf" }),
		bucket,
		dumpFiles,
	),
	signCase("an attachment that is not in R2", withAttachment(), {}, dumpFiles),
	signCase(
		"an attachment of another size in R2",
		withAttachment(),
		{
			r2: {
				seed: { [ATTACHMENT_KEY]: { body: new Uint8Array([...PDF_BYTES, 0]) } },
			},
		},
		dumpFiles,
	),
	signCase(
		"an attachment with other bytes of the same size in R2",
		withAttachment(),
		{
			r2: {
				seed: { [ATTACHMENT_KEY]: { body: PDF_BYTES.map((byte) => byte ^ 1) } },
			},
		},
		dumpFiles,
	),
	signCase(
		"an attachment whose R2 read throws",
		withAttachment(),
		{ r2: { ...attachmentBucket, fails: ["get"] } },
		dumpFiles,
	),
	signCase(
		"an attachment with no R2 binding",
		withAttachment(),
		{ r2: { missing: true } },
		dumpFiles,
	),
	signCase(
		"an attachment that is not a PDF but matches its recorded hash",
		signSeed({
			offer: withDetails(
				details({
					attachments: [
						attachment({ sha256: sha256Of("not a pdf"), bytes: 9 }),
					],
				}),
			),
			attachments: [attachmentRow({ sha256: sha256Of("not a pdf"), bytes: 9 })],
		}),
		{ r2: { seed: { [ATTACHMENT_KEY]: { body: "not a pdf" } } } },
		dumpFiles,
	),
	// races on the batch
	signCase(
		"the attachment's metadata row is deleted before the batch",
		withAttachment(),
		{
			...bucket,
			interleave: [
				{
					on: onBatch,
					label: "the metadata is deleted",
					run: running("DELETE FROM software_agreement_attachments"),
				},
			],
		},
		dumpFiles,
	),
	signCase(
		"the attachment is named in a closed archive before the batch",
		withAttachment(),
		{
			...bucket,
			interleave: [
				{
					on: onBatch,
					label: "an archive closes over the attachment",
					run: inserting(
						"software_agreements",
						rows.agreement("a1", "r1", "o1", {
							status: "abandoned",
							attachment_manifest_json: JSON.stringify([
								{ key: ATTACHMENT_KEY },
							]),
							archive_closed_at: EARLIER,
						}),
					),
				},
			],
		},
		dumpFiles,
	),
	signCase(
		"a newer template is published while the offer is sent",
		signSeed(),
		{
			interleave: [
				{
					on: onBatch,
					label: "a newer MSA is published",
					run: inserting(
						"software_agreement_templates",
						template("msa", {
							id: "template-msa-2",
							version: 2,
							version_label: "v2",
						}),
					),
				},
			],
		},
	),
	signCase(
		"a newer contractor version is saved while the offer is sent",
		signSeed(),
		{
			interleave: [
				{
					on: onBatch,
					label: "contractor details change",
					run: inserting(
						"software_contractor_config",
						contractorConfig(
							{ version: 2 },
							{ ...contractor, legal_name: "Newer LLC" },
						),
					),
				},
			],
		},
	),
	signCase("the request changes before the batch", signSeed(), {
		interleave: [
			{
				on: onBatch,
				label: "another change moves updated_at",
				run: running(
					"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
				),
			},
		],
	}),
	// outages
	signCase("the signing setting read fails", signSeed(), {
		failures: [{ on: /FROM software_signing_settings/, message: "D1 is down" }],
	}),
	signCase("the template read fails", signSeed(), {
		failures: [
			{
				on: /FROM software_agreement_templates WHERE kind=\? ORDER BY version DESC/,
				message: "D1 is down",
			},
		],
	}),
	signCase("the second template read fails", signSeed(), {
		failures: [
			{
				on: /FROM software_agreement_templates WHERE kind=\? ORDER BY version DESC/,
				nth: 2,
				message: "D1 is down",
			},
		],
	}),
	signCase("the contractor read fails", signSeed(), {
		failures: [
			{ on: /FROM software_contractor_config/, message: "D1 is down" },
		],
	}),
	signCase(
		"the reused MSA read fails",
		signSeed({ msa: true, offer: { reused_msa_id: MSA_ID } }),
		{
			failures: [
				{
					on: /FROM software_agreements a JOIN software_agreement_clients c/,
					message: "D1 is down",
				},
			],
		},
	),
	signCase(
		"the attachment metadata read fails",
		withAttachment(),
		{
			...bucket,
			failures: [
				{
					on: /^SELECT 1 FROM software_agreement_attachments/,
					message: "D1 is down",
				},
			],
		},
		dumpFiles,
	),
	signCase("the send batch fails", signSeed(), {
		failures: [{ on: onBatch, message: "D1 is down" }],
	}),
	// signing off
	{
		name: "signing off with details that are not valid: nothing is validated",
		music: { seed: signSeed({ offer: NOT_JSON }) },
		fetches: mail(),
		steps: [step(sendBody)],
	},
	// sequences
	{
		name: "save details with an attachment, then send, then revoke and reissue",
		music: {
			seed: {
				...defaultBase(),
				owner_requests: [request()],
				software_agreement_attachments: [attachmentRow()],
				software_offers: [offer("draft", 1)],
			},
		},
		fetches: mail(),
		setup: signingOn,
		r2: attachmentBucket,
		steps: [
			step(
				{
					action: "draft",
					terms: terms(),
					expectedUpdatedAt: EARLIER,
					agreementDetails: details({ attachments: [attachment()] }),
				},
				{ ...dumpFiles },
			),
			step(
				{ action: "send", version: 1, expectedUpdatedAt: NOW },
				{ advanceMs: 1000, ...dumpFiles },
			),
			step(
				{ action: "revoke", expectedLinkCreatedAt: "2026-11-13T12:00:01.000Z" },
				{ advanceMs: 21_000, ...dumpFiles },
			),
			step(
				{
					action: "send",
					version: 1,
					expectedUpdatedAt: "2026-11-13T12:00:01.000Z",
				},
				{ advanceMs: 1000, ...dumpFiles },
			),
		],
	},
	{
		name: "save details that fail validation, then send, then fix the details and send again",
		music: {
			seed: {
				...defaultBase(),
				owner_requests: [request()],
				software_offers: [offer("draft", 1)],
			},
		},
		fetches: mail(),
		setup: signingOn,
		steps: [
			step({
				action: "draft",
				terms: terms(),
				expectedUpdatedAt: EARLIER,
				agreementDetails: { planned_start: "soon" },
			}),
			step(
				{ action: "send", version: 1, expectedUpdatedAt: NOW },
				{ advanceMs: 1000 },
			),
			step(
				{
					action: "draft",
					terms: terms(),
					expectedUpdatedAt: "2026-11-13T12:00:00.000Z",
					agreementDetails: details(),
				},
				{ advanceMs: 1000 },
			),
			step(
				{
					action: "send",
					version: 1,
					expectedUpdatedAt: "2026-11-13T12:00:02.000Z",
				},
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "signing is turned off between the save and the send",
		music: { seed: signSeed() },
		fetches: mail(),
		setup: signingOn,
		steps: [
			step(sendBody, {
				before: {
					label: "signing is turned off",
					run: (world) =>
						world.music.exec(
							"UPDATE software_signing_settings SET software_signing_enabled=0",
						),
				},
			}),
		],
	},
	{
		name: "details that fail validation, then valid details saved by another tab, then a second send",
		music: {
			seed: signSeed({ offer: withDetails({ planned_start: "soon" }) }),
		},
		fetches: mail(),
		setup: signingOn,
		steps: [
			step(sendBody),
			step(sendBody, {
				advanceMs: 1000,
				before: {
					label: "another tab saves valid details",
					run: (world) =>
						world.music.exec(
							`UPDATE software_offers SET agreement_details_json='${JSON.stringify(details())}'`,
						),
				},
			}),
		],
	},
];

defineCorpus("owner-request-software-offer-signing", POST, cases);
