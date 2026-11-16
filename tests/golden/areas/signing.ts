// Shared seed builders and steps for the signing golden corpora: the client's POST /api/offer/[token]/sign and the owner's
// POST /api/owner/requests/[id]/agreement. A scene is one software request with its sent offer, offer link, a client
// session, the two pinned templates, and the MSA and SOW in whatever state a case needs, with the signatures, artifact
// rows, deliveries and notifications that state carries. Every value is fixed: a case passes only what it changes.
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
	asOwner,
	asVisitor,
	byHost,
	json,
	rows,
	uuidFor,
	type Case,
	type FetchAnswer,
	type Responder,
	type SeedRow,
	type Step,
	type World,
} from "../harness";
import { isText } from "~/lib/type-guards";
import type { JsonValue } from "../../helpers/json";

/** A record whose values are JSON, or left out. */
export type Loose = { [name: string]: JsonValue | undefined };

export const sha = (text: string) =>
	createHash("sha256").update(text).digest("hex");

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const LATER = "2099-01-01T00:00:00.000Z";
export const PAST = "2026-11-13T10:00:00.000Z";

/** The offer link token in the client's address, and the session cookie the verified client holds. */
export const TOKEN = "t".repeat(43);
export const OTHER_TOKEN = "u".repeat(43);
export const SESSION = "s".repeat(43);
export const OTHER_SESSION = "v".repeat(43);
export const CSRF = "csrf-nonce-golden";
export const CLIENT_EMAIL = "grace@example.test";
export const OWNER = "owner@example.test";

export const MSA_ID = uuidFor(0xa1);
export const SOW_ID = uuidFor(0xa2);
export const OLD_MSA_ID = uuidFor(0xa0);
export const OTHER_ID = uuidFor(0xb1);

export const MSA_TEXT =
	"Master Services Agreement\n1 Scope\nClient signature: Signature recorded in the signing certificate for this document.\nClient signing date: Signature recorded in the signing certificate for this document.\nContractor signature: Signature recorded in the signing certificate for this document.\nContractor signing date: Signature recorded in the signing certificate for this document.";

export const SOW_TEXT =
	"Statement of Work\nMilestone 1\nA small tool.\nClient signature: Signature recorded in the signing certificate for this document.\nContractor signature: Signature recorded in the signing certificate for this document.";

export const MSA_HASH = sha(MSA_TEXT);
export const SOW_HASH = sha(SOW_TEXT);
export const OLD_MSA_TEXT = `${MSA_TEXT}\nEarlier`;
export const OLD_MSA_HASH = sha(OLD_MSA_TEXT);

export const CLIENT = {
	legal_name: "Grace Hopper LLC",
	entity_type: "LLC",
	jurisdiction: "Virginia",
	business_address: "1 Main St",
	notice_email: "notices@example.test",
	reviewer_name: "Grace Hopper",
	reviewer_email: "grace@example.test",
	approver_name: "Grace Hopper",
	approver_email: "grace@example.test",
	signer_name: "Grace Hopper",
	signer_title: "Founder",
	portfolio: "deny",
	naming: false,
};

export const CONTRACTOR = {
	legal_name: "The Superhuman Group LLC",
	entity_jurisdiction: "Wyoming LLC",
	signer_name: "Kazon Wilson",
	signer_title: "Founder",
	notice_email: "owner@example.test",
	business_address: "A registered agent address",
	registered_agent_confirmed: true,
};

/** What POST /api/offer/[token]/sign reads of the stored values, plus what the artifact certificate reads back. */
export const valuesJson = (client: Loose = CLIENT) =>
	JSON.stringify({
		client,
		contractor: { ...CONTRACTOR, config_version: "1" },
		msa: {
			effective_on: "2026-11-13",
			template_version: "1",
			version_label: "v1",
			source_revision: "rev-msa",
		},
		system: { template_version: "1" },
		sow: { version: "1", version_label: "v1", source_revision: "rev-sow" },
	});

/** The draft the client saved, which resolves to CLIENT. */
export const DRAFT = {
	legal_name: "Grace Hopper LLC",
	entity_type: "LLC",
	state: "Virginia",
	business_address: "1 Main St",
	signer_name: "Grace Hopper",
	signer_title: "Founder",
	portfolio_choice: "private",
	notice_email: "notices@example.test",
};

