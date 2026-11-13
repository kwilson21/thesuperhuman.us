// Shared seed builders and scripts for the software offer golden corpora (the fit review, question, decline, revoke,
// offer draft, offer send and offer signing files for POST /api/owner/requests/[id]/software). Rows get fixed defaults on
// the frozen clock's day; a case passes only the columns it cares about.
import { createHash } from "node:crypto";
import { templateFields } from "~/lib/agreement-templates";
import { isText } from "~/lib/type-guards";
import type { JsonObject, JsonValue } from "../../helpers/json";
import {
	asOwner,
	byHost,
	json,
	networkDown,
	rows,
	START,
	type FetchAnswer,
	type Responder,
	type Seed,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = START;
export const ORIGIN = "https://thesuperhuman.us";
export const BASE = "/api/owner/requests/r1/software";

/** An ISO time, this many seconds from the frozen clock's start (negative: before it). */
export const secondsFromNow = (seconds: number) =>
	new Date(Date.parse(START) + seconds * 1000).toISOString();

/** The tables a step dumps unless it names others. */
export const offerTables = [
	"owner_requests",
	"owner_request_audit",
	"software_fit_reviews",
	"software_offers",
	"software_offer_links",
	"software_agreements",
	"software_agreement_drafts",
	"software_agreement_sessions",
	"software_agreement_links",
	"software_agreement_attachments",
];

/** The tables the deposit and project guards read. */
export const projectTables = ["software_projects", "software_invoices"];

/** One owner command. The origin and the JSON content type are what the route's musicRequest wants. */
export const act = (
	body: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	path: BASE,
	params: { id: "r1" },
	json: body,
	headers: { origin: ORIGIN },
	dump: { music: offerTables },
	...extra,
});

/** One owner command with a raw body, for text that is not JSON. */
export const raw = (body: string, extra: Partial<Step> = {}): Step =>
	act(undefined, {
		json: undefined,
		body,
		headers: { origin: ORIGIN, "content-type": "application/json" },
		...extra,
	});

// ---------------------------------------------------------------------------------------------------------------------
// Offer terms and agreement details
// ---------------------------------------------------------------------------------------------------------------------

export const milestone = (over: JsonObject = {}): JsonObject => ({
	name: "Tracker",
	deliverables: ["Status view"],
	acceptance: ["Add a client and see their next action."],
	feeCents: 240_000,
	...over,
});

/** Valid offer terms: one milestone, standard payment, nothing optional. */
export const terms = (over: JsonObject = {}): JsonObject => ({
	outcome: "Client onboarding tracker",
	summary: "A shared view of each client's next step.",
	milestones: [milestone()],
	clientInputs: "",
	exclusions: "",
	timing: "",
	paymentMode: "standard",
	...over,
});

export const TERMS_JSON = JSON.stringify(terms());

/** Valid agreement details for one milestone. */
export const details = (over: JsonObject = {}): JsonObject => ({
	planned_start: "2026-12-01",
	planned_end: "2026-12-20",
	environment: "Browser",
	operating_responsibilities: "Client",
	update_rhythm: "Weekly",
	milestones: [
		{ start: "2026-12-01", target: "2026-12-20", handoff: "Source" },
	],
	...over,
});

export const contractor: JsonObject = {
	legal_name: "Example Contractor LLC",
	entity_jurisdiction: "Wyoming LLC",
	signer_name: "Example Owner",
	signer_title: "Representative",
	notice_email: "owner@example.test",
	business_address: "200 Example Business Street",
	registered_agent_confirmed: true,
};

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

/** The software request every case hangs its rows on. */
export const request = (over: SeedRow = {}): SeedRow =>
	rows.softwareRequest("r1", { status: "reviewed", ...over });

type OfferStatus = "draft" | "sent" | "superseded" | "withdrawn";

/**
 * An offer of request r1. The id is `o<version>`. A draft has no send time; every other status was sent at the start of
 * the day.
 */
export const offer = (
	status: OfferStatus,
	version = 1,
	over: SeedRow = {},
): SeedRow =>
	rows.softwareOffer(`o${version}`, "r1", {
		version,
		status,
		terms_json: TERMS_JSON,
		sent_at: status === "draft" ? null : EARLIER,
		sent_by: status === "draft" ? null : "owner@example.test",
		...over,
	});

