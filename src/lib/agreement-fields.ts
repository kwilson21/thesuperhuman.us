import type { ClientAgreement } from "./agreement-client-fields";
import {
	cleanTextField,
	requiredField,
	zodSentences,
} from "./agreement-client-fields";
import type { RawValue } from "./fields";
import { validProjectDate } from "./audio-project-updates";
import {
	alwaysTrue,
	dateText,
	emailText,
	integer,
	list,
	nullable,
	oneOf,
	parseWith,
	patternText,
	readWith,
	record,
	refined,
	text,
	truth,
	type Value,
	withDefault,
} from "./readers";
import { softwareInvoiceTerms } from "./software-invoices";
import { formatUSD, offerTotal, type OfferTerms } from "./software-offers";
import { ReaderMessage } from "./reader-message";

// The owner agreement details and the contractor's details, read with Effect Schema (src/lib/readers.ts). Their failures
// are shown to the owner word for word, so they keep the sentences, the paths, the order and the stopping rules Zod 3
// gave them, which tests/server/validators-differential.test.ts holds them to.

const date = dateText(validProjectDate, "Choose a valid date.");

/** Required text of at most `max` characters, trimmed and normalised. */
const required = (max: number) => text(requiredField(max, zodSentences), true);

/** Text of at most `max` characters, trimmed and normalised, that may be blank. */
const clean = (max: number) => text(cleanTextField(max, zodSentences), false);

const contractorReader = record(
	{
		legal_name: required(200),
		entity_jurisdiction: required(200),
		signer_name: required(200),
		signer_title: required(200),
		notice_email: emailText,
		business_address: required(1000),
		registered_agent_confirmed: alwaysTrue,
	},
	{ strict: true },
);

export type Contractor = Value<typeof contractorReader>;

/** The contractor's details, or a thrown `FieldsRefused` that lists every failed field. */
export function parseContractor(input: RawValue): Contractor {
	return parseWith(contractorReader, input);
}

export function readContractor(input: RawValue) {
	return readWith(contractorReader, input);
}

const attachmentReader = record(
	{
		filename: required(200),
		version: required(80),
		date,
		sha256: patternText(/^[a-f0-9]{64}$/),
		key: patternText(/^agreements\/attachments\/[a-f0-9-]+\.pdf$/),
		bytes: integer(["int", { above: 0 }, { most: 10 * 1024 * 1024 }]),
	},
	{ strict: true },
);

const attachmentsReader = withDefault(list(attachmentReader, { max: 5 }), []);

/** The attachments of the details (up to five, each strict), or a thrown `FieldsRefused`; missing reads as none. */
export function parseAgreementAttachments(input: RawValue) {
	return parseWith(attachmentsReader, input);
}

const detailsReader = refined(
	record(
		{
			planned_start: date,
			planned_end: date,
			environment: required(4000),
			operating_responsibilities: required(4000),
			update_channel: withDefault(
				required(500),
				"Private project page and email",
			),
			update_rhythm: required(500),
			milestones: list(
				record(
					{
						start: date,
						target: date,
						handoff: required(4000),
						checkpoint_criteria: withDefault(clean(4000), "None"),
						checkpoint_evidence: withDefault(clean(4000), "None"),
					},
					{ strict: true },
				),
				{ min: 1, max: 3 },
			),
			visual_approvals: withDefault(clean(4000), "None"),
			invoice_first_duration: withDefault(
				nullable(integer(["int", { above: 0 }, { most: 90 }])),
				null,
			),
			review_business_days: withDefault(
				integer(["int", { least: 5 }, { most: 365 }]),
				5,
			),
			longer_review_confirmed: withDefault(truth, false),
			correction_calendar_days: withDefault(
				integer(["int", { least: 30 }, { most: 365 }]),
				30,
			),
			po_requirement: withDefault(
				oneOf(["not_required", "before_start"]),
				"not_required",
			),
			expenses_taxes: withDefault(clean(4000), "None"),
			recurring_charges: withDefault(clean(4000), "None"),
			ai_permission: withDefault(clean(4000), "None"),
			sensitive_addenda: withDefault(clean(4000), "None"),
			support: withDefault(clean(4000), "None"),
			msa_changes: withDefault(clean(4000), "None"),
			data_retention: withDefault(
				clean(4000),
				"MSA default, including one year for the private project page",
			),
			project_retention_days: withDefault(
				integer(["int", { least: 1 }, { most: 3650 }]),
				365,
			),
			handoff_access: withDefault(clean(4000), "MSA default"),
			handoff_access_days: withDefault(
				integer(["int", { least: 30 }, { most: 3650 }]),
				30,
			),
			attachments: attachmentsReader,
		},
		{ strict: true },
	),
	(v, issue) => {
		const span =
			(Date.parse(v.planned_end) - Date.parse(v.planned_start)) / 86400000;

		if (span < 0 || span > 89)
			issue("planned_end", "Use a period of up to 90 calendar days.");
		let previous = v.planned_start;
		v.milestones.forEach((m, i) => {
			if (m.start < previous || m.target < m.start || m.target > v.planned_end)
				issue(
					`milestones.${i}.target`,
					"Dates must be ordered within the planned period.",
				);
			previous = m.target;
		});

		if (v.review_business_days > 30 && !v.longer_review_confirmed)
			issue("longer_review_confirmed", "Confirm the longer review period.");

		if (
			v.data_retention !==
				"MSA default, including one year for the private project page" &&
			!new RegExp(
				`(?<![\\p{L}\\p{N}.])${v.project_retention_days}(?![\\p{L}\\p{N}.])`,
				"u",
			).test(v.data_retention)
		)
			issue("data_retention", "State the agreed project page period in days.");

		if (
			v.handoff_access !== "MSA default" &&
			!new RegExp(
				`(?<![\\p{L}\\p{N}.])${v.handoff_access_days}(?![\\p{L}\\p{N}.])`,
				"u",
			).test(v.handoff_access)
		)
			issue("handoff_access", "State the agreed handoff period in days.");

		if (
			v.data_retention ===
				"MSA default, including one year for the private project page" &&
			v.project_retention_days !== 365
		)
			issue("project_retention_days", "The default is one year.");

		if (v.handoff_access === "MSA default" && v.handoff_access_days !== 30)
			issue("handoff_access_days", "The default is 30 days.");

		if (v.attachments.reduce((s, a) => s + a.bytes, 0) > 25 * 1024 * 1024)
			issue("attachments", "Keep attachments under 25 MiB combined.");
	},
);