export type Status = "review" | "client_signed" | "executed" | "abandoned";

const consent = (party: string) =>
	`I agree to sign and receive these documents electronically, and I’m authorized to sign for ${party}, a business. I can download and keep a complete copy.`;

const OWNER_CONSENT =
	"I agree to sign and receive these documents electronically, and I’m authorized to sign for The Superhuman Group LLC.";

export const documentList = (ids: { id: string; hash: string }[]) =>
	JSON.stringify(
		[...ids].sort((a, b) => a.id.localeCompare(b.id)).map((d) => ({ ...d })),
	);

export const BOTH = [
	{ id: MSA_ID, hash: MSA_HASH },
	{ id: SOW_ID, hash: SOW_HASH },
];

export const SOW_ONLY = [{ id: SOW_ID, hash: SOW_HASH }];

export const clientSignature = (
	agreementId: string,
	hash: string,
	over: SeedRow = {},
): SeedRow => ({
	id: `sig-client-${agreementId.slice(-2)}`,
	agreement_id: agreementId,
	party: "client",
	typed_name: "Grace Hopper",
	title: "Founder",
	consent_text: consent("Grace Hopper LLC"),
	consent_version: "website-signing-v3",
	consent_at: EARLIER,
	signed_at: EARLIER,
	document_sha256: hash,
	session_token_hash: sha(SESSION),
	owner_subject: null,
	verified_email: CLIENT_EMAIL,
	verified_at: PAST,
	verification_method: "verified by one-time email link",
	intent_text:
		"Signing applies your name above as your electronic signature on the agreement and statement of work linked above.",
	document_list_json: documentList(BOTH),
	receipt_id: "receipt-1",
	ip_address: "203.0.113.9",
	user_agent: "golden-browser",
	...over,
});

export const contractorSignature = (
	agreementId: string,
	hash: string,
	over: SeedRow = {},
): SeedRow => ({
	id: `sig-owner-${agreementId.slice(-2)}`,
	agreement_id: agreementId,
	party: "contractor",
	typed_name: "Kazon Wilson",
	title: "Founder",
	consent_text: OWNER_CONSENT,
	consent_version: "website-signing-v3",
	consent_at: EARLIER,
	signed_at: EARLIER,
	document_sha256: hash,
	session_token_hash: null,
	owner_subject: OWNER,
	verified_email: OWNER,
	verified_at: EARLIER,
	verification_method: "verified by owner authentication",
	intent_text:
		"Countersigning applies your name above as your electronic signature on the agreement and statement of work you reviewed.",
	document_list_json: documentList(BOTH),
	receipt_id: "receipt-2",
	ip_address: "",
	user_agent: "",
	...over,
});

export type Doc = {
	status: Status;
	/** Columns of the agreement row to change. */
	row?: SeedRow;
	/** The client signature row, with these columns changed; false: none. Default: one when the status is client_signed or executed. */
	client?: SeedRow | false;
	/** The contractor signature row, with these columns changed; false: none. Default: one when the status is executed. */
	contractor?: SeedRow | false;
	/** The artifact row. Default: pending when executed, none otherwise. null: none. */
	artifact?: SeedRow | null;
};

/** A document in the given state. */
export const doc = (status: Status, rest: Omit<Doc, "status"> = {}): Doc => ({
	status,
	...rest,
});

export type Scene = {
	request?: SeedRow | false;
	offer?: SeedRow | false;
	/** The offer link row (the client's address). */
	link?: SeedRow | false;
	/** Website signing switched on (default true). */
	signing?: boolean;
	/** The client's verified session. false: no session. */
	session?: SeedRow | false;
	msa?: Doc | false;
	sow?: Doc | false;
	/** The offer reuses an MSA the client signed for an earlier offer. */
	reused?: Doc;
	draft?: SeedRow | false;
	/** SOW deliveries (client then contractor). Default: pending pair when the SOW is executed. */
	deliveries?: SeedRow[] | false;
	/** SOW notifications. Default: pending receipt and countersign notice when the SOW is client_signed. */
	notifications?: SeedRow[] | false;
	/** The client's recorded identity row. */
	clientRow?: SeedRow;
	/** More rows, appended to their tables. */
	extra?: { [table: string]: SeedRow[] };
};

