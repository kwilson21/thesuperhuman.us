import { z } from 'astro/zod';
import { softwareInvoiceTerms } from './software-invoices';
import { validProjectDate } from './audio-project-updates';
import { formatUSD, offerTotal, type OfferTerms } from './software-offers';
export const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v.normalize('NFC'))
    .refine(
      (v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(v),
      'Remove control characters.',
    );
const required = (max: number) => cleanText(max).refine(Boolean, 'This answer is required.');
const date = z.string().refine(validProjectDate, 'Choose a valid date.');
const email = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((v) => v.toLowerCase());
export const contractorSchema = z
  .object({
    legal_name: required(200),
    entity_jurisdiction: required(200),
    signer_name: required(200),
    signer_title: required(200),
    notice_email: email,
    business_address: required(1000),
    registered_agent_confirmed: z.literal(true),
  })
  .strict();
export const agreementDetailsSchema = z
  .object({
    planned_start: date,
    planned_end: date,
    environment: required(4000),
    operating_responsibilities: required(4000),
    update_channel: required(500).default('Private project page and email'),
    update_rhythm: required(500),
    milestones: z
      .array(
        z
          .object({
            start: date,
            target: date,
            handoff: required(4000),
            checkpoint_criteria: cleanText(4000).default('None'),
            checkpoint_evidence: cleanText(4000).default('None'),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    visual_approvals: cleanText(4000).default('None'),
    invoice_first_duration: z.number().int().positive().max(90).nullable().default(null),
    review_business_days: z.number().int().min(5).max(365).default(5),
    longer_review_confirmed: z.boolean().default(false),
    correction_calendar_days: z.number().int().min(30).max(365).default(30),
    po_requirement: z.enum(['not_required', 'before_start']).default('not_required'),
    expenses_taxes: cleanText(4000).default('None'),
    recurring_charges: cleanText(4000).default('None'),
    ai_permission: cleanText(4000).default('None'),
    sensitive_addenda: cleanText(4000).default('None'),
    support: cleanText(4000).default('None'),
    msa_changes: cleanText(4000).default('None'),
    data_retention: cleanText(4000).default(
      'MSA default, including one year for the private project page',
    ),
    project_retention_days: z.number().int().min(1).max(3650).default(365),
    handoff_access: cleanText(4000).default('MSA default'),
    handoff_access_days: z.number().int().min(30).max(3650).default(30),
    attachments: z
      .array(
        z
          .object({
            filename: required(200),
            version: required(80),
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
      c.addIssue({ code: 'custom', path: [path], message });
    const span = (Date.parse(v.planned_end) - Date.parse(v.planned_start)) / 86400000;
    if (span < 0 || span > 89) issue('planned_end', 'Use a period of up to 90 calendar days.');
    let previous = v.planned_start;
    v.milestones.forEach((m, i) => {
      if (m.start < previous || m.target < m.start || m.target > v.planned_end)
        issue(`milestones.${i}.target`, 'Dates must be ordered within the planned period.');
      previous = m.target;
    });
    if (v.review_business_days > 30 && !v.longer_review_confirmed)
      issue('longer_review_confirmed', 'Confirm the longer review period.');
    if (
      v.data_retention !== 'MSA default, including one year for the private project page' &&
      !new RegExp(`(?<![\\p{L}\\p{N}.])${v.project_retention_days}(?![\\p{L}\\p{N}.])`, 'u').test(v.data_retention)
    )
      issue('data_retention', 'State the agreed project page period in days.');
    if (
      v.handoff_access !== 'MSA default' &&
      !new RegExp(`(?<![\\p{L}\\p{N}.])${v.handoff_access_days}(?![\\p{L}\\p{N}.])`, 'u').test(v.handoff_access)
    )
      issue('handoff_access', 'State the agreed handoff period in days.');
    if (
      v.data_retention === 'MSA default, including one year for the private project page' &&
      v.project_retention_days !== 365
    )
      issue('project_retention_days', 'The default is one year.');
    if (v.handoff_access === 'MSA default' && v.handoff_access_days !== 30)
      issue('handoff_access_days', 'The default is 30 days.');
    if (v.attachments.reduce((s, a) => s + a.bytes, 0) > 25 * 1024 * 1024)
      issue('attachments', 'Keep attachments under 25 MiB combined.');
  });
export type AgreementDetails = z.infer<typeof agreementDetailsSchema>;
export function validateAgreementDetails(input: unknown, terms: OfferTerms) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
    throw new Error('Agreement details exceed 64 KiB.');
  const v = agreementDetailsSchema.parse(input);
  if (v.milestones.length !== terms.milestones.length)
    throw new Error('Complete details for every purchased milestone.');
  if (
    terms.paymentMode === 'invoice' &&
    (!v.invoice_first_duration ||
      v.invoice_first_duration >
        (Date.parse(v.milestones[0].target) - Date.parse(v.milestones[0].start)) / 86400000 + 1)
  )
    throw new Error('Enter a first-milestone duration within its planned dates.');
  terms.milestones.forEach((m, i) => {
    if (
      m.checkpoint &&
      [v.milestones[i].checkpoint_criteria, v.milestones[i].checkpoint_evidence].some(
        (x) => !x || x === 'None',
      )
    )
      throw new Error('Checkpoint criteria and evidence are required.');
  });
  return v;
}
export const clientAgreementSchema = z
  .object({
    legal_name: required(200),
    entity_type: required(200),
    jurisdiction: required(100),
    business_address: required(1000),
    notice_email: email,
    reviewer_name: required(200),
    reviewer_email: email,
    approver_name: required(200),
    approver_email: email,
    signer_name: required(200),
    signer_title: required(200),
    portfolio: z.enum(['allow', 'deny']),
    naming: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.portfolio === 'allow' || !v.naming, 'Naming requires portfolio permission.');
export type ClientAgreement = z.infer<typeof clientAgreementSchema>;
export const signatureReference =
  'Signature recorded in the signing certificate for this document.';
export const consentText = (party: string, owner = false) => owner
  ? "I agree to sign and receive these documents electronically, and I'm authorized to sign for The Superhuman Group LLC."
  : `I agree to sign and receive these documents electronically, and I'm authorized to sign for ${party}, a business. I can download and keep a complete copy.`;
export const intentText = (owner = false, sowOnly = false) => owner
  ? `Countersigning applies your name above as your electronic signature on the ${sowOnly ? 'statement of work' : 'agreement and statement of work'} you reviewed.`
  : `Signing applies your name above as your electronic signature on the ${sowOnly ? 'statement of work' : 'agreement and statement of work'} linked above.`;
export const agreementVersionLabel = 'v2026-09-30';
export function agreementValues(
  terms: OfferTerms,
  details: AgreementDetails,
  client: ClientAgreement,
  contractor: z.infer<typeof contractorSchema> & { config_version?: number },
  system: {
    effective_on: string;
    msa_version: string;
    sow_number: string;
    offer_version: number;
    template_version: number;
  },
) {
  const amounts = terms.milestones.map((m, i) =>
    terms.paymentMode === 'standard'
      ? `${formatUSD(softwareInvoiceTerms(terms,i,'deposit').amountCents)} deposit / ${formatUSD(softwareInvoiceTerms(terms,i,'balance').amountCents)} balance`
      : `${formatUSD(m.feeCents)} full invoice`,
  );
  const checkpointAmount = (i: number) => terms.milestones.slice(0,i).reduce((sum,m)=>sum+m.feeCents,0) + Math.round(terms.milestones[i].feeCents * terms.milestones[i].checkpoint!.cancellationPercent / 100);
  const base = {
    client,
    contractor,
    owner: {
      ...details,
      po_requirement:
        details.po_requirement === 'before_start' ? 'PO number before start' : 'Not required',
      review_business_days: String(details.review_business_days),
      correction_calendar_days: String(details.correction_calendar_days),
    },
    system: {
      ...system,
      offer_version: String(system.offer_version),
      template_version: String(system.template_version),
      signature: signatureReference,
      total: formatUSD(offerTotal(terms)).replace('$', ''),
      payment: terms.paymentMode === 'standard' ? 'Standard' : 'Invoice Terms',
      msa_date_version: system.msa_version,
      attachments:
        details.attachments
          .map((a) => `${a.filename} / ${a.version} / ${a.date} / SHA-256 ${a.sha256}`)
          .join('\n') || 'None',
      amount1: amounts[0],
      amount2: amounts[1] || 'N/A',
      amount3: amounts[2] || 'N/A',
    },
    offer: {
      ...terms,
      outcome_summary: `${terms.outcome}\n${terms.summary}`,
      exclusions: terms.exclusions || 'None',
      clientInputs: terms.clientInputs || 'None',
      estimate: terms.projectRange
        ? `${formatUSD(terms.projectRange.lowCents)} to ${formatUSD(terms.projectRange.highCents)} (non-binding)`
        : 'None',
    },
    choices: {
      portfolio: client.portfolio === 'allow' ? 'Allow' : 'Do not allow',
      naming: client.naming ? 'Yes' : 'No',
    },
    milestones: terms.milestones.map((m, i) => ({
      number: String(i + 1),
      name: m.name,
      price: formatUSD(m.feeCents).replace('$', ''),
      start: details.milestones[i].start,
      target: details.milestones[i].target,
      deliverables: m.deliverables.join('\n'),
      acceptance: m.acceptance.join('\n'),
      handoff: details.milestones[i].handoff,
      duration:
        i === 0 && terms.paymentMode === 'invoice'
          ? `${details.invoice_first_duration} calendar days`
          : 'N/A',
      checkpoint: m.checkpoint
        ? `${m.checkpoint.label}; ${details.milestones[i].checkpoint_criteria}; ${details.milestones[i].checkpoint_evidence}; cumulative cancellation amount ${formatUSD(checkpointAmount(i))} (${m.checkpoint.cancellationPercent}%, includes prior payments)`
        : 'None',
    })),
  };
  return {
    ...base,
    contractor: {
      ...contractor,
      config_version: String(
        (contractor as typeof contractor & { config_version?: number }).config_version ?? 1,
      ),
    },
    msa: {
      effective_on: system.msa_version.split(' / ')[0],
      template_version: system.msa_version.split('template ')[1],
      source_revision: 'Interim v2026-09-30',
      version_label: agreementVersionLabel,
    },
    signature: { client_record: signatureReference, contractor_record: signatureReference },
    details: {
      ...base.owner,
      invoice_first_duration:
        terms.paymentMode === 'invoice' ? `${details.invoice_first_duration} calendar days` : 'N/A',
      data_retention: `${details.data_retention} (project page: ${details.project_retention_days} days)`,
      handoff_access: `${details.handoff_access} (${details.handoff_access_days} days)`,
    },
    sow: {
      number: system.sow_number,
      version: String(system.offer_version),
      effective_on: system.effective_on,
      project_name: terms.outcome,
      outcome: base.offer.outcome_summary,
      summary: terms.summary,
      exclusions: base.offer.exclusions,
      client_inputs: base.offer.clientInputs,
      timing: terms.timing || 'None',
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
      checkpoint_label: terms.milestones[i].checkpoint?.label ?? 'None',
      checkpoint_criteria: details.milestones[i].checkpoint_criteria,
      checkpoint_evidence: details.milestones[i].checkpoint_evidence,
      checkpoint_cumulative_amount: terms.milestones[i].checkpoint
        ? `${formatUSD(checkpointAmount(i))} (includes prior payments)`
        : 'None',
      deposit:
        terms.paymentMode === 'standard'
          ? formatUSD(softwareInvoiceTerms(terms,i,'deposit').amountCents)
          : 'N/A',
      balance:
        terms.paymentMode === 'standard'
          ? formatUSD(softwareInvoiceTerms(terms,i,'balance').amountCents)
          : 'N/A',
      invoice_amount:
        terms.paymentMode === 'invoice' ? formatUSD(terms.milestones[i].feeCents) : 'N/A',
    })),
  };
}
