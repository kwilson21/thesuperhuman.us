// The outside calls of the agreement routes that the shared services file does not already name
// (docs/plans/2026-11-signing-conversion.md, section 4): the agreement mail (src/lib/audio-resend.ts sendAudioMessage,
// which answers every outcome as a value), the studio allowance counter (the studio sign-in area's count,
// `countAllowance` in src/server/studio-signin-store.ts, decided by `takeAllowance` in
// src/server/rules/studio-allowance.ts), the agreement packet (its certificates, built from the rows the flow read
// through the store, and src/lib/agreement-pdf.ts renderAgreementPacket), the page count of an uploaded PDF (pdf-lib)
// and hashing. Each live service wraps what the routes call today, with the secret or binding the request's env gives,
// and names each way it can fail that a route answers differently; the route, not these, decides what is shown. A
// failure that carries `failure` is one the caller logs once (through logUnexpected, or the packet's own line) before
// its fixed answer; a code key under 32 characters is CodeKeyUnusable, which the route answers 503 as today.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
	canonicalJson,
	hashBytes,
	newYorkTime,
	type SignatureRecord,
	type SigningCertificate,
} from "../lib/agreement-artifacts";
import type { StoredAgreementValues } from "../lib/agreement-fields";
import { templateVersionLabel } from "../lib/agreement-version-label";
import { sendAudioMessage } from "../lib/audio-resend";
import { codeKeyUsable, keyedHash } from "../lib/client-portal";
import type { Agreement } from "../lib/software-agreements";
import { hashOfferToken } from "../lib/software-offers";
import { isText } from "../lib/type-guards";
import type { CountedUse } from "./rules/signing-link";
import { allowanceTimes, takeAllowance } from "./rules/studio-allowance";
import { MusicDb } from "./services";
import { CodeKeyUnusable } from "./signin-services";
import { countAllowance } from "./studio-signin-store";

// ---- the mail ----

/** What Resend said about one message: sent, refused, or not known (the send may have happened). */
export type MailOutcome = "sent" | "refused" | "uncertain";

/**
 * One agreement email: from, to, subject and text, then the html body, reply address or attachments the email has. Resend
 * is sent the payload as the caller built it: `sendAudioMessage` keeps its key order and the golden corpora record the
 * request body as text, so each caller writes its keys in the order its email has always had (a link: from, to, subject,
 * text, html; a signed copy: from, to, subject, text, attachments; a signing notice: from, to, subject, text).
 */
export type AgreementMailMessage = Parameters<
	typeof sendAudioMessage
>[0]["payload"];

/** The mail call rejected, which its callee is written never to do. The route logs the cause and answers its fixed 500. */
export class AgreementMailFailed extends Data.TaggedError(
	"AgreementMailFailed",
)<{ readonly failure: unknown }> {}

export class AgreementMail extends Context.Service<
	AgreementMail,
	{
		/**
		 * Sends one email. `idempotencyKey`, when given, is sent as Resend's Idempotency-Key header, as the signed copies
		 * (`agreement-<id>-<role>-<pdf sha256>`) and the signing notices (`agreement-<id>-<kind>`) send it today; the links
		 * send none.
		 */
		readonly send: (
			payload: AgreementMailMessage,
			idempotencyKey?: string,
		) => Effect.Effect<MailOutcome, AgreementMailFailed>;
	}
>()("site/AgreementMail") {}

/** The agreement mail through Resend, signed with `apiKey` (env.RESEND_API_KEY). */
export const liveAgreementMail = (apiKey: string) =>
	Context.make(AgreementMail, {
		send: (payload, idempotencyKey) =>
			Effect.tryPromise({
				try: () => sendAudioMessage({ apiKey, payload, idempotencyKey }),
				catch: (cause) => new AgreementMailFailed({ failure: cause }),
			}).pipe(
				Effect.map(
					(sent): MailOutcome =>
						sent.ok ? "sent" : sent.uncertain ? "uncertain" : "refused",
				),
			),
	});

/**
 * A file attached to an email, its bytes in base64 as the signed copy has always carried its PDF
 * (`deliverAgreementCopies` in src/lib/agreement-artifacts.ts: 8,192 bytes at a time through `btoa`).
 */