const ORDER = [
	"owner_requests",
	"software_agreement_templates",
	"software_agreement_clients",
	"software_offers",
	"software_offer_links",
	"software_agreements",
	"software_agreement_signatures",
	"software_agreement_artifacts",
	"software_agreement_deliveries",
	"software_agreement_notifications",
	"software_agreement_links",
	"software_agreement_sessions",
	"software_agreement_drafts",
	"software_projects",
	"software_invoices",
];

const templateRow = (kind: "msa" | "sow", over: SeedRow = {}): SeedRow => ({
	id: `template-${kind}`,
	kind,
	version: 1,
	text: kind === "msa" ? MSA_TEXT : SOW_TEXT,
	sha256: sha(kind === "msa" ? MSA_TEXT : SOW_TEXT),
	published_at: EARLIER,
	published_by: OWNER,
	version_label: "v1",
	source_revision: `rev-${kind}`,
	...over,
});

const agreementRow = (
	kind: "msa" | "sow",
	d: Doc,
	opts: { id: string; offer: string; request: string; msaId: string | null },
): SeedRow => {
	const text = kind === "msa" ? MSA_TEXT : SOW_TEXT;

	return {
		id: opts.id,
		kind,
		offer_id: opts.offer,
		request_id: opts.request,
		client_id: "client-1",
		template_id: `template-${kind}`,
		msa_id: kind === "sow" ? opts.msaId : null,
		sow_number: kind === "sow" ? `SOW-${opts.id}` : null,
		status: d.status,
		canonical_text: text,
		text_sha256: sha(text),
		values_json: valuesJson(),
		attachment_manifest_json: "[]",
		created_at: EARLIER,
		effective_on: "2026-11-13",
		review_session_hash: sha(SESSION),
		client_signed_at:
			d.status === "client_signed" || d.status === "executed" ? EARLIER : null,
		executed_at: d.status === "executed" ? EARLIER : null,
		abandoned_at: d.status === "abandoned" ? EARLIER : null,
		abandoned_reason: d.status === "abandoned" ? "Offer link changed" : null,
		...d.row,
	};
};

/** The sent offer, with the details the sign and countersign routes read. */
export const offerRow = (over: SeedRow = {}): SeedRow =>
	rows.softwareOffer("o1", "r1", {
		msa_template_id: "template-msa",
		sow_template_id: "template-sow",
		contractor_snapshot_json: JSON.stringify({
			...CONTRACTOR,
			config_version: 1,
		}),
		agreement_details_json: "{}",
		recipient_email_snapshot: CLIENT_EMAIL,
		...over,
	});

export const requestRow = (over: SeedRow = {}): SeedRow =>
	rows.softwareRequest("r1", {
		email: CLIENT_EMAIL,
		status: "reviewed",
		...over,
	});

export const sessionRow = (over: SeedRow = {}): SeedRow => ({
	token_hash: sha(SESSION),
	purpose: "agreement",
	offer_id: "o1",
	link_hash: sha(TOKEN),
	recipient_email: CLIENT_EMAIL,
	link_id: "link-1",
	verified_at: PAST,
	expires_at: LATER,
	revoked_at: null,
	csrf_nonce: CSRF,
	...over,
});

const linkRow = (over: SeedRow = {}): SeedRow => ({
	id: "link-1",
	purpose: "agreement",
	offer_id: "o1",
	link_hash: sha(TOKEN),
	recipient_email: CLIENT_EMAIL,
	token_hash: "link-key-hash",
	issued_at: PAST,
	expires_at: LATER,
	used_at: PAST,
	...over,
});

export const deliveryRows = (
	status: string,
	over: SeedRow = {},
	agreementId = SOW_ID,
): SeedRow[] =>
	(["client", "contractor"] as const).map((role) => ({
		agreement_id: agreementId,
		recipient_role: role,
		email: role === "client" ? CLIENT_EMAIL : OWNER,
		status,
		...over,
	}));

