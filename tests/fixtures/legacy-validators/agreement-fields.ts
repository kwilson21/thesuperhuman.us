// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion (PR 7 of the
// Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect version to answer
// every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: the type `OfferTerms` and `RawValue` only. The date check, the text helpers and every schema are frozen.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";
import type { OfferTerms } from "../../../src/lib/software-offers";
import {
	legacyCleanText,
	legacyEmail,
	legacyRequired,
} from "./agreement-client-fields";

// Frozen from audio-project-updates.ts: the date check the schemas call.
function legacyValidProjectDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00Z`);

	return (
		!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
	);
}

const date = z.string().refine(legacyValidProjectDate, "Choose a valid date.");

export const legacyContractorSchema = z
	.object({
		legal_name: legacyRequired(200),
		entity_jurisdiction: legacyRequired(200),
		signer_name: legacyRequired(200),
		signer_title: legacyRequired(200),
		notice_email: legacyEmail,
		business_address: legacyRequired(1000),
		registered_agent_confirmed: z.literal(true),
	})
	.strict();

export const legacyAgreementDetailsSchema = z
	.object({
		planned_start: date,
		planned_end: date,
		environment: legacyRequired(4000),
		operating_responsibilities: legacyRequired(4000),
		update_channel: legacyRequired(500).default(
			"Private project page and email",
		),
		update_rhythm: legacyRequired(500),
		milestones: z
			.array(
				z
					.object({
						start: date,
						target: date,
						handoff: legacyRequired(4000),
						checkpoint_criteria: legacyCleanText(4000).default("None"),
						checkpoint_evidence: legacyCleanText(4000).default("None"),
					})
					.strict(),
			)
			.min(1)
			.max(3),
		visual_approvals: legacyCleanText(4000).default("None"),
		invoice_first_duration: z
			.number()
			.int()
			.positive()
			.max(90)
			.nullable()
			.default(null),
		review_business_days: z.number().int().min(5).max(365).default(5),
		longer_review_confirmed: z.boolean().default(false),
		correction_calendar_days: z.number().int().min(30).max(365).default(30),
		po_requirement: z
			.enum(["not_required", "before_start"])
			.default("not_required"),
		expenses_taxes: legacyCleanText(4000).default("None"),
		recurring_charges: legacyCleanText(4000).default("None"),
		ai_permission: legacyCleanText(4000).default("None"),
		sensitive_addenda: legacyCleanText(4000).default("None"),
		support: legacyCleanText(4000).default("None"),
		msa_changes: legacyCleanText(4000).default("None"),
		data_retention: legacyCleanText(4000).default(
			"MSA default, including one year for the private project page",
		),
		project_retention_days: z.number().int().min(1).max(3650).default(365),
		handoff_access: legacyCleanText(4000).default("MSA default"),
		handoff_access_days: z.number().int().min(30).max(3650).default(30),
		attachments: z
			.array(
				z
					.object({
						filename: legacyRequired(200),
						version: legacyRequired(80),
						date,
						sha256: z.string().regex(/^[a-f0-9]{64}$/),
						key: z.string().regex(/^agreements\/attachments\/[a-f0-9-]+\.pdf$/),
						bytes: z
							.number()
							.int()
							.positive()
							.max(10 * 1024 * 1024),
					})
					.strict(),
			)
			.max(5)
			.default([]),
	})
	.strict()
	.superRefine((v, c) => {
		const issue = (path: string, message: string) =>
			c.addIssue({ code: "custom", path: [path], message });

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
	});

export function legacyValidateAgreementDetails(
	input: RawValue,
	terms: OfferTerms,
) {
	if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
		throw new Error("Agreement details exceed 64 KiB.");
	const v = legacyAgreementDetailsSchema.parse(input);

	if (v.milestones.length !== terms.milestones.length)
		throw new Error("Complete details for every purchased milestone.");

	if (
		terms.paymentMode === "invoice" &&
		(!v.invoice_first_duration ||
			v.invoice_first_duration >
				(Date.parse(v.milestones[0].target) -
					Date.parse(v.milestones[0].start)) /
					86400000 +
					1)
	)
		throw new Error(
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
			throw new Error("Checkpoint criteria and evidence are required.");
	});

	return v;
}

const legacyDocuments = z
	.array(
		z.object({
			id: z.string().uuid(),
			hash: z.string().regex(/^[a-f0-9]{64}$/),
		}),
	)
	.min(1)
	.max(2);

export const legacyOwnerAgreementAction = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("countersign"),
		documents: legacyDocuments,
		typed_name: legacyCleanText(200).refine(Boolean),
		consent: z.literal(true),
	}),
	z.object({
		action: z.literal("abandon"),
		documents: legacyDocuments,
		reason: legacyCleanText(1000).refine(Boolean),
		confirmed: z.literal(true),
	}),
	z.object({
		action: z.enum(["retry-artifact", "retry-copy"]),
		agreement_id: z.string().uuid(),
		confirmedNotSent: z.boolean().default(false),
		expectedAttempt: z.string().uuid().optional(),
		confirmedStale: z.boolean().default(false),
	}),
	z.object({
		action: z.literal("record-alternate-copy"),
		agreement_id: z.string().uuid(),
		role: z.enum(["client", "contractor"]),
		method: legacyCleanText(200).refine(Boolean),
		confirmed: z.literal(true),
	}),
	z.object({
		action: z.literal("hold"),
		agreement_id: z.string().uuid(),
		held: z.boolean(),
	}),
	z.object({
		action: z.literal("end"),
		agreement_id: z.string().uuid(),
		ended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		confirmed: z.literal(true),
	}),
]);

export const legacyAttachmentQuery = z.object({
	filename: legacyCleanText(200).refine((v) => Boolean(v) && !/[\\/]/.test(v)),
	version: legacyCleanText(80).refine(Boolean),
	date: z.string().refine(legacyValidProjectDate),
});