export function mailAttachment(filename: string, bytes: Uint8Array) {
	let text = "";

	for (let i = 0; i < bytes.length; i += 8192)
		text += String.fromCharCode(...bytes.subarray(i, i + 8192));

	return { filename, content: btoa(text) };
}

// ---- the allowance ----

/** The allowance counter or the keyed hash rejected. The route logs the cause and answers its fixed 500. */
export class AgreementAllowanceFailed extends Data.TaggedError(
	"AgreementAllowanceFailed",
)<{ readonly failure: unknown }> {}

/**
 * One use an allowance counted: whether it is within the limit, the keyed hash it was counted under, and the start of the
 * window its count answered (`RETURNING uses,window_start`). A signing link whose mail is refused gives each use back by
 * its key and window start (`refundAllowances` in src/server/rules/signing-link.ts). A count that came back with no row
 * (which the upsert never does) is refused, and its window start is empty, as `reserveStudioAllowance` answered it; a
 * refused use answers 429 before any mail, so it is never given back.
 */
export type AllowanceUse = CountedUse & { readonly allowed: boolean };

export class AgreementAllowance extends Context.Service<
	AgreementAllowance,
	{
		/** Counts one use of `subject` under `scope` and says whether it is within `limit`, with the use counted. */
		readonly reserve: (
			scope: string,
			subject: string,
			limit: number,
		) => Effect.Effect<
			AllowanceUse,
			AgreementAllowanceFailed | CodeKeyUnusable
		>;
		/** A keyed hash of `message` with the code key. */
		readonly keyed: (
			message: string,
		) => Effect.Effect<string, AgreementAllowanceFailed | CodeKeyUnusable>;
	}
>()("site/AgreementAllowance") {}

/**
 * A keyed hash of `message` with `secret`. A code key under 32 characters is CodeKeyUnusable before anything is hashed (the
 * signing link answers it 503 where the first keyed hash fails it today, after the setting, the offer and the recipient
 * are read; the archive link refuses such a key before it reads anything); any other rejection is AgreementAllowanceFailed.
 */
const keyedWith = (secret: string, message: string) =>
	codeKeyUsable(secret)
		? Effect.tryPromise({
				try: () => keyedHash(secret, message),
				catch: (cause) => new AgreementAllowanceFailed({ failure: cause }),
			})
		: Effect.fail(new CodeKeyUnusable());

/**
 * The allowance counter in D1, keyed with the request's code key (env.AUDIO_CLIENT_CODE_KEY). A use reads the clock as it
 * is counted, then makes the key (the keyed hash of the scope and the subject) and counts it in one batch (the stale
 * windows pruned, the use counted); the allowance rule says whether it is within `limit`. The statements and their values
 * are the ones the studio sign-in routes count with, and the ones `reserveStudioAllowance` (src/lib/audio-client-access.ts)
 * ran. A code key under 32 characters is CodeKeyUnusable before the clock is read, as today's signing link checks the key
 * before its first use is counted.
 */
export const liveAgreementAllowance = (db: D1Database, secret: string) =>
	Context.make(AgreementAllowance, {
		reserve: (scope, subject, limit) =>
			Effect.gen(function* () {
				if (!codeKeyUsable(secret))
					return yield* Effect.fail(new CodeKeyUnusable());

				const at = new Date();
				const key = yield* keyedWith(secret, `${scope}:${subject}`);

				const count = yield* countAllowance(key, allowanceTimes(at)).pipe(
					Effect.provideService(MusicDb, db),
					Effect.catchTags({
						StudioSigninStoreFailed: (failed) =>
							Effect.fail(
								new AgreementAllowanceFailed({ failure: failed.failure }),
							),
					}),
				);

				const allowed = yield* takeAllowance
					.decide({ limit }, { uses: count.uses })
					.pipe(
						Effect.as(true),
						Effect.catchTags({ AllowanceSpent: () => Effect.succeed(false) }),
					);

				const use: AllowanceUse = {
					key,
					window_start: count.window_start ?? "",
					allowed,
				};

				return use;
			}),
		keyed: (message) => keyedWith(secret, message),
	});

// ---- the agreement packet ----

/** The renderer's module, imported as the owner route imports it. */
export type PacketModule = Pick<
	typeof import("../lib/agreement-pdf"),
	"renderAgreementPacket"
