// Shared seed and step builders for the agreement-admin golden corpora: the owner agreements route (templates,
// configuration, signing setting, retention, access cleanup), offer attachments, and the agreement downloads. Nothing
// here changes the harness; it builds rows and hashes the way src/lib does so a case can start from an exact state.
import { PDFDocument } from "pdf-lib";
import { canonicalJson, hashBytes } from "~/lib/agreement-artifacts";
import { hashOfferToken } from "~/lib/software-offers";
import { templateFields } from "~/lib/agreement-templates";
import { isObject } from "~/lib/type-guards";
import { hashValue } from "~/lib/audio-client-access";
import type { JsonObject, JsonValue } from "../../helpers/json";
import {
	asOwner,
	rows,
	type Case,
	type Prior,
	type Seed,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const ORIGIN = "https://thesuperhuman.us";
export const SAME_ORIGIN = { origin: ORIGIN };
export const FORM_TYPE = "application/x-www-form-urlencoded";
export const FORM_HEADERS = { origin: ORIGIN, "content-type": FORM_TYPE };
export const OWNER = "owner@example.test";
export const GRACE = "grace@example.test";
export const ADA = "ada@example.test";
export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const LONG_AGO = "2025-01-01T00:00:00.000Z";
export const SHA = "0".repeat(64);
export const AGREEMENTS = "/api/owner/agreements";
export const BINDING = "AUDIO:superhuman-audio";

export { canonicalJson, hashBytes, hashOfferToken, hashValue };

/** A bare handler for a step that crosses routes is not needed; steps below post to the owner agreements route. */
export const act = (json: Step["json"], extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: AGREEMENTS,
	json,
	headers: SAME_ORIGIN,
	...extra,
});

/** A native form post: urlencoded fields, the same Origin check as the JSON wire format. */
export const form = (
	fields: { readonly [name: string]: string },
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	path: AGREEMENTS,
	body: new URLSearchParams(fields).toString(),
	headers: FORM_HEADERS,
	...extra,
});

/** A raw body with the JSON content type (malformed JSON, empty body). */
export const raw = (body: string, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: AGREEMENTS,
	body,
	headers: { ...SAME_ORIGIN, "content-type": "application/json" },
	...extra,
});

/** A template text that passes validateTemplate: every required field once, milestone fields inside the loop. */
export function templateText(kind: "msa" | "sow", title = "Agreement"): string {
	const fields = templateFields[kind];
	const line = (field: string) => `${field}: {{${field}}}`;

	if (kind === "msa") return [title, ...fields.map(line)].join("\n");

	return [
		title,
		...fields.filter((field) => !field.startsWith("milestone.")).map(line),
		"{{#milestones}}",
		...fields.filter((field) => field.startsWith("milestone.")).map(line),
		"{{/milestones}}",
	].join("\n");
}

export const MSA = templateText("msa", "Master Services Agreement");
export const SOW = templateText("sow", "Statement of Work");

/** A published template row. The text's hash is what publishTemplate computes (hashOfferToken of the canonical text). */
export async function templateRow(
	id: string,
	kind: "msa" | "sow",
	version: number,
	text: string,
	over: SeedRow = {},
): Promise<SeedRow> {
	return {
		id,
		kind,
		version,
		text,
		sha256: await hashOfferToken(text),
		published_at: EARLIER,
		published_by: OWNER,
		version_label: `L${version}`,
		source_revision: null,
		...over,
	};
}

/** Two templates of each kind, so a version has a previous one to compare with. */
export async function twoVersions(kind: "msa" | "sow"): Promise<SeedRow[]> {
	const base = kind === "msa" ? MSA : SOW;

	return [
		await templateRow(`${kind}-1`, kind, 1, base, {
			published_at: "2026-10-01T09:00:00.000Z",
		}),
		await templateRow(`${kind}-2`, kind, 2, `${base}\nExtra clause.`, {
			published_at: "2026-11-01T09:00:00.000Z",
		}),
	];
}

