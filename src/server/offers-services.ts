// The outside calls of the owner's software request actions (POST /api/owner/requests/[id]/software), as
// docs/plans/2026-11-offers-conversion.md, section 3, sets them out: the client email (the shared `Mail` service, with a
// live implementation of this route's own), the agreement attachments in R2 (through the shared `AudioBucket`), and the
// preflight of the agreement packet. Each wraps the function the route calls today, and names each way it can fail that
// the route answers differently; the route, not these, decides what the owner sees.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { hashBytes } from "../lib/agreement-artifacts";
import type { AgreementDetails, Contractor } from "../lib/agreement-fields";
import type { AgreementTemplate } from "../lib/agreement-templates";
import { sendAudioMessage } from "../lib/audio-resend";
import type { OfferTerms } from "../lib/software-offers";
import type { MailSettings } from "./rules/software-request";
import {
	AudioBucket,
	Mail,
	type MailMessage,
	MailRefused,
	MailUncertain,
} from "./services";

// ---- mail ----

/** What sendAudioMessage is asked to send. */
type AudioRequest = Parameters<typeof sendAudioMessage>[0];

type AudioPayload = AudioRequest["payload"];

/**
 * The mail settings a question, a decline and a send need, all set: the Resend key, the sender (CONTACT_FROM_EMAIL) and
 * the owner (OWNER_EMAIL, replied to and sent the copy). Null when any is missing or empty, as the route has always
 * checked them; then no email is attempted.
 */
export function offerMailSettings(
	env: Pick<Env, "RESEND_API_KEY" | "CONTACT_FROM_EMAIL" | "OWNER_EMAIL">,
): (MailSettings & { readonly apiKey: string }) | null {
	return env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL && env.OWNER_EMAIL
		? {
				apiKey: env.RESEND_API_KEY,
				from: env.CONTACT_FROM_EMAIL,
				owner: env.OWNER_EMAIL,
			}
		: null;
}

/**
 * The payload Resend is sent, with its keys in the order this route has always sent them: from, reply_to, subject, text,
 * to (its copy spread the client's payload, overwrote `subject` in place and added `to` last), then html and attachments,
 * which these emails never carry. `sendAudioMessage` keeps the order it is given and the golden corpus records the request
 * body as text, so the order is part of what was sent; `liveMail` (src/server/services.ts) writes from, to, subject, text,
 * reply_to, which is why this route has a Mail of its own.
 */
export function offerPayload(message: MailMessage): AudioPayload {
	const head =
		message.reply_to === undefined
			? { from: message.from }
			: { from: message.from, reply_to: message.reply_to };

	const payload: AudioPayload = {
		...head,
		subject: message.subject,
		text: message.text,
		to: [...message.to],
	};

	if (message.html !== undefined) payload.html = message.html;

	if (message.attachments !== undefined)
		payload.attachments = [...message.attachments];

	return payload;
}

/**
 * Mail through Resend for this route, signed with `apiKey` (env.RESEND_API_KEY): `sendAudioMessage` with the payload
 * above. Refused for an answer that is not a success below 500; uncertain for a 5xx, a timeout or no answer.
 */
export const liveOfferMail = (apiKey: string) =>
	Context.make(Mail, {
		send: (message) =>
			// sendAudioMessage answers every failure as an outcome (the whole call is inside its try), so a rejection here would be a bug: a defect is intended.
			Effect.promise(() => {
				const request: AudioRequest = {
					apiKey,
					payload: offerPayload(message),
				};

				if (message.idempotencyKey !== undefined)
					request.idempotencyKey = message.idempotencyKey;

				return sendAudioMessage(request);
			}).pipe(
				Effect.flatMap(
					(sent): Effect.Effect<void, MailRefused | MailUncertain> =>
						sent.ok
							? Effect.void
							: Effect.fail(
									sent.uncertain === true
										? new MailUncertain()
										: new MailRefused(),
								),
				),
			),
	});

// ---- the agreement attachments in R2 ----

/**
 * R2 is needed (an attachment's bytes, or the reused MSA's signed copy for the preflight) and this deployment has no
 * AUDIO binding: a dependency it does not have. The route answers 503 with nothing written, and logs nothing.
 */
export class OffersStorageMissing extends Data.TaggedError(
	"OffersStorageMissing",
) {}

/** An R2 read of an attachment rejected: the object or its body. `failure` is for the route's log; it answers 500. */
export class AttachmentReadFailed extends Data.TaggedError(
	"AttachmentReadFailed",
)<{ readonly failure: unknown }> {}

/** The attachment's bytes could not be hashed. Answered as incomplete details, as the route always has. */
export class AttachmentUnhashable extends Data.TaggedError(
	"AttachmentUnhashable",
) {}

/**
 * The R2 delete of a removed attachment failed, or there is no binding to delete it with. The draft is saved: the flow
 * puts the attachment's metadata row back and answers with its cleanup pending.
 */
export class AttachmentRemoveFailed extends Data.TaggedError(
	"AttachmentRemoveFailed",
) {}

/** An attachment's object in R2: its size, and the SHA-256 of its bytes, read only when asked for. */
export type AttachmentObject = {
	readonly size: number;
	readonly sha256: () => Effect.Effect<
		string,
		AttachmentReadFailed | AttachmentUnhashable
	>;
};