export type AgreementDetails = Value<typeof detailsReader>;

/** The agreement details, or a thrown `FieldsRefused` that lists every failed field. */
export function parseAgreementDetails(input: RawValue): AgreementDetails {
	return parseWith(detailsReader, input);
}

export function readAgreementDetails(input: RawValue) {
	return readWith(detailsReader, input);
}

export function validateAgreementDetails(input: RawValue, terms: OfferTerms) {
	if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
		throw new ReaderMessage("Agreement details exceed 64 KiB.");
	const v = parseAgreementDetails(input);

	if (v.milestones.length !== terms.milestones.length)
		throw new ReaderMessage("Complete details for every purchased milestone.");

	if (
		terms.paymentMode === "invoice" &&
		(!v.invoice_first_duration ||
			v.invoice_first_duration >
				(Date.parse(v.milestones[0].target) -
					Date.parse(v.milestones[0].start)) /
					86400000 +
					1)
	)
		throw new ReaderMessage(
			"Enter a first-milestone duration within its planned dates.",
		);
	terms.milestones.forEach((m, i) => {
		if (
			m.checkpoint &&
			[
				v.milestones[i].checkpoint_criteria,
				v.milestones[i].checkpoint_evidence,
			].some((x) => !x || x === "None")
		)
			throw new ReaderMessage("Checkpoint criteria and evidence are required.");
	});

	return v;
}

export const signatureReference =
	"Signature recorded in the signing certificate for this document.";