/** The contractor values the config action accepts. */
export const CONFIG_VALUES = {
	legal_name: "The Superhuman Group LLC",
	entity_jurisdiction: "Wyoming limited liability company",
	signer_name: "Kazon Wilson",
	signer_title: "Manager",
	notice_email: "Notices@Example.test",
	business_address: "30 N Gould St, Sheridan, WY",
	registered_agent_confirmed: true,
};

/** The raw urlencoded fields of a flat config form. */
export const configFields = (over: { [name: string]: string } = {}) => ({
	action: "config",
	expectedCurrentVersion: "0",
	legal_name: "The Superhuman Group LLC",
	entity_jurisdiction: "Wyoming limited liability company",
	signer_name: "Kazon Wilson",
	signer_title: "Manager",
	notice_email: "Notices@Example.test",
	business_address: "30 N Gould St, Sheridan, WY",
	registered_agent_confirmed: "on",
	...over,
});

/** A PDF that pdf-lib can load, with no timestamps so its bytes (and hash) never change. */
export async function pdfBytes(pages = 1): Promise<Uint8Array> {
	const pdf = await PDFDocument.create({ updateMetadata: false });

	for (let index = 0; index < pages; index++) pdf.addPage([200, 200]);

	return pdf.save();
}

export const PDF = await pdfBytes(1);
export const PDF_SHA = await hashBytes(PDF);

/** A seed of the request, offer and link a software agreement hangs off. */
export const offerSeed = (
	requestId: string,
	email = GRACE,
	over: { request?: SeedRow; offer?: SeedRow; link?: SeedRow } = {},
): Seed => ({
	owner_requests: [
		rows.softwareRequest(requestId, {
			email,
			status: "reviewed",
			...over.request,
		}),
	],
	software_offers: [
		rows.softwareOffer(`o-${requestId}`, requestId, {
			recipient_email_snapshot: email,
			...over.offer,
		}),
	],
	software_offer_links: [rows.offerLink(requestId, over.link)],
});

/** A zero-page PDF, which pdf-lib loads but the attachment route refuses. */
export const EMPTY_PDF = await (async () => {
	const pdf = await PDFDocument.create({ updateMetadata: false });

	return pdf.save({ addDefaultPage: false });
})();

/** Joins seeds table by table, keeping each table's rows in the order given. */
export function merge(...seeds: Seed[]): Seed {
	const out: { [table: string]: SeedRow[] } = {};

	for (const one of seeds)
		for (const [table, list] of Object.entries(one))
			out[table] = [...(out[table] ?? []), ...list];

	return out;
}

/** The templates and client every agreement points at, plus an SOW template. */
export const agreementTables = (): Seed =>
	merge(rows.agreementBase(), {
		software_agreement_templates: [
			{
				id: "template-sow",
				kind: "sow",
				version: 1,
				text: "SOW",
				sha256: SHA,
				published_at: EARLIER,
				published_by: OWNER,
			},
		],
	});

export const attachmentKey = (id: string) => `agreements/attachments/${id}.pdf`;

/** The `attachment_manifest_json` an agreement carries for these attachments (key and digest). */
export const manifestJson = (
	...items: readonly { key: string; sha256: string }[]
) => JSON.stringify(items.map(({ key, sha256 }) => ({ key, sha256 })));

/** An offer's `agreement_details_json` that pins these attachment keys. */
export const detailsJson = (...keys: readonly string[]) =>
	JSON.stringify({
		attachments: keys.map((key) => ({ key, sha256: PDF_SHA })),
	});

/** An executed SOW that has ended and may be retired: every retention condition holds. */
export const sowAgreement = (
	id: string,
	requestId: string,
	offerId: string,
	over: SeedRow = {},
): SeedRow =>
	rows.agreement(id, requestId, offerId, {
		kind: "sow",
		template_id: "template-sow",
		sow_number: "SOW-1",
		status: "executed",
		executed_at: EARLIER,
		ended_at: EARLIER,
		retain_until: EARLIER,
		legal_hold: 0,
		...over,
	});

