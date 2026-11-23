import type { APIRoute } from "astro";
import {
	nativeAgreementRoute,
	agreementRequest,
	nativeAgreementResponse,
} from "~/lib/agreement-request";
import { agreementJson, signingEnabled } from "~/lib/agreement-access";
import {
	countersignAgreements,
	offerAgreements,
	signatureIds,
	closeObsoleteAgreementNotifications,
} from "~/lib/software-agreements";
import { agreementEvent } from "~/lib/agreement-events";
import { readOwnerAgreementAction } from "~/lib/agreement-owner-input";
import {
	prepareAgreementArtifact,
	deliverAgreementCopies,
	deliverAgreementNotifications,
	currentSigningNotification,
	recoverAgreementRendering,
} from "~/lib/agreement-artifacts";
import { softwareGuard } from "~/lib/software-guard";
import type { SoftwareOffer } from "~/lib/software-offers";
import { StoreRejected, stored } from "~/lib/reader-message";
import { classifyFailure, logUnexpected } from "~/server/failure";

export const prerender = false;

const depositBlockMessage =
	"Void the deposit invoice first, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded.";

const openMsaMessage =
	"An open offer uses this agreement. Withdraw that offer first.";

const depositUse =
	"SELECT 1 FROM software_invoices WHERE offer_id=? AND milestone_index=0 AND kind='deposit' AND (status IN ('creating','open','payment_failed','uncollectible') OR (status='paid' AND refunded_at IS NULL))";

const msaUse =
	"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.reused_msa_id=? AND o.status IN ('draft','sent') AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)";

const changedOrFailed =
	"The agreement changed or the operation failed. Reload before retrying.";

/**
 * A rejection the database gives for a reason another request or the stored data explains, which keeps today's 409: a
 * foreign key (every row a batch here refers to was read just before it, so one was deleted since), a NOT NULL failure (a
 * stored value a batch copies is missing: an offer with no client email snapshot, which countersign's delivery row needs),
 * and a raise-only trigger (the cleanup lock on a closed archive, the immutability triggers). `classifyFailure` adds a
 * guard that raised and a unique index (another request wrote the row first).
 */
const REFUSED_BY_THE_DATABASE =
	/FOREIGN KEY constraint failed|NOT NULL constraint failed|Archive cleanup is reserved|Immutable (template|config|signature|signed agreement|identity|notice)/;

/** Whether a rejected database or bucket call is a fault of the site (the fixed 500, logged) rather than a refusal. */
function storeFault<Failure>(failure: Failure) {
	return (
		classifyFailure(failure).kind === "unexpected" &&
		!(failure instanceof Error && REFUSED_BY_THE_DATABASE.test(failure.message))
	);
}

/** A failure on the site's side: logged once, never shown, and answered with the route's fixed 500 (B1, B2). */
function failed<Failure>(failure: Failure) {
	logUnexpected("Owner request agreement", failure);

	return agreementJson({ ok: false, error: changedOrFailed }, 500);
}