export function agreementValues(
	terms: OfferTerms,
	details: AgreementDetails,
	client: ClientAgreement,
	contractor: Contractor & { config_version?: number },
	system: {
		effective_on: string;
		msa_version: string;
		sow_number: string;
		offer_version: number;
		template_version: number;
		msa_version_label: string;
		msa_source_revision: string;
		sow_version_label: string;
		sow_source_revision: string;
	},
) {
	const amounts = terms.milestones.map((m, i) =>
		terms.paymentMode === "standard"
			? `${formatUSD(softwareInvoiceTerms(terms, i, "deposit").amountCents)} deposit / ${formatUSD(softwareInvoiceTerms(terms, i, "balance").amountCents)} balance`
			: `${formatUSD(m.feeCents)} full invoice`,
	);

	const checkpointAmount = (i: number) =>
		terms.milestones.slice(0, i).reduce((sum, m) => sum + m.feeCents, 0) +
		Math.round(
			(terms.milestones[i].feeCents *
				terms.milestones[i].checkpoint!.cancellationPercent) /
				100,
		);

	const base = {
		client,
		contractor,
		owner: {
			...details,
			po_requirement:
				details.po_requirement === "before_start"
					? "PO number before start"
					: "Not required",
			review_business_days: String(details.review_business_days),
			correction_calendar_days: String(details.correction_calendar_days),
		},
		system: {
			...system,
			offer_version: String(system.offer_version),
			template_version: String(system.template_version),
			signature: signatureReference,
			total: formatUSD(offerTotal(terms)).replace("$", ""),
			payment: terms.paymentMode === "standard" ? "Standard" : "Invoice Terms",
			msa_date_version: system.msa_version,
			attachments:
				details.attachments
					.map(
						(a) =>
							`${a.filename} / ${a.version} / ${a.date} / SHA-256 ${a.sha256}`,
					)
					.join("\n") || "None",
			amount1: amounts[0],
			amount2: amounts[1] || "N/A",
			amount3: amounts[2] || "N/A",
		},
		offer: {
			...terms,
			outcome_summary: `${terms.outcome}\n${terms.summary}`,
			exclusions: terms.exclusions || "None",
			clientInputs: terms.clientInputs || "None",
			estimate: terms.projectRange
				? `${formatUSD(terms.projectRange.lowCents)} to ${formatUSD(terms.projectRange.highCents)} (non-binding)`
				: "None",
		},
		choices: {
			portfolio: client.portfolio === "allow" ? "Allow" : "Do not allow",
			naming: client.naming ? "Yes" : "No",
		},
		milestones: terms.milestones.map((m, i) => ({
			number: String(i + 1),
			name: m.name,
			price: formatUSD(m.feeCents).replace("$", ""),
			start: details.milestones[i].start,
			target: details.milestones[i].target,
			deliverables: m.deliverables.join("\n"),
			acceptance: m.acceptance.join("\n"),
			handoff: details.milestones[i].handoff,
			duration:
				i === 0 && terms.paymentMode === "invoice"
					? `${details.invoice_first_duration} calendar days`
					: "N/A",
			checkpoint: m.checkpoint
				? `${m.checkpoint.label}; ${details.milestones[i].checkpoint_criteria}; ${details.milestones[i].checkpoint_evidence}; cumulative cancellation amount ${formatUSD(checkpointAmount(i))} (${m.checkpoint.cancellationPercent}%, includes prior payments)`
				: "None",
		})),
	};

	return {
		...base,
		contractor: {
			...contractor,
			config_version: String(contractor.config_version ?? 1),
		},
		msa: {
			effective_on: system.msa_version.split(" / ")[0],
			template_version: system.msa_version.split("template ")[1],
			source_revision: system.msa_source_revision,
			version_label: system.msa_version_label,
		},
		signature: {
			client_record: signatureReference,
			contractor_record: signatureReference,
		},
		details: {
			...base.owner,
			invoice_first_duration:
				terms.paymentMode === "invoice"
					? `${details.invoice_first_duration} calendar days`
					: "N/A",
			data_retention: `${details.data_retention} (project page: ${details.project_retention_days} days)`,
			handoff_access: `${details.handoff_access} (${details.handoff_access_days} days)`,
		},
		sow: {
			number: system.sow_number,
			version: String(system.offer_version),
			version_label: system.sow_version_label,
			source_revision: system.sow_source_revision,
			effective_on: system.effective_on,
			project_name: terms.outcome,
			outcome: base.offer.outcome_summary,
			summary: terms.summary,
			exclusions: base.offer.exclusions,
			client_inputs: base.offer.clientInputs,
			timing: terms.timing || "None",
			payment_mode: base.system.payment,
			total_fee: base.system.total,
			project_estimate: base.offer.estimate,
			reviewer_name: client.reviewer_name,
			reviewer_email: client.reviewer_email,
			approver_name: client.approver_name,
			approver_email: client.approver_email,
			portfolio: base.choices.portfolio,
			naming: base.choices.naming,
			attachments: base.system.attachments,
		},
		milestones: base.milestones.map((m, i) => ({
			...m,
			fee: m.price,
			checkpoint_label: terms.milestones[i].checkpoint?.label ?? "None",
			checkpoint_criteria: details.milestones[i].checkpoint_criteria,
			checkpoint_evidence: details.milestones[i].checkpoint_evidence,
			checkpoint_cumulative_amount: terms.milestones[i].checkpoint
				? `${formatUSD(checkpointAmount(i))} (includes prior payments)`
				: "None",
			deposit:
				terms.paymentMode === "standard"
					? formatUSD(softwareInvoiceTerms(terms, i, "deposit").amountCents)
					: "N/A",
			balance:
				terms.paymentMode === "standard"
					? formatUSD(softwareInvoiceTerms(terms, i, "balance").amountCents)
					: "N/A",
			invoice_amount:
				terms.paymentMode === "invoice"
					? formatUSD(terms.milestones[i].feeCents)
					: "N/A",
		})),
	};
}

/** The part of the agreementValues result that artifact and PDF code reads back from values_json. Older rows lack the label and revision fields. */
export type StoredAgreementValues = {
	msa?: { version_label?: string; source_revision?: string };
	sow?: { version_label?: string; source_revision?: string };
};