>;

/**
 * The renderer's module could not be imported. Today the owner route imports it before it reads the MSA's id, outside the
 * packet's own handling, so this is not logged as a packet failure: countersign's best-effort step stops at it, and
 * retry-artifact answers it as the route's failure. `failure` is the rejection, for the route's log.
 */
export class RendererNotLoaded extends Data.TaggedError("RendererNotLoaded")<{
	readonly failure: unknown;
}> {}

/**
 * The packet was not rendered: what today's certificate and render code threw or rejected with, as it was (a values
 * record that is not JSON or lacks a field, a manifest that is not JSON, a missing signature, the renderer's refusal, a
 * stored packet whose hash differs, a packet over 25 MiB). The packet flow logs its name and message on today's line
 * ("Agreement artifact preparation failed:", with "Invalid JSON." for a SyntaxError) and marks the attempt failed at
 * "render".
 */
export class PacketNotRendered extends Data.TaggedError("PacketNotRendered")<{
	readonly failure: unknown;
}> {}

/**
 * What the packet flow read through the store for one document of the packet, before its certificate is built: its
 * template's source revision and label rows (`readTemplateSourceRevision`, `readTemplateLabel`; null when no template has
 * its id) and its signatures by party (`readDocumentSignatures`). Today's code made these reads inside the certificates'
 * `Promise.all`, each only where the document's stored values lack the revision or the label; the certificate uses a row
 * only there.
 */
export type CertificateReads = {
	readonly sourceRevision: { readonly source_revision: string | null } | null;
	readonly label: {
		readonly version_label: string | null;
		readonly published_at: string;
	} | null;
	readonly signatures: readonly SignatureRecord[];
};

/** The packet's certificates and the keys their hash names, in the order today's code makes them. */
export type CertifiedPacket = {
	/** The display certificates the renderer prints, one per document. */
	readonly certificates: readonly SigningCertificate[];
	/** The certificates as canonical JSON, and the hash that names the packet's keys. */
	readonly certificate: string;
	readonly certificateHash: string;
	/** `agreements/<id>/<certificate sha256>.pdf`, where the flow looks for a stored packet first. */
	readonly key: string;
	/** `agreements/<id>/<certificate sha256>.certificate.json`. */
	readonly certificateKey: string;
	/** `agreements/<id>/<certificate sha256>.manifest.json`. */
	readonly manifestKey: string;
};

/** A packet already stored under the certified key, as the flow read it from the bucket: its bytes and recorded hash. */
export type StoredPacketBytes = {
	readonly bytes: Uint8Array;
	/** The object's `customMetadata.sha256`, which may be missing. */
	readonly sha256: string | undefined;
};

/** What the packet flow stores for a rendered packet. */
export type RenderedPacket = {
	/** The packet's bytes: the stored packet's, or the renderer's. */
	readonly bytes: Uint8Array;
	/** Whether a packet was already stored under the key, so it is not put again. */
	readonly alreadyStored: boolean;
	readonly pdfHash: string;
	readonly manifest: string;
};

export class AgreementPacket extends Context.Service<
	AgreementPacket,
	{
		/** Imports the renderer's module, where the owner route imports it today. */
		readonly load: Effect.Effect<void, RendererNotLoaded>;
		/**
		 * Today's certificate code for agreement `id`, from the documents (its MSA first when it names one, then the
		 * agreement) and what the flow read for each, in the same order: the certificates, the display certificates, their
		 * hash and the packet's keys. Nothing is read or written.
		 */
		readonly certify: (
			id: string,
			documents: readonly Agreement[],
			reads: readonly CertificateReads[],
		) => Effect.Effect<CertifiedPacket, PacketNotRendered>;
		/**
		 * The packet: the stored one the flow read under the certified key (refused when its recorded hash differs), or
		 * the renderer's, then its size check, its hash and its manifest, as today. Nothing is written.
		 */
		readonly render: (
			documents: readonly Agreement[],
			certified: CertifiedPacket,
			stored: StoredPacketBytes | null,
		) => Effect.Effect<RenderedPacket, PacketNotRendered>;
	}
>()("site/AgreementPacket") {}