export const notificationRows = (
	status: string,
	over: SeedRow = {},
): SeedRow[] => [
	{
		agreement_id: SOW_ID,
		kind: "signature-receipt",
		email: CLIENT_EMAIL,
		status,
		...over,
	},
	{
		agreement_id: SOW_ID,
		kind: "countersign-notice",
		email: OWNER,
		status,
		...over,
	},
];

const withSignatures = (d: Doc, id: string, hash: string) => {
	const wantsClient =
		d.client === undefined
			? d.status === "client_signed" || d.status === "executed"
			: d.client !== false;

	const wantsOwner =
		d.contractor === undefined
			? d.status === "executed"
			: d.contractor !== false;

	const out: SeedRow[] = [];

	if (wantsClient) out.push(clientSignature(id, hash, d.client || {}));

	if (wantsOwner) out.push(contractorSignature(id, hash, d.contractor || {}));

	const artifacts: SeedRow[] = [];

	if (d.artifact === undefined) {
		if (d.status === "executed")
			artifacts.push({ agreement_id: id, status: "pending" });
	} else if (d.artifact !== null) {
		artifacts.push({ agreement_id: id, ...d.artifact });
	}

	return {
		software_agreement_signatures: out,
		software_agreement_artifacts: artifacts,
	};
};

/** The rows and setup of a scene, as the `music` and `setup` members of a case. */
export function scene(s: Scene = {}): Pick<Case, "music" | "setup"> {
	const msaDoc = s.msa === undefined ? doc("review") : s.msa;
	const sowDoc = s.sow === undefined ? doc("review") : s.sow;
	const tables: { [table: string]: SeedRow[] } = {};

	const add = (table: string, rowsToAdd: SeedRow[]) => {
		tables[table] = [...(tables[table] ?? []), ...rowsToAdd];
	};

	if (s.request !== false) add("owner_requests", [requestRow(s.request)]);

	add("software_agreement_templates", [templateRow("msa"), templateRow("sow")]);

	add("software_agreement_clients", [
		{ ...rows.agreementBase().software_agreement_clients[0], ...s.clientRow },
	]);

	if (s.reused) {
		add("owner_requests", [
			rows.softwareRequest("r0", {
				email: CLIENT_EMAIL,
				status: "resolved",
			}),
		]);

		add("software_offers", [
			rows.softwareOffer("o0", "r0", {
				status: "superseded",
				msa_template_id: "template-msa",
				sow_template_id: "template-sow",
				contractor_snapshot_json: JSON.stringify({
					...CONTRACTOR,
					config_version: 1,
				}),
				recipient_email_snapshot: CLIENT_EMAIL,
			}),
		]);
	}

	if (s.offer !== false) add("software_offers", [offerRow(s.offer)]);

	if (s.link !== false)
		add("software_offer_links", [
			rows.offerLink("r1", { token_hash: sha(TOKEN), ...s.link }),
		]);

	if (s.reused) {
		add("software_agreements", [
			{
				...agreementRow("msa", s.reused, {
					id: OLD_MSA_ID,
					offer: "o0",
					request: "r0",
					msaId: null,
				}),
				canonical_text: OLD_MSA_TEXT,
				text_sha256: OLD_MSA_HASH,
				...s.reused.row,
			},
		]);

		const old = withSignatures(s.reused, OLD_MSA_ID, OLD_MSA_HASH);

		add("software_agreement_signatures", old.software_agreement_signatures);
		add("software_agreement_artifacts", old.software_agreement_artifacts);
	}

	const msaId = s.reused ? OLD_MSA_ID : msaDoc ? MSA_ID : null;

	if (msaDoc && !s.reused)
		add("software_agreements", [
			agreementRow("msa", msaDoc, {
				id: MSA_ID,
				offer: "o1",
				request: "r1",
				msaId: null,
			}),
		]);

	if (sowDoc)
		add("software_agreements", [
			agreementRow("sow", sowDoc, {
				id: SOW_ID,
				offer: "o1",
				request: "r1",
				msaId,
			}),
		]);

	if (msaDoc && !s.reused) {
		const parts = withSignatures(msaDoc, MSA_ID, MSA_HASH);

		add("software_agreement_signatures", parts.software_agreement_signatures);
		add("software_agreement_artifacts", parts.software_agreement_artifacts);
	}

	if (sowDoc) {
		const parts = withSignatures(sowDoc, SOW_ID, SOW_HASH);

		add("software_agreement_signatures", parts.software_agreement_signatures);
		add("software_agreement_artifacts", parts.software_agreement_artifacts);

		const deliveries =
			s.deliveries === undefined
				? sowDoc.status === "executed"
					? deliveryRows("pending")
					: []
				: s.deliveries || [];

		add("software_agreement_deliveries", deliveries);

		const notifications =
			s.notifications === undefined
				? sowDoc.status === "client_signed"
					? notificationRows("pending")
					: []
				: s.notifications || [];

		add("software_agreement_notifications", notifications);
	}

	if (s.session !== false) {
		add("software_agreement_links", [linkRow()]);
		add("software_agreement_sessions", [sessionRow(s.session)]);
	}

	if (s.draft !== undefined && s.draft !== false)
		add("software_agreement_drafts", [
			{
				offer_id: "o1",
				recipient_email: CLIENT_EMAIL,
				values_json: JSON.stringify(DRAFT),
				updated_at: EARLIER,
				...s.draft,
			},
		]);

	for (const [table, extra] of Object.entries(s.extra ?? {})) add(table, extra);

	const seedTables = Object.fromEntries(
		[
			...ORDER,
			...Object.keys(tables).filter((t) => !ORDER.includes(t)),
		].flatMap((table) =>
			tables[table]?.length ? [[table, tables[table]]] : [],
		),
	);

	return {
		music: { seed: seedTables },
		setup: (world: World) => {
			if (s.signing !== false)
				world.music.exec(
					"UPDATE software_signing_settings SET software_signing_enabled=1",
				);

			if (s.reused && s.offer !== false)
				world.music.exec(
					`UPDATE software_offers SET reused_msa_id='${OLD_MSA_ID}' WHERE id='o1'`,
				);
		},
	};
}