/** An executed MSA with no signatures yet, which may be retired the same way. */
export const msaAgreement = (id: string, over: SeedRow = {}): SeedRow =>
	rows.agreement(id, `r-${id}`, "no-offer", {
		offer_id: null,
		status: "executed",
		executed_at: EARLIER,
		ended_at: EARLIER,
		retain_until: EARLIER,
		legal_hold: 0,
		...over,
	});

/** A scene around one retiring SOW: its request, a superseded offer and the agreement. */
export const sowScene = (
	n: number,
	over: { agreement?: SeedRow; offer?: SeedRow; request?: SeedRow } = {},
): Seed => ({
	owner_requests: [
		rows.softwareRequest(`r${n}`, {
			email: GRACE,
			status: "resolved",
			...over.request,
		}),
	],
	software_offers: [
		rows.softwareOffer(`o${n}`, `r${n}`, {
			status: "superseded",
			...over.offer,
		}),
	],
	software_agreements: [
		sowAgreement(`a${n}`, `r${n}`, `o${n}`, over.agreement),
	],
});

/** The stored objects of agreement `id`. */
export const objectsOf = (id: string) => ({
	[`agreements/${id}/signed.pdf`]: { body: `signed copy of ${id}` },
	[`agreements/${id}/certificate.pdf`]: { body: `certificate of ${id}` },
});

/** The rows that hang off an agreement and are deleted with it. */
export const evidenceOf = (id: string): Seed => ({
	software_agreement_artifacts: [
		{
			agreement_id: id,
			status: "ready",
			pdf_key: `agreements/${id}/signed.pdf`,
			pdf_sha256: SHA,
			certificate_key: `agreements/${id}/certificate.pdf`,
			certificate_sha256: SHA,
			ready_at: EARLIER,
		},
	],
	software_agreement_deliveries: [
		{
			agreement_id: id,
			recipient_role: "client",
			email: GRACE,
			status: "sent",
		},
	],
	software_agreement_notifications: [
		{
			agreement_id: id,
			kind: "signature-receipt",
			email: GRACE,
			status: "sent",
		},
	],
	software_agreement_notices: [
		{
			id: `notice-${id}`,
			agreement_id: id,
			client_id: "client-1",
			business_address: "1 Main St",
			notice_email: GRACE,
			recorded_at: EARLIER,
		},
	],
	software_agreement_events: [
		{
			id: `event-${id}`,
			agreement_id: id,
			offer_id: null,
			action: "countersigned",
			actor: OWNER,
			occurred_at: EARLIER,
			reason: null,
		},
	],
	software_agreement_signatures: [
		{
			id: `sig-${id}`,
			agreement_id: id,
			party: "client",
			typed_name: "Grace Hopper",
			title: "Founder",
			consent_text: "I agree",
			consent_version: "v1",
			consent_at: EARLIER,
			signed_at: EARLIER,
			document_sha256: SHA,
			session_token_hash: null,
			owner_subject: null,
			verified_email: GRACE,
			verified_at: EARLIER,
			verification_method: "email-link",
			intent_text: "intent",
			document_list_json: "[]",
			receipt_id: `receipt-${id}`,
			ip_address: "203.0.113.9",
			user_agent: "test",
		},
	],
});

/** Metadata for an uploaded offer attachment. */
export const attachmentRow = (
	id: string,
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	filename: `${id}.pdf`,
	version: "1",
	document_date: "2026-10-01",
	object_key: attachmentKey(id),
	sha256: PDF_SHA,
	bytes: PDF.byteLength,
	created_at: LONG_AGO,
	created_by: OWNER,
	...over,
});