/** Each document's own label. Older stored values lack it, so the pinned template row the flow read supplies it (today's code). */
async function documentVersionLabel(d: Agreement, read: CertificateReads) {
	// SAFETY: agreementValues (agreement-fields.ts) writes values_json with msa and sow objects that include version_label for rows new enough to have one.
	const values: StoredAgreementValues = JSON.parse(d.values_json);

	const stored =
		d.kind === "msa" ? values.msa?.version_label : values.sow?.version_label;

	if (stored) return stored;

	return templateVersionLabel(read.label!);
}

/** Each document's template source revision. Older stored SOW values lack it, so the pinned template row the flow read supplies it (today's code). */
async function documentSourceRevision(d: Agreement, read: CertificateReads) {
	// SAFETY: agreementValues (agreement-fields.ts) also stores source_revision on those msa and sow objects, for rows new enough to have one.
	const values: StoredAgreementValues = JSON.parse(d.values_json);

	if (d.kind === "msa") return values.msa?.source_revision ?? "";

	const sowRevision = values.sow?.source_revision;

	if (isText(sowRevision)) return sowRevision;

	return read.sourceRevision?.source_revision ?? "";
}

/**
 * The certificates, their display form, their hash and the packet's keys: `prepareAgreementArtifact`'s code
 * (src/lib/agreement-artifacts.ts), statement for statement and in its order, with each of its three reads replaced by
 * the row the flow read. The certificates are still built side by side in one `Promise.all`, each document's JSON read in
 * today's order, so a record that lacks a field throws today's error, and of two broken documents the one today's code
 * reported is reported.
 */
async function certifyPacket(
	id: string,
	documents: readonly Agreement[],
	reads: readonly CertificateReads[],
): Promise<CertifiedPacket> {
	const certificates = await Promise.all(
		documents.map(async (d, index) => {
			// SAFETY: `certify` compared the lengths first, so every document has its reads.
			const read = reads[index] as CertificateReads;

			return {
				document_id: d.id,
				document_sha256: d.text_sha256,
				template_id: d.template_id,
				offer_id: d.offer_id,
				effective_on: d.effective_on,
				executed_at: d.executed_at,
				renderer_version: "website-pdf-v2",
				versions: {
					template:
						d.kind === "msa"
							? JSON.parse(d.values_json).msa?.template_version
							: JSON.parse(d.values_json).system?.template_version,
					offer: JSON.parse(d.values_json).sow?.version,
					contractor_config: JSON.parse(d.values_json).contractor
						.config_version,
					source_revision: await documentSourceRevision(d, read),
					version_label: await documentVersionLabel(d, read),
				},
				attachments: JSON.parse(d.attachment_manifest_json),
				signatures: [...read.signatures],
			};
		}),
	);

	if (certificates.some((c) => c.signatures.length !== 2))
		throw new Error("Missing signature.");

	const displayCertificates = certificates.map((c) => ({
		...c,
		executed_at_new_york: newYorkTime(c.executed_at),
		signatures: c.signatures.map((s) => ({
			...s,
			signed_at_new_york: newYorkTime(s.signed_at),
			verified_at_new_york: newYorkTime(s.verified_at),
		})),
	}));

	const certificate = canonicalJson(displayCertificates),
		certificateHash = await hashOfferToken(certificate);

	return {
		certificates: displayCertificates,
		certificate,
		certificateHash,
		key: `agreements/${id}/${certificateHash}.pdf`,
		certificateKey: `agreements/${id}/${certificateHash}.certificate.json`,
		manifestKey: `agreements/${id}/${certificateHash}.manifest.json`,
	};
}

/** The stored packet or a new render, its checks, hash and manifest: today's code after the stored packet's read. */
async function renderPacket(
	env: Env,
	renderer: PacketModule,
	documents: readonly Agreement[],
	certified: CertifiedPacket,
	stored: StoredPacketBytes | null,
): Promise<RenderedPacket> {
	const bytes = stored
		? stored.bytes
		: await renderer.renderAgreementPacket(
				env,
				[...documents],
				[...certified.certificates],
			);

	if (stored && stored.sha256 !== (await hashBytes(bytes)))
		throw new Error("Stored packet hash mismatch.");

	if (bytes.length > 25 * 1024 * 1024)
		throw new Error("Packet exceeds 25 MiB.");

	const pdfHash = await hashBytes(bytes),
		manifest = canonicalJson({
			documents: documents.map((d) => ({ id: d.id, sha256: d.text_sha256 })),
			certificate_sha256: certified.certificateHash,
			pdf_sha256: pdfHash,
			renderer_version: "website-pdf-v2",
		});

	return { bytes, alreadyStored: stored !== null, pdfHash, manifest };
}