/** The tables a signing case dumps. */
export const signingTables = [
	"software_agreements",
	"software_agreement_signatures",
	"software_agreement_events",
	"software_agreement_notifications",
	"software_agreement_notices",
	"software_agreement_deliveries",
	"software_agreement_artifacts",
	"software_agreement_drafts",
	"software_agreement_sessions",
	"software_agreement_links",
	"software_agreement_clients",
	"software_offers",
	"software_offer_links",
	"software_projects",
	"software_invoices",
];

/** Resend accepts every message. */
export const resendOk: Responder = byHost({
	resend: json(200, { id: "em_1" }),
});

/** Resend answers the n-th message with the n-th answer (the last repeats). */
export const resend = (...answers: FetchAnswer[]): Responder =>
	byHost({ resend: answers });

// ---------------------------------------------------------------------------------------------------------------------
// A stored PDF, for a reused MSA whose original signed copy the packet is built from.
// ---------------------------------------------------------------------------------------------------------------------

async function originalPdf() {
	const pdf = await PDFDocument.create({ updateMetadata: false });
	pdf.addPage([612, 792]);

	return pdf.save({ useObjectStreams: false });
}

export const ORIGINAL_PDF = await originalPdf();

export const ORIGINAL_PDF_HASH = createHash("sha256")
	.update(ORIGINAL_PDF)
	.digest("hex");

export const OLD_PDF_KEY = `agreements/${OLD_MSA_ID}/original.pdf`;

/** The artifact row of an executed agreement whose packet is stored in R2. */
export const readyArtifact = (
	id: string,
	key: string,
	hash: string,
	size: number,
): SeedRow => ({
	status: "ready",
	pdf_key: key,
	pdf_sha256: hash,
	certificate_key: `${key}.certificate.json`,
	certificate_sha256: "c".repeat(64),
	manifest_json: "{}",
	bytes: size,
	renderer_version: "website-pdf-v2",
	ready_at: EARLIER,
	agreement_id: id,
});

// ---------------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------------

export const SIGN_PATH = `/api/offer/${TOKEN}/sign`;
export const OWNER_PATH = "/api/owner/requests/r1/agreement";
const ORIGIN = "https://thesuperhuman.us";

export const cookie = (token: string | null = SESSION) =>
	Object.fromEntries(
		token === null ? [] : [["cookie", `agreement_session=${token}`]],
	);