/** The tables a retention case records at its end, and the bucket. */
export const RETENTION_DUMP = {
	music: [
		"software_agreements",
		"software_agreement_artifacts",
		"software_agreement_deliveries",
		"software_agreement_notifications",
		"software_agreement_notices",
		"software_agreement_events",
		"software_agreement_signatures",
		"software_agreement_attachments",
		"software_agreement_retention_receipts",
		"software_agreement_clients",
		"software_offers",
		"software_projects",
	],
	r2: true,
} as const;

/** The manifest a step's answer carried, for a later step to send back (or alter). */
export function manifestOf(prior: Prior, step = 0): JsonObject {
	const manifest = prior.answerJson(step).manifest;

	return isObject(manifest) && !Array.isArray(manifest) ? manifest : {};
}

/** The retention-apply body for a manifest. */
export const applying = (manifest: JsonValue | undefined): JsonObject => ({
	action: "retention-apply",
	confirmed: true,
	manifest,
});

export const THIRTY_DAYS = 30 * 86_400_000;
export const DAY = 86_400_000;

/** Runs raw SQL on MUSIC_DB before the first step (off the record), for a state the seed cannot say. */
export const sql =
	(...statements: string[]) =>
	(world: World) => {
		for (const statement of statements) world.music.exec(statement);
	};

/** Raw SQL for an interleave: another writer's change between the route's read and its write. */
export const run =
	(statement: string) => (sqlite: { exec(sql: string): void }) =>
		sqlite.exec(statement);

export const retentionEnv = { AGREEMENT_RETENTION_BINDING_ID: BINDING };

export type Scene = {
	readonly seed?: Seed;
	readonly r2?: { [key: string]: { body: string | Uint8Array } };
	readonly setup?: string[];
};

/** The shared tables plus the given scenes, with the bucket holding their objects. */
export const world = (o: Scene = {}): Partial<Case> => ({
	music: { seed: merge(agreementTables(), o.seed ?? {}) },
	r2: { seed: o.r2 ?? {} },
	env: retentionEnv,
	setup: o.setup ? sql(...o.setup) : undefined,
});

export const one = (over: SeedRow = {}, extra: Scene = {}): Scene => ({
	seed: merge(sowScene(1, { agreement: over }), extra.seed ?? {}),
	r2: { ...objectsOf("a1"), ...extra.r2 },
	setup: extra.setup,
});

export const many = (count: number): Seed =>
	merge(
		...Array.from({ length: count }, (_, index) => {
			const n = index + 1;

			return sowScene(n, {
				agreement: { id: `a${String(n).padStart(3, "0")}` },
				offer: { id: `o${n}` },
			});
		}),
	);

export const pinned = (key: string) => detailsJson(key);

/** SQL that starts a project of a request on an offer, with extra columns and values. */
export const projectSql = (
	requestId: string,
	offerId: string,
	columns = "",
	values = "",
) =>
	`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at${columns}) VALUES('${requestId}','${offerId}','{}','standard','${EARLIER}','${EARLIER}','${EARLIER}','owner','${EARLIER}','${EARLIER}'${values})`;

/** The saved orphan-scan cursor key. */
export const MARKER = "agreements/retention/attachment-cursor.json";

/** A 43-character base64url cookie value (the only shape agreementSession accepts) and its SHA-256, which the database holds. */
export type Token = { readonly value: string; readonly hash: string };

export async function sessionToken(n: number): Promise<Token> {
	const value = `${"Q".repeat(42)}${"abcdefghijklmnop"[n]}`;

	return { value, hash: await hashOfferToken(value) };
}

export const ARCHIVE = await sessionToken(0);
export const SIGNING = await sessionToken(1);
export const OTHER_TOKEN = await sessionToken(2);

/** A studio_session cookie value (72 characters) and its hash, for a client signed in to the studio. */
export const STUDIO = `${"0".repeat(8)}-0000-4000-8000-${"1".repeat(12)}${"0".repeat(8)}-0000-4000-8000-${"2".repeat(12)}`;
export const STUDIO_HASH = await hashValue(STUDIO);