const post: APIRoute = async ({ request, locals, params }) => {
	const db = locals.runtime.env.MUSIC_DB;

	if (!locals.owner) return agreementJson({ ok: false }, 403);

	if (!db) return agreementJson({ ok: false }, 503);
	const body = await agreementRequest(request);

	if (body instanceof Response) return body;
	const parsed = readOwnerAgreementAction(body);

	if (!parsed.ok)
		return agreementJson(
			{ ok: false, error: "Complete the required confirmations." },
			400,
		);

	const c = parsed.value,
		at = new Date().toISOString();

	// A missing or empty id matches no request, as an unknown one does (B3, as offers F6 decided): no offer and no agreement
	// is read for it, and each action answers what an unknown id gets.
	let offer: SoftwareOffer | null;

	try {
		offer = params.id
			? await db
					.prepare(
						"SELECT * FROM software_offers WHERE request_id=? AND status='sent'",
					)
					.bind(params.id)
					.first<SoftwareOffer>()
			: null;
	} catch (error) {
		return failed(error);
	}

	// Each database or bucket call is marked with `stored`, so that its rejection can be told from a refusal the code
	// throws (a ReaderMessage, refused stored values, a date that does not exist), which keeps today's 409.
	try {
		if (c.action === "countersign") {
			if (!offer || !(await stored(signingEnabled(db))))
				return agreementJson(
					{ ok: false, error: "Signing is off or the offer changed." },
					409,
				);

			const id = await countersignAgreements(
				db,
				offer,
				c.documents,
				c.typed_name,
				locals.owner.email,
				request,
			);

			try {
				const { renderAgreementPacket } = await import("~/lib/agreement-pdf");

				const msa = await db
					.prepare("SELECT msa_id FROM software_agreements WHERE id=?")
					.bind(id)
					.first<{ msa_id: string | null }>();

				if (msa?.msa_id)
					await prepareAgreementArtifact(
						locals.runtime.env,
						msa.msa_id,
						renderAgreementPacket,
					);
				await prepareAgreementArtifact(
					locals.runtime.env,
					id,
					renderAgreementPacket,
				);
				await deliverAgreementCopies(locals.runtime.env, id);
			} catch {
				/* Persisted execution is safe; owner retries copy preparation. */
			}

			// Artifact work is explicit and retryable. It never changes the recorded signatures.
			return nativeAgreementResponse(
				request,
				agreementJson({
					ok: true,
					message: "Signed by both parties. Copy preparation needs attention.",
				}),
				`/owner/requests/${params.id}`,
			);
		}

		if (c.action === "abandon") {
			if (!offer) return agreementJson({ ok: false }, 409);

			const pending = (await stored(offerAgreements(db, offer.id))).filter(
				(d) => d.status === "client_signed",
			);

			if (
				!pending.length ||
				signatureIds(
					pending.map((d) => ({ id: d.id, hash: d.text_sha256 })),
				) !== signatureIds(c.documents)
			)
				return agreementJson(
					{ ok: false, error: "Review the complete pending signing action." },
					409,
				);

			if (await stored(db.prepare(depositUse).bind(offer.id).first()))
				return agreementJson({ ok: false, error: depositBlockMessage }, 409);

			const statements = [
				softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${depositUse})`, [
					offer.id,
				]),
				...c.documents.flatMap((d) => [
					softwareGuard(
						db,
						"SELECT 1 FROM software_agreements WHERE id=? AND request_id=? AND offer_id=? AND text_sha256=? AND status='client_signed'",
						[d.id, params.id!, offer.id, d.hash],
					),
					db
						.prepare(
							"UPDATE software_agreements SET status='abandoned',abandoned_at=?,abandoned_reason=? WHERE id=?",
						)
						.bind(at, c.reason, d.id),
					agreementEvent(
						db,
						"abandoned",
						locals.owner!.email,
						at,
						d.id,
						offer.id,
						"owner-abandoned",
					),
					...closeObsoleteAgreementNotifications(
						db,
						d.id,
						"abandoned",
						locals.owner!.email,
						at,
					),
				]),
				db
					.prepare(
						"UPDATE software_offers SET status='superseded',updated_at=? WHERE id=? AND status='sent'",
					)
					.bind(at, offer.id),
				db
					.prepare(
						"UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL",
					)
					.bind(at, params.id),
				db
					.prepare(
						"UPDATE software_agreement_sessions SET revoked_at=? WHERE offer_id=? AND revoked_at IS NULL",
					)
					.bind(at, offer.id),
				db
					.prepare(
						"UPDATE software_agreement_links SET used_at=? WHERE offer_id=? AND used_at IS NULL",
					)
					.bind(at, offer.id),
				db
					.prepare("DELETE FROM software_agreement_drafts WHERE offer_id=?")
					.bind(offer.id),
			];

			await stored(db.batch(statements));
		} else {
			const agreement = params.id
				? await stored(
						db
							.prepare(
								"SELECT status,kind,effective_on,client_signed_at,executed_at FROM software_agreements WHERE id=? AND request_id=?",
							)
							.bind(c.agreement_id, params.id)
							.first<{
								status: string;
								kind: string;
								effective_on: string;
								client_signed_at: string | null;
								executed_at: string | null;
							}>(),
					)
				: null;

			if (!agreement) return agreementJson({ ok: false }, 404);

			// The notices, the copies, the recovery and the packet reject only when one of their database or bucket calls does
			// (a packet's other failures are logged and marked failed inside it), so each call is marked whole.
			if (c.action === "retry-copy") {
				await stored(
					db
						.prepare(
							"UPDATE software_agreement_deliveries SET status='pending' WHERE agreement_id=? AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))",
						)
						.bind(
							c.agreement_id,
							c.confirmedNotSent ? 1 : 0,
							new Date(Date.now() - 60000).toISOString(),
						)
						.run(),
				);
				await stored(
					db
						.prepare(
							`UPDATE software_agreement_notifications SET status='pending' WHERE agreement_id=? AND ${currentSigningNotification} AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))`,
						)
						.bind(
							c.agreement_id,
							c.confirmedNotSent ? 1 : 0,
							new Date(Date.now() - 60000).toISOString(),
						)
						.run(),
				);
				await stored(
					deliverAgreementNotifications(locals.runtime.env, c.agreement_id),
				);
				await stored(
					deliverAgreementCopies(locals.runtime.env, c.agreement_id),
				);
			}

			if (c.action === "retry-artifact") {
				if (
					c.expectedAttempt &&
					!(await stored(
						recoverAgreementRendering(
							db,
							c.agreement_id,
							c.expectedAttempt,
							c.confirmedStale,
						),
					))
				)
					return agreementJson(
						{
							ok: false,
							error: "Check the stale preparation attempt before recovery.",
						},
						409,
					);
				// Loading the renderer is kept separate from committing legal execution.
				const { renderAgreementPacket } = await import("~/lib/agreement-pdf");

				const msa = await stored(
					db
						.prepare("SELECT msa_id FROM software_agreements WHERE id=?")
						.bind(c.agreement_id)
						.first<{ msa_id: string | null }>(),
				);

				// No bucket is a known unavailable dependency: 503 where the packet would be claimed, as the 409 was (B3).
				if (!locals.runtime.env.AUDIO) return agreementJson({ ok: false }, 503);

				if (msa?.msa_id)
					await stored(
						prepareAgreementArtifact(
							locals.runtime.env,
							msa.msa_id,
							renderAgreementPacket,
						),
					);
				await stored(
					prepareAgreementArtifact(
						locals.runtime.env,
						c.agreement_id,
						renderAgreementPacket,
					),
				);
				await stored(
					deliverAgreementCopies(locals.runtime.env, c.agreement_id),
				);
			}

			if (c.action === "record-alternate-copy")
				await stored(
					db.batch([
						db
							.prepare(
								"UPDATE software_agreement_deliveries SET alternate_delivered_at=?,alternate_method=? WHERE agreement_id=? AND recipient_role=?",
							)
							.bind(at, c.method, c.agreement_id, c.role),
						agreementEvent(
							db,
							"copy-delivered",
							locals.owner!.email,
							at,
							c.agreement_id,
						),
					]),
				);

			if (c.action === "hold")
				await stored(
					db.batch([
						db
							.prepare("UPDATE software_agreements SET legal_hold=? WHERE id=?")
							.bind(c.held ? 1 : 0, c.agreement_id),
						agreementEvent(
							db,
							"hold-changed",
							locals.owner!.email,
							at,
							c.agreement_id,
						),
					]),
				);

			if (c.action === "end") {
				if (!["executed", "abandoned"].includes(agreement.status))
					return agreementJson({ ok: false }, 409);
				const signedDate = agreement.executed_at ?? agreement.client_signed_at;

				const day = new Intl.DateTimeFormat("en-CA", {
					timeZone: "America/New_York",
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
				});

				const earliest = signedDate
					? day.format(new Date(signedDate))
					: agreement.effective_on;

				const latest = day.format(new Date());

				if (c.ended_on < earliest || c.ended_on > latest)
					return agreementJson(
						{ ok: false, error: "Use an end date from signing through today." },
						409,
					);
				const end = new Date(`${c.ended_on}T12:00:00Z`);

				if (end.toISOString().slice(0, 10) !== c.ended_on)
					throw new Error("Invalid date.");
				end.setUTCFullYear(end.getUTCFullYear() + 10);

				if (
					agreement.kind === "msa" &&
					(await stored(db.prepare(msaUse).bind(c.agreement_id).first()))
				)
					return agreementJson({ ok: false, error: openMsaMessage }, 409);
				await stored(
					db.batch([
						...(agreement.kind === "msa"
							? [
									softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${msaUse})`, [
										c.agreement_id,
									]),
								]
							: []),
						db
							.prepare(
								"UPDATE software_agreements SET ended_at=?,retain_until=?,terminated_at=CASE WHEN kind='msa' THEN ? ELSE terminated_at END WHERE id=? AND status IN ('executed','abandoned')",
							)
							.bind(c.ended_on, end.toISOString(), c.ended_on, c.agreement_id),
					]),
				);
			}
		}

		return nativeAgreementResponse(
			request,
			agreementJson({ ok: true }),
			`/owner/requests/${params.id}`,
		);
	} catch (error) {
		// A store failure answers at once, with no read after it; a refusal is read again as today.
		if (error instanceof StoreRejected && storeFault(error.failure))
			return failed(error.failure);

		try {
			if (
				c.action === "abandon" &&
				offer &&
				(await db.prepare(depositUse).bind(offer.id).first())
			)
				return agreementJson({ ok: false, error: depositBlockMessage }, 409);

			if (
				c.action === "end" &&
				(await db.prepare(msaUse).bind(c.agreement_id).first())
			)
				return agreementJson({ ok: false, error: openMsaMessage }, 409);
		} catch (recheck) {
			return failed(recheck);
		}

		return agreementJson({ ok: false, error: changedOrFailed }, 409);
	}
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/owner/requests/${context.params.id}`,
);