/** A live offer link created an hour before the clock starts. */
export const liveLink = (over: SeedRow = {}): SeedRow =>
	rows.offerLink("r1", over);

/** A link that was revoked. */
export const revokedLink = (over: SeedRow = {}): SeedRow =>
	rows.offerLink("r1", { revoked_at: EARLIER, ...over });

/** A link created this many seconds before the clock starts (under 20 means the offer is still sending). */
export const linkAgo = (seconds: number, over: SeedRow = {}): SeedRow =>
	rows.offerLink("r1", { created_at: secondsFromNow(-seconds), ...over });

/** An owner request and the rows of the offers given, in the order foreign keys need. */
export const withOffers = (
	offers: readonly SeedRow[],
	extra: Seed = {},
	over: SeedRow = {},
): Seed => ({
	owner_requests: [request(over)],
	software_offers: offers,
	...extra,
});

/** The deposit invoice of the first milestone, in the given status. */
export const deposit = (status: string, over: SeedRow = {}): SeedRow =>
	rows.softwareInvoice("inv1", "r1", "o1", { status, ...over });

export const project = (over: SeedRow = {}): SeedRow =>
	rows.softwareProject("r1", "o1", over);

// ---------------------------------------------------------------------------------------------------------------------
// Signing: templates, contractor details, attachments, a reusable MSA
// ---------------------------------------------------------------------------------------------------------------------

const SHA = "0".repeat(64);

const synthetic = (kind: "msa" | "sow") =>
	templateFields[kind]
		.filter((field) => !field.startsWith("milestone."))
		.map((field) => `${field}: {{${field}}}`)
		.join("\n") +
	(kind === "sow"
		? "\n{{#milestones}}\n" +
			templateFields.sow
				.filter((field) => field.startsWith("milestone."))
				.map((field) => `${field}: {{${field}}}`)
				.join("\n") +
			"\n{{/milestones}}"
		: "");

export const template = (kind: "msa" | "sow", over: SeedRow = {}): SeedRow => ({
	id: `template-${kind}`,
	kind,
	version: 1,
	text: synthetic(kind),
	sha256: SHA,
	published_at: EARLIER,
	published_by: "owner@example.test",
	version_label: "v1",
	...over,
});

export const contractorConfig = (
	over: SeedRow = {},
	value: JsonObject = contractor,
): SeedRow => ({
	version: 1,
	values_json: JSON.stringify(value),
	created_at: EARLIER,
	created_by: "owner@example.test",
	...over,
});

export const client = (over: SeedRow = {}): SeedRow => ({
	id: "client-1",
	recipient_email: "grace@example.test",
	legal_name: "Grace Hopper LLC",
	legal_name_key: "grace hopper llc",
	entity_type: "llc",
	jurisdiction: "VA",
	business_address: "1 Main St",
	notice_email: "grace@example.test",
	created_at: EARLIER,
	...over,
});

/** A one-page PDF (written by pdf-lib once, with no metadata), so a signing send can merge a real attachment. */
const PDF_BASE64 =
	"JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMCAwIDIwMCAyMDAgXQo+PgplbmRvYmoKCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNiAwMDAwMCBuIAowMDAwMDAwMDc2IDAwMDAwIG4gCjAwMDAwMDAxMjYgMDAwMDAgbiAKCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAyIDAgUgo+PgoKc3RhcnR4cmVmCjIxNwolJUVPRg==";

export const PDF_BYTES = Uint8Array.from(Buffer.from(PDF_BASE64, "base64"));

export const sha256Of = (content: string | Uint8Array) =>
	createHash("sha256").update(content).digest("hex");

export const PDF_SHA = sha256Of(PDF_BYTES);

export const ATTACHMENT_KEY =
	"agreements/attachments/00000000-0000-4000-8000-000000000001.pdf";

export const SECOND_KEY =
	"agreements/attachments/00000000-0000-4000-8000-000000000002.pdf";

/** An attachment as agreement details name it. */
export const attachment = (over: JsonObject = {}): JsonObject => ({
	filename: "Security addendum.pdf",
	version: "1",
	date: "2026-11-01",
	sha256: PDF_SHA,
	key: ATTACHMENT_KEY,
	bytes: PDF_BYTES.length,
	...over,
});