export const LATER = "2026-11-13T13:00:00.000Z";

export const linkRow = (
	id: string,
	purpose: "agreement" | "archive",
	over: SeedRow = {},
): SeedRow => ({
	id,
	purpose,
	offer_id: purpose === "agreement" ? "o-r1" : null,
	link_hash: purpose === "agreement" ? "hash-r1" : null,
	recipient_email: GRACE,
	token_hash: `link-token-${id}`,
	issued_at: EARLIER,
	expires_at: LATER,
	used_at: EARLIER,
	...over,
});

export const agreementSessionRow = (
	token: Token,
	purpose: "agreement" | "archive",
	over: SeedRow = {},
): SeedRow => ({
	token_hash: token.hash,
	purpose,
	offer_id: purpose === "agreement" ? "o-r1" : null,
	link_hash: purpose === "agreement" ? "hash-r1" : null,
	recipient_email: GRACE,
	link_id: purpose === "agreement" ? "l-signing" : "l-archive",
	verified_at: EARLIER,
	expires_at: LATER,
	revoked_at: null,
	csrf_nonce: "csrf-nonce",
	...over,
});

export const SIGNED_KEY = "agreements/a1/signed.pdf";

/**
 * An executed agreement a1 of request r1 (offer o-r1, sent, signing link live) with a ready artifact whose PDF is stored
 * under SIGNED_KEY (seed the bucket with `signedBucket()`), an archive session, a signing session, and a studio
 * session and software project for the same client. Everything is right; a case breaks one thing.
 */
export function downloadSeed(
	over: {
		agreement?: SeedRow;
		artifact?: SeedRow | null;
		offer?: SeedRow;
		request?: SeedRow;
		project?: SeedRow | null;
		extra?: Seed;
	} = {},
): Seed {
	return merge(
		agreementTables(),
		offerSeed("r1", GRACE, {
			offer: { status: "sent", ...over.offer },
			request: over.request,
		}),
		{
			software_agreements: [
				rows.agreement("a1", "r1", "o-r1", {
					status: "executed",
					executed_at: EARLIER,
					...over.agreement,
				}),
			],
			software_agreement_artifacts:
				over.artifact === null
					? []
					: [
							{
								agreement_id: "a1",
								status: "ready",
								pdf_key: SIGNED_KEY,
								pdf_sha256: PDF_SHA,
								certificate_key: "agreements/a1/certificate.pdf",
								certificate_sha256: SHA,
								ready_at: EARLIER,
								...over.artifact,
							},
						],
			software_agreement_links: [
				linkRow("l-archive", "archive"),
				linkRow("l-signing", "agreement"),
			],
			software_agreement_sessions: [
				agreementSessionRow(ARCHIVE, "archive"),
				agreementSessionRow(SIGNING, "agreement"),
			],
			audio_client_sessions: [
				{
					token_hash: STUDIO_HASH,
					email: GRACE,
					created_at: EARLIER,
					expires_at: "2026-11-27T11:00:00.000Z",
					last_seen_at: EARLIER,
				},
			],
			software_projects:
				over.project === null
					? []
					: [
							rows.softwareProject("r1", "o-r1", {
								agreement_id: "a1",
								...over.project,
							}),
						],
		},
		over.extra ?? {},
	);
}

/** A bucket holding the signed PDF at SIGNED_KEY. */
export const signedBucket = (key = SIGNED_KEY) => ({ [key]: { body: PDF } });

/** A cookie header for the agreement and studio sessions given. */
export const cookies = (...parts: readonly string[]) => ({
	cookie: parts.join("; "),
});

export const archiveCookie = (token: Token = ARCHIVE) =>
	`agreement_archive=${token.value}`;

export const signingCookie = (token: Token = SIGNING) =>
	`agreement_session=${token.value}`;

export const studioCookie = (value = STUDIO) => `studio_session=${value}`;
