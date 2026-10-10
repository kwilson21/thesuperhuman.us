import { z } from "astro/zod";
import { cleanText, clientAgreementSchema } from "./agreement-fields";
import { liveSigningGuard, type AgreementSession } from "./agreement-access";
import { sessionGuard } from "./software-agreements";
import type { SoftwareOffer } from "./software-offers";
import type { OwnerRequest } from "./owner-model";
export const businessTypes = [
  "LLC",
  "Corporation",
  "Sole proprietorship",
  "Partnership",
  "Nonprofit",
  "Other",
];
export const states = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "Outside the US",
];
export const draftSchema = z
  .object({
    legal_name: cleanText(200).default(""),
    entity_type: cleanText(200).default(""),
    state: cleanText(100).default(""),
    country: cleanText(100).default(""),
    business_address: cleanText(1000).default(""),
    signer_name: cleanText(200).default(""),
    signer_title: cleanText(200).default(""),
    portfolio_choice: z.enum(["private", "anonymous", "named", ""]).default(""),
    reviewer_name: cleanText(200).default(""),
    reviewer_email: cleanText(320).default(""),
    approver_name: cleanText(200).default(""),
    approver_email: cleanText(320).default(""),
    notice_email: cleanText(320).default(""),
  })
  .strict();
export type AgreementDraft = z.infer<typeof draftSchema>;
export const fieldMessages: Record<string, string> = {
  legal_name: "Add your legal business name",
  entity_type: "Choose a business type",
  state: "Choose a state",
  country: "Add your country",
  business_address: "Add your business mailing address",
  signer_name: "Add your full legal name",
  signer_title: "Add your title",
  portfolio_choice: "Choose a portfolio option",
  reviewer_name: "Add the reviewer name",
  reviewer_email: "Add a valid reviewer email",
  approver_name: "Add the approver name",
  approver_email: "Add a valid approver email",
  notice_email: "Add a valid notice email",
};
export function draftFieldErrors(issues: z.ZodIssue[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "legal_name");
    errors[field] = issue.message === "Remove control characters."
      ? "Remove unusual characters from this field."
      : "Check this field.";
  }
  return errors;
}
export function resolveClientDetails(input: unknown, email: string) {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, errors: draftFieldErrors(parsed.error.issues) };
  const draft = parsed.data;
  const client = clientAgreementSchema.safeParse({
    legal_name: draft.legal_name,
    entity_type: draft.entity_type,
    jurisdiction:
      draft.state === "Outside the US" ? draft.country : draft.state,
    business_address: draft.business_address,
    signer_name: draft.signer_name,
    signer_title: draft.signer_title,
    notice_email: draft.notice_email || email,
    reviewer_name: draft.reviewer_name || draft.signer_name,
    reviewer_email: draft.reviewer_email || email,
    approver_name: draft.approver_name || draft.signer_name,
    approver_email: draft.approver_email || email,
    portfolio: draft.portfolio_choice === "private" ? "deny" : "allow",
    naming: draft.portfolio_choice === "named",
  });
  const errors: Record<string, string> = {};
  if (!client.success)
    for (const issue of client.error.issues) {
      const field =
        String(issue.path[0]) === "jurisdiction"
          ? draft.state === "Outside the US"
            ? "country"
            : "state"
          : String(issue.path[0]);
      errors[field] = issue.message === "Remove control characters."
        ? "Remove unusual characters from this field."
        : issue.message === "This answer is required." || issue.code === "invalid_string"
          ? fieldMessages[field] ?? "Check this field."
          : "Check this field.";
    }
  if (!businessTypes.includes(draft.entity_type))
    errors.entity_type = fieldMessages.entity_type;
  if (!states.includes(draft.state)) errors.state = fieldMessages.state;
  if (!draft.portfolio_choice)
    errors.portfolio_choice = fieldMessages.portfolio_choice;
  return client.success && !Object.keys(errors).length
    ? { ok: true as const, client: client.data }
    : { ok: false as const, errors };
}
export function prefillAgreementDraft(
  request: OwnerRequest,
  previous?: Record<string, unknown>,
) {
  const jurisdiction = String(previous?.jurisdiction ?? "");
  return draftSchema.parse({
    legal_name: previous?.legal_name ?? request.details.company ?? "",
    signer_name: request.name,
    entity_type: previous?.entity_type ?? "",
    state: jurisdiction
      ? states.includes(jurisdiction)
        ? jurisdiction
        : "Outside the US"
      : "",
    country: jurisdiction && !states.includes(jurisdiction) ? jurisdiction : "",
    business_address: previous?.business_address ?? "",
  });
}
export async function loadAgreementDraft(
  db: D1Database,
  offerId: string,
  email: string,
) {
  const saved = await db
    .prepare(
      "SELECT values_json FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
    )
    .bind(offerId, email)
    .first<{ values_json: string }>();
  return saved ? draftSchema.parse(JSON.parse(saved.values_json)) : null;
}
export async function saveAgreementDraft(
  db: D1Database,
  offer: SoftwareOffer,
  session: AgreementSession,
  input: unknown,
) {
  const draft = draftSchema.parse(input);
  await db.batch([
    liveSigningGuard(db, offer.id, session.link_hash!, session.recipient_email),
    sessionGuard(db, session),
    db
      .prepare(
        `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed')) THEN 1 ELSE json_extract('Already signed','$') END`,
      )
      .bind(offer.id),
    db
      .prepare(
        "INSERT INTO software_agreement_drafts(offer_id,recipient_email,values_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(offer_id,recipient_email) DO UPDATE SET values_json=excluded.values_json,updated_at=excluded.updated_at",
      )
      .bind(
        offer.id,
        session.recipient_email,
        JSON.stringify(draft),
        new Date().toISOString(),
      ),
  ]);
  return draft;
}