/** The metadata row the upload route would have stored for an attachment. */
export const attachmentRow = (over: SeedRow = {}): SeedRow => ({
	id: "att1",
	request_id: "r1",
	filename: "Security addendum.pdf",
	version: "1",
	document_date: "2026-11-01",
	object_key: ATTACHMENT_KEY,
	sha256: PDF_SHA,
	bytes: PDF_BYTES.length,
	created_at: EARLIER,
	created_by: "owner@example.test",
	...over,
});

/** The bucket holding the attachment. */
export const attachmentBucket = {
	seed: { [ATTACHMENT_KEY]: { body: PDF_BYTES } },
};

/** What signing needs on top of the request: both templates, contractor details and the client identity. */
export const signingBase = (): Seed => ({
	software_agreement_templates: [template("msa"), template("sow")],
	software_contractor_config: [contractorConfig()],
	software_agreement_clients: [client()],
});

/** An executed MSA with a ready artifact, as a draft offer may reuse it. It belongs to no offer, so it can be seeded first. */
export const executedMsa = (over: SeedRow = {}): SeedRow =>
	rows.agreement(MSA_ID, "r0", "o0", {
		status: "executed",
		offer_id: null,
		executed_at: EARLIER,
		...over,
	});

export const MSA_ID = "11111111-1111-4111-8111-111111111111";

export const MSA_PDF_KEY = "agreements/msa1/packet.pdf";

export const readyArtifact = (over: SeedRow = {}): SeedRow => ({
	agreement_id: MSA_ID,
	status: "ready",
	pdf_key: MSA_PDF_KEY,
	pdf_sha256: PDF_SHA,
	...over,
});

/** The bucket holding the executed MSA's signed copy. */
export const msaBucket = { seed: { [MSA_PDF_KEY]: { body: PDF_BYTES } } };

/** Turns the signing setting on, off the record. */
export const signingOn = (world: World) =>
	world.music.exec(
		"UPDATE software_signing_settings SET software_signing_enabled=1",
	);

// ---------------------------------------------------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------------------------------------------------

export const sent: FetchAnswer = json(200, { id: "em_1" });
export const refused: FetchAnswer = json(422, { message: "invalid to" });
export const resendDown: FetchAnswer = json(503, { message: "unavailable" });
export const unreachable: FetchAnswer = networkDown("fetch failed");

/** Resend answers: the first for the client's email, the second for the owner's copy. */
export const mail = (
	clientAnswer: FetchAnswer = sent,
	copy: FetchAnswer = sent,
): Responder => byHost({ resend: [clientAnswer, copy] });

/** The email outcomes every sending action is run against: a name, the answers for the client and the copy. */
export const mailOutcomes: readonly {
	name: string;
	client: FetchAnswer;
	copy: FetchAnswer;
}[] = [
	{ name: "the client and the copy both sent", client: sent, copy: sent },
	{
		name: "Resend refuses the client email (422)",
		client: refused,
		copy: sent,
	},
	{
		name: "Resend fails with 503 on the client email",
		client: resendDown,
		copy: sent,
	},
	{
		name: "the network is down for the client email",
		client: unreachable,
		copy: sent,
	},
	{ name: "Resend refuses the owner copy (422)", client: sent, copy: refused },
	{
		name: "Resend fails with 503 on the owner copy",
		client: sent,
		copy: resendDown,
	},
	{
		name: "the network is down for the owner copy",
		client: sent,
		copy: unreachable,
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Rows that appear while a request is running (races)
// ---------------------------------------------------------------------------------------------------------------------

const sqlValue = (value: SeedRow[string]): string => {
	if (value === null) return "NULL";

	if (isText(value)) return `'${value.replaceAll("'", "''")}'`;

	return String(value);
};

/** The SQL that inserts a row, for an interleave that makes another writer add it. */
export const insertSql = (table: string, row: SeedRow) =>
	`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(sqlValue).join(",")})`;

/** An interleave action that inserts a row. */
export const inserting =
	(table: string, row: SeedRow) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(insertSql(table, row));

/** An interleave action that runs SQL as written. */
export const running =
	(sql: string) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(sql);