type Body = JsonValue | undefined;

const encode = (fields: { [name: string]: string | undefined }) =>
	new URLSearchParams(
		Object.entries(fields).flatMap(([name, value]) =>
			value === undefined ? [] : [[name, value]],
		),
	).toString();

export const FORM = "application/x-www-form-urlencoded";

const browser = () =>
	asVisitor({
		ip: "203.0.113.9",
		headers: { "user-agent": "golden-browser" },
	});

/** The client's JSON request. */
export const signJson = (body: Body, extra: Partial<Step> = {}): Step => ({
	as: browser(),
	path: SIGN_PATH,
	params: { token: TOKEN },
	json: body,
	headers: { origin: ORIGIN, ...cookie() },
	dump: { music: signingTables },
	...extra,
});

/** The client's native form post. */
export const signForm = (
	fields: { [name: string]: string | undefined },
	extra: Partial<Step> = {},
): Step => ({
	as: browser(),
	path: SIGN_PATH,
	params: { token: TOKEN },
	body: encode(fields),
	headers: { origin: ORIGIN, "content-type": FORM, ...cookie() },
	dump: { music: signingTables },
	...extra,
});

/** The good body of a sign request. */
export const signBody = (over: { [name: string]: JsonValue } = {}) => ({
	csrf_nonce: CSRF,
	documents: BOTH,
	consent: true,
	...over,
});

/** The good fields of a sign form. */
export const signFields = (
	over: { [name: string]: string | undefined } = {},
) => ({
	csrf_nonce: CSRF,
	documents: JSON.stringify(BOTH),
	consent: "true",
	...over,
});

/** The owner's JSON request. */
export const ownerJson = (body: Body, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: OWNER_PATH,
	params: { id: "r1" },
	json: body,
	headers: { origin: ORIGIN },
	dump: { music: signingTables, r2: true },
	...extra,
});

/** The owner's native form post. */
export const ownerForm = (
	fields: { [name: string]: string | undefined },
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	path: OWNER_PATH,
	params: { id: "r1" },
	body: encode(fields),
	headers: { origin: ORIGIN, "content-type": FORM },
	dump: { music: signingTables, r2: true },
	...extra,
});

export const countersignBody = (over: { [name: string]: JsonValue } = {}) => ({
	action: "countersign",
	documents: BOTH,
	typed_name: "Kazon Wilson",
	consent: true,
	...over,
});

export const abandonBody = (over: { [name: string]: JsonValue } = {}) => ({
	action: "abandon",
	documents: BOTH,
	reason: "The client asked to change the scope",
	confirmed: true,
	...over,
});

/** A client who has signed both documents and waits for the countersignature. */
export const clientSigned = (over: Scene = {}): Scene => ({
	msa: doc("client_signed"),
	sow: doc("client_signed"),
	...over,
});

/** Both documents executed. */
export const executed = (over: Scene = {}): Scene => ({
	msa: doc("executed"),
	sow: doc("executed"),
	...over,
});

/** JSON body fields as the fields of a native form post: text as it is, everything else as JSON text. */
export const formFields = (
	body: Loose,
): { [name: string]: string | undefined } =>
	Object.fromEntries(
		Object.entries(body).flatMap(([name, value]) =>
			value === undefined || value === null
				? []
				: [[name, isText(value) ? value : JSON.stringify(value)]],
		),
	);

// ---------------------------------------------------------------------------------------------------------------------
// Owner cases: a JSON request and its native form twin from one definition
// ---------------------------------------------------------------------------------------------------------------------

/** Resend is not configured, so no email (and no packet) is sent. Most cases do not need the 400 KB mail body in the fixture. */
export const quiet: Pick<Case, "omit"> = { omit: ["RESEND_API_KEY"] };

/** An owner request with a JSON body. */
export const own = (
	name: string,
	sc: Scene,
	body: Body,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	...scene(sc),
	...quiet,
	steps: [ownerJson(body, over)],
	...extra,
});

/** The same request as an urlencoded form: the name starts with "form:". */
export const ownForm = (
	name: string,
	sc: Scene,
	body: Loose,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name: `form: ${name}`,
	...scene(sc),
	...quiet,
	steps: [ownerForm(formFields(body), over)],
	...extra,
});