/**
 * The agreement attachments in R2, through the `AudioBucket` service. The route asks `bindingsOrUnavailable` for MUSIC_DB
 * only, and `AudioBucket` is provided only when env.AUDIO is set, so each call reads it with `Effect.serviceOption`: a
 * missing binding is an absent service, not a missing requirement.
 */
export const AttachmentStore = {
	/** Deletes a removed attachment's object (a draft's cleanup). With no binding it fails as a failed delete does. */
	remove: (key: string) =>
		Effect.gen(function* () {
			const bucket = yield* Effect.serviceOption(AudioBucket);

			if (Option.isNone(bucket))
				return yield* Effect.fail(new AttachmentRemoveFailed());

			yield* Effect.tryPromise({
				try: () => bucket.value.delete(key),
				catch: () => new AttachmentRemoveFailed(),
			});
		}),
	/**
	 * Reads an attachment's object (a send's pin): null when R2 has none. Its bytes are read and hashed (`hashBytes`) only
	 * when `sha256` is asked for, so an object of the wrong size is never read, as before. With no binding it fails with
	 * OffersStorageMissing (F4, #313), at the point the first attachment is read.
	 */
	read: (key: string) =>
		Effect.gen(function* () {
			const bucket = yield* Effect.serviceOption(AudioBucket);

			if (Option.isNone(bucket))
				return yield* Effect.fail(new OffersStorageMissing());

			const object = yield* Effect.tryPromise({
				try: () => bucket.value.get(key),
				catch: (failure) => new AttachmentReadFailed({ failure }),
			});

			if (object === null) return null;

			const read: AttachmentObject = {
				size: object.size,
				sha256: () =>
					Effect.tryPromise({
						try: () => object.arrayBuffer(),
						catch: (failure) => new AttachmentReadFailed({ failure }),
					}).pipe(
						Effect.flatMap((bytes) =>
							Effect.tryPromise({
								try: () => hashBytes(bytes),
								catch: () => new AttachmentUnhashable(),
							}),
						),
					),
			};

			return read;
		}),
};

// ---- the agreement packet's preflight ----

/** What the preflight renders: the terms, the details, the contractor, the MSA and SOW templates and the reused MSA. */
export type PreflightPacket = {
	readonly terms: OfferTerms;
	readonly details: AgreementDetails;
	readonly contractor: Contractor;
	/** The MSA template, then the SOW template. */
	readonly templates: readonly [AgreementTemplate, AgreementTemplate];
	readonly reusedMsaId: string | null;
};

/** A D1 or R2 read the preflight makes rejected: the store failed. `failure` is for the route's log; it answers 500. */
export class PacketReadFailed extends Data.TaggedError("PacketReadFailed")<{
	readonly failure: unknown;
}> {}

/**
 * The packet does not render: a row or an object a read found missing, bytes whose hash differs or that are not a PDF, a
 * character the font cannot draw, a packet over the copy limit (or the preflight's module failed to load). Answered as
 * incomplete details with no errors; the preflight raises no reader's refusal, so it never had any.
 */
export class PacketNotReady extends Data.TaggedError("PacketNotReady") {}

export class AgreementPreflight extends Context.Service<
	AgreementPreflight,
	{
		readonly check: (
			packet: PreflightPacket,
		) => Effect.Effect<
			void,
			OffersStorageMissing | PacketReadFailed | PacketNotReady
		>;
	}
>()("site/AgreementPreflight") {}

/** The preflight's module: loaded only when a send preflights a packet, as the route has always loaded it. */
type PreflightModule = Pick<
	typeof import("../lib/agreement-pdf"),
	"preflightAgreementPacket" | "PreflightReadFailed"
>;

/**
 * `preflightAgreementPacket` (src/lib/agreement-pdf.ts) with the request's env, which it reads D1 and R2 through itself
 * (converting its insides is the signing area's work). A packet that reuses an MSA imports that MSA's signed copy from R2,
 * so with no AUDIO binding it fails with OffersStorageMissing before the module is loaded (#313). A rejection the
 * preflight's read wrapper marks (`PreflightReadFailed`) is PacketReadFailed; any other is PacketNotReady.
 */
export const liveAgreementPreflight = (
	env: Env,
	load: () => Promise<PreflightModule> = () => import("../lib/agreement-pdf"),
) =>
	Context.make(AgreementPreflight, {
		check: (packet) =>
			Effect.gen(function* () {
				if (packet.reusedMsaId && !env.AUDIO)
					return yield* Effect.fail(new OffersStorageMissing());

				const pdf = yield* Effect.tryPromise({
					try: load,
					catch: () => new PacketNotReady(),
				});

				yield* Effect.tryPromise({
					try: () =>
						pdf.preflightAgreementPacket(
							env,
							packet.terms,
							packet.details,
							packet.contractor,
							[...packet.templates],
							packet.reusedMsaId,
						),
					catch: (failure) =>
						failure instanceof pdf.PreflightReadFailed
							? new PacketReadFailed({ failure: failure.failure })
							: new PacketNotReady(),
				});
			}),
	});