/**
 * The packet, with the request's env, which the renderer reads through as it does today (the attachments, a reused MSA's
 * copy). The certificate reads and the stored packet's read are the flow's, through the store and the bucket; this only
 * builds and renders. `load` is today's dynamic import (src/pages/api/owner/requests/[id]/agreement.ts, countersign and
 * retry-artifact), made once: `render` uses the module `load` imported, or imports it then.
 */
export const liveAgreementPacket = (
	env: Env,
	load: () => Promise<PacketModule> = () => import("../lib/agreement-pdf"),
) => {
	let imported: Promise<PacketModule> | undefined;
	const loaded = () => (imported ??= load());

	return Context.make(AgreementPacket, {
		load: Effect.tryPromise({
			try: loaded,
			catch: (cause) => new RendererNotLoaded({ failure: cause }),
		}).pipe(Effect.asVoid),
		certify: (id, documents, reads) =>
			reads.length === documents.length
				? Effect.tryPromise({
						try: () => certifyPacket(id, documents, reads),
						catch: (cause) => new PacketNotRendered({ failure: cause }),
					})
				: Effect.die(new Error("A packet needs the reads of each document.")),
		render: (documents, certified, stored) =>
			Effect.tryPromise({
				try: async () =>
					renderPacket(env, await loaded(), documents, certified, stored),
				catch: (cause) => new PacketNotRendered({ failure: cause }),
			}),
	});
};

// ---- the page count of an uploaded PDF ----

/**
 * pdf-lib could not be loaded as a module: an unavailable dependency, which the upload answers 503 "The PDF could not be
 * validated. Use a supported PDF or sign outside the website." and does not log, as today.
 */
export class PdfLibUnavailable extends Data.TaggedError("PdfLibUnavailable") {}

/** pdf-lib could not load the bytes or count their pages (inside this file only: it answers as no page count). */
class PdfNotRead extends Data.TaggedError("PdfNotRead") {}

export class PdfCheck extends Context.Service<
	PdfCheck,
	{
		/**
		 * The number of pages pdf-lib reads in `bytes`, or null when it cannot load them or count their pages (the upload
		 * rule's PdfUnreadable, 400); 0 is a PDF with no pages.
		 */
		readonly pages: (
			bytes: Uint8Array,
		) => Effect.Effect<number | null, PdfLibUnavailable>;
	}
>()("site/PdfCheck") {}

/** What the check uses of pdf-lib. */
export type PdfLib = Pick<typeof import("pdf-lib"), "PDFDocument">;

/**
 * pdf-lib, imported when an upload is checked, as the upload route imports it today
 * (src/pages/api/owner/requests/[id]/agreement-attachments.ts), then `PDFDocument.load` and `getPageCount`.
 */
export const livePdfCheck = (
	load: () => Promise<PdfLib> = () => import("pdf-lib"),
) =>
	Context.make(PdfCheck, {
		pages: (bytes) =>
			Effect.gen(function* () {
				const pdfLib = yield* Effect.tryPromise({
					try: load,
					catch: () => new PdfLibUnavailable(),
				});

				return yield* Effect.tryPromise({
					try: async (): Promise<number | null> =>
						(await pdfLib.PDFDocument.load(bytes)).getPageCount(),
					catch: () => new PdfNotRead(),
				}).pipe(Effect.catchTags({ PdfNotRead: () => Effect.succeed(null) }));
			}),
	});

// ---- hashing ----

/** Hashing a token with the platform's digest rejected. The route logs the cause and answers its fixed 500. */
export class HashFailed extends Data.TaggedError("HashFailed")<{
	readonly failure: unknown;
}> {}

/** Hashes `value` with `hash` (the site's token hash or the bytes' digest) and names a failure. */
export const hashing = (hash: () => Promise<string>) =>
	Effect.tryPromise({
		try: hash,
		catch: (cause) => new HashFailed({ failure: cause }),
	});