/** A JSON case and its form twin. */
export const ownBoth = (
	name: string,
	sc: Scene,
	body: Loose,
	extra: Partial<Case> = {},
): Case[] => [own(name, sc, body, extra), ownForm(name, sc, body, extra)];

/** An owner request, repeated: each body in turn against the same database. */
export const ownSeq = (
	name: string,
	sc: Scene,
	bodies: Body[],
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(sc),
	...quiet,
	steps: bodies.map((body) => ownerJson(body)),
	...extra,
});

/** Headers of an owner request, each part optional. */
export const ownerHeaders = (
	over: { origin?: string | null; type?: string | null } = {},
) =>
	Object.fromEntries([
		...(over.origin === null
			? []
			: [["origin", over.origin ?? "https://thesuperhuman.us"]]),
		...(over.type === null
			? []
			: [["content-type", over.type ?? "application/json"]]),
	]);

export const ID = SOW_ID;

/** A retry-artifact, retry-copy, hold, end or record-alternate-copy body for an agreement. */
export const forAgreement = (
	action: string,
	over: { [name: string]: JsonValue } = {},
	id: string = SOW_ID,
) => ({ action, agreement_id: id, ...over });

/** A reused, already executed MSA with its stored packet in R2. */
export const reusedReady = doc("executed", {
	artifact: readyArtifact(
		OLD_MSA_ID,
		OLD_PDF_KEY,
		ORIGINAL_PDF_HASH,
		ORIGINAL_PDF.length,
	),
});

/** The R2 object that goes with `reusedReady`. */
export const originalPacket = {
	[OLD_PDF_KEY]: {
		body: ORIGINAL_PDF,
		customMetadata: { sha256: ORIGINAL_PDF_HASH },
	},
};

/** An unused agreement link of the offer, so an abandon shows it being closed. */
export const openLink: SeedRow = {
	id: "link-2",
	purpose: "agreement",
	offer_id: "o1",
	link_hash: sha(TOKEN),
	recipient_email: CLIENT_EMAIL,
	token_hash: "link-key-hash-2",
	issued_at: PAST,
	expires_at: LATER,
	used_at: null,
};

/** The deposit invoice of offer o1 in a status. */
export const deposit = (status: string, over: SeedRow = {}): SeedRow =>
	rows.softwareInvoice("si1", "r1", "o1", { status, ...over });

/** Where the packet of the default executed scene is stored (the key holds the hash of its signing certificate). */
export const MSA_PDF_KEY =
	"agreements/00000000-0000-4000-8000-0000000000a1/ecd95f566a3714e9de8b97eed942c7527d29dce1c1c9b93d61fd5eb37377d6c5.pdf";

export const SOW_PDF_KEY =
	"agreements/00000000-0000-4000-8000-0000000000a2/53eed54aab8b98634c30c342a4a15e45ca5e15d5d9e84b9e8f66b6adb9272a70.pdf";

/** Packets already stored for both documents of the default executed scene, so no packet is rendered (and the mail stays small). */
export const storedPackets = {
	[MSA_PDF_KEY]: {
		body: ORIGINAL_PDF,
		customMetadata: { sha256: ORIGINAL_PDF_HASH },
	},
	[SOW_PDF_KEY]: {
		body: ORIGINAL_PDF,
		customMetadata: { sha256: ORIGINAL_PDF_HASH },
	},
};

/** A ready artifact row that points at a small stored PDF. */
export const readySmall = (id: string, key: string): SeedRow =>
	readyArtifact(id, key, ORIGINAL_PDF_HASH, ORIGINAL_PDF.length);

/** Both documents executed, with both packets ready and stored (small), and deliveries in a status. */
export const delivered = (
	status: string,
	over: SeedRow = {},
	sc: Scene = {},
): Scene => ({
	msa: doc("executed", { artifact: readySmall(MSA_ID, MSA_PDF_KEY) }),
	sow: doc("executed", { artifact: readySmall(SOW_ID, SOW_PDF_KEY) }),
	deliveries: deliveryRows(status, over),
	...sc,
});

/** The R2 content that goes with `delivered`. */
export const smallPackets = { r2: { seed: storedPackets } };
