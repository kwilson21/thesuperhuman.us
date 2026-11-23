import type { JsonValue } from "./json-value";
import { agreementHeaders, canonicalAgreementRequest } from "./agreement-host";
import { agreementEvent } from "./agreement-events";
import { hashOfferToken, newOfferToken } from "./software-offers";

export const maskedAgreementEmail = (email: string) =>
	`${[...email][0]}•••@${email.split("@")[1]}`;

export const agreementJson = (body: JsonValue, status = 200) =>
	Response.json(body, { status, headers: agreementHeaders });

/** A plain-text answer with the agreement headers (private, no store, no index). */
export const agreementText = (body: string, status: number) =>
	new Response(body, { status, headers: agreementHeaders });

// ---- the fixed answers (docs/plans/2026-11-signing-conversion.md, section 5) ----
// Each signing and agreement route's answer to a missing binding, and its answer to a store failure or a defect with the
// label it logs that under, as the route gives them today: the status, the sentence and the headers. A failure answer is
// the `{ route, answer }` pair `runRoute` takes (src/server/run.ts), so a defect is logged once and answered as a store
// failure is; the route answers a named store failure with `loggedAnswer(route, answer)` (src/server/answers.ts). The
// answers below are pure: plain responses and labels, no store or service (the rest of this module holds D1 statements
// and the Resend and Turnstile calls). tests/lib/agreement-answers.test.ts holds each to the bytes a golden fixture
// recorded.

/** A route's answer to a store failure or a defect, and the label it logs that under (`logUnexpected`). */
export type FailureAnswer = {
	readonly route: string;
	readonly answer: () => Response;
};

const SIGN_IN_UNAVAILABLE = "Agreement sign-in is temporarily unavailable.";

const FRESH_LINK =
	"Open a fresh email link to keep going. Your saved details will be here.";

/** The signing link (POST /api/offer/[token]/link) with no D1, code key, Resend key, sender or Turnstile secret. */
export const signingLinkUnavailable = () =>
	agreementJson({ ok: false, error: SIGN_IN_UNAVAILABLE }, 503);

/** The signing link: the same sentence as a 500 (B1, B2; the archive link's answer). */
export const signingLinkFailed: FailureAnswer = {
	route: "Agreement link",
	answer: () => agreementJson({ ok: false, error: SIGN_IN_UNAVAILABLE }, 500),
};

/** Either verify page's redeem with no D1: the 401 every refusal gets, which the page shows as the expired page. */
export const redeemExpired = () =>
	agreementJson({ ok: false, error: "This link has expired." }, 401);

const linkNotOpened = () =>
	agreementJson({ ok: false, error: "This link could not be opened." }, 500);

/** The signing link's verify page (src/pages/offer/[token]/verify.astro): a 500 the page shows as Q2's failure page. */
export const signingVerifyFailed: FailureAnswer = {
	route: "Agreement verify",
	answer: linkNotOpened,
};

/** The archive link's verify page (src/pages/agreements/verify.astro): the same, logged under its own label. */
export const archiveVerifyFailed: FailureAnswer = {
	route: "Archive verify",
	answer: linkNotOpened,
};

/** The signing draft (POST /api/offer/[token]/draft) with no D1: the 401 of a visitor with no session. */
export const signingDraftUnavailable = () =>
	agreementJson({ ok: false, error: FRESH_LINK }, 401);

/** The signing draft: Q2's sentence as a 500. */
export const signingDraftFailed: FailureAnswer = {
	route: "Agreement draft",
	answer: () =>
		agreementJson(
			{
				ok: false,
				error: "Your details could not be saved. Try again in a moment.",
			},
			500,
		),
};

/** The review's POST (/api/offer/[token]/review) with no D1. */
export const signingReviewUnavailable = () => agreementJson({ ok: false }, 503);

/** The review's GET (one document's text) with no D1: the 401 of a visitor with no session. */
export const signingReviewDocumentUnavailable = () =>
	agreementJson({ ok: false }, 401);

/** The review, GET and POST. */
export const signingReviewFailed: FailureAnswer = {
	route: "Agreement review",
	answer: () =>
		agreementJson(
			{ ok: false, error: "The agreement could not be reviewed." },
			500,
		),
};

/** The signature (POST /api/offer/[token]/sign) with no D1. */
export const signingSignUnavailable = () => agreementJson({ ok: false }, 503);

/** The signature: Q2's sentence as a 500. */
export const signingSignFailed: FailureAnswer = {
	route: "Agreement signing",
	answer: () =>
		agreementJson(
			{
				ok: false,
				error: "Your signature could not be saved. Try again in a moment.",
			},
			500,
		),
};

/** The owner's agreements (POST /api/owner/agreements) with no D1. */
export const ownerAgreementsUnavailable = () =>
	agreementJson({ ok: false }, 503);

/** The owner's retention preview or apply with no bucket or no retention binding id. */
export const retentionUnavailable = () =>
	agreementJson(
		{ ok: false, error: "Retention storage identity is not configured." },
		503,
	);

/** The owner's agreements. */
export const ownerAgreementsFailed: FailureAnswer = {
	route: "Owner agreements",
	answer: () =>
		agreementJson(
			{ ok: false, error: "The agreement could not be saved." },
			500,
		),
};

/** The owner's request agreement (POST /api/owner/requests/[id]/agreement) with no D1, and retry-artifact with no bucket (B3). */
export const ownerRequestAgreementUnavailable = () =>
	agreementJson({ ok: false }, 503);

/** The owner's request agreement. */
export const ownerRequestAgreementFailed: FailureAnswer = {
	route: "Owner request agreement",
	answer: () =>
		agreementJson(
			{
				ok: false,
				error:
					"The agreement changed or the operation failed. Reload before retrying.",
			},
			500,
		),
};

/** The owner's attachment upload (PUT /api/owner/requests/[id]/agreement-attachments) with no D1 or no bucket. */
export const attachmentUploadUnavailable = () =>
	agreementJson({ ok: false }, 503);

/** The owner's attachment upload. */
export const attachmentUploadFailed: FailureAnswer = {
	route: "Owner attachment upload",
	answer: () =>
		agreementJson(
			{ ok: false, error: "The attachment could not be saved." },
			500,
		),
};

/** The owner's attachment download (GET of the same route) with no D1 or no bucket: plain text with no agreement headers (B3). */
export const ownerAttachmentUnavailable = () =>
	new Response("Unavailable", { status: 503 });

/** The owner's attachment download, a missing object included (B8): plain text with no agreement headers. */
export const ownerAttachmentFailed: FailureAnswer = {
	route: "Owner attachment",
	answer: () => new Response("Unavailable", { status: 500 }),
};

/** The owner's signed copy (GET /api/owner/agreements/[id]/file) with no D1 or no bucket. */
export const ownerCopyUnavailable = () => agreementText("Unavailable", 503);

/** The owner's signed copy, a ready copy whose object is gone included (B8, J1). */
export const ownerCopyFailed: FailureAnswer = {
	route: "Owner signed copy",
	answer: () => agreementText("Signed copy unavailable. Contact Kazon.", 500),
};

export async function cleanupAgreementAccess(db: D1Database) {
	const before = new Date(Date.now() - 30 * 86400000).toISOString();
	// Successful verification evidence lives in immutable signatures, independently of these short-lived rows.
	await db.batch([
		db
			.prepare(
				"DELETE FROM software_agreement_sessions WHERE expires_at<? OR revoked_at<?",
			)
			.bind(before, before),
		db
			.prepare(
				"DELETE FROM software_agreement_links WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM software_agreement_sessions s WHERE s.link_id=software_agreement_links.id)",
			)
			.bind(before),
	]);
}

export async function signingEnabled(db: D1Database) {
	return Boolean(
		(
			await db
				.prepare(
					"SELECT software_signing_enabled FROM software_signing_settings WHERE id=1",
				)
				.first<{ software_signing_enabled: number }>()
		)?.software_signing_enabled,
	);
}

export type AgreementSession = {
	token_hash: string;
	purpose: "agreement" | "archive";
	offer_id: string | null;
	link_hash: string | null;
	recipient_email: string;
	verified_at: string;
	expires_at: string;
	csrf_nonce: string;
};

export const sessionCookie = (
	token: string,
	secure: boolean,
	purpose = "agreement",
) =>
	`${purpose === "archive" ? "agreement_archive" : "agreement_session"}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${secure ? "; Secure" : ""}`;

export async function agreementSession(
	db: D1Database,
	request: Request,
	purpose: "agreement" | "archive" = "agreement",
	offerId?: string,
) {
	const name =
		purpose === "archive" ? "agreement_archive" : "agreement_session";

	const token = request.headers
		.get("cookie")
		?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1];

	if (!token) return null;

	const session = await db
		.prepare(
			"SELECT * FROM software_agreement_sessions WHERE token_hash=? AND purpose=? AND expires_at>? AND revoked_at IS NULL",
		)
		.bind(await hashOfferToken(token), purpose, new Date().toISOString())
		.first<AgreementSession>();

	if (!session || (offerId && session.offer_id !== offerId)) return null;

	if (purpose === "agreement") {
		const live = await db
			.prepare(
				`SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND r.status NOT IN ('withdrawn','resolved') AND o.recipient_email_snapshot=?`,
			)
			.bind(session.offer_id, session.link_hash, session.recipient_email)
			.first();

		if (!live) return null;
	}

	return session;
}

export const liveSigningGuard = (
	db: D1Database,
	id: string,
	linkHash: string,
	email: string,
) =>
	db
		.prepare(
			`SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END`,
		)
		.bind(id, linkHash, email);

/**
 * How the redeem tells a refusal from a failure on the site's side. The verify pages pass the site's recogniser
 * (`raisedByJsonGuard`) and log through `logUnexpected`, since src/lib imports no value from src/server.
 */
export type RedeemFailures = {
	/** Whether a failed live check or consume batch was refused by one of its guards: the 401, the expired page. */
	readonly isGuard: (error: Error) => boolean;
	/** Logs a failure on the site's side once, before its 500. */
	readonly unexpected: <Failure>(failure: Failure) => void;
};

/**
 * The emailed link of a verify page, completed: 404 for another host, 401 (the expired page) for every refusal, 200 for a
 * GET, and for a POST the 303 with the session cookie. A failed read, or a live check or consume batch that failed for no
 * guard, is logged once and answers 500, which the pages render as the failure page (behaviour fixes B1 and B2 of
 * docs/plans/2026-11-signing-conversion.md).
 */
export async function completeAgreementLink(
	env: Env,
	request: Request,
	key: string,
	token: string | undefined,
	failures: RedeemFailures,
) {
	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	const db = env.MUSIC_DB,
		purpose = token ? "agreement" : "archive";

	const expired = () =>
		agreementJson({ ok: false, error: "This link has expired." }, 401);

	const failed = <Failure>(failure: Failure) => {
		failures.unexpected(failure);

		return agreementJson(
			{ ok: false, error: "This link could not be opened." },
			500,
		);
	};

	/** A guard that raised is a refusal (the expired page); any other failure is the site's (the 500). */
	const refusedOrFailed = <Failure>(failure: Failure) =>
		failure instanceof Error && failures.isGuard(failure)
			? expired()
			: failed(failure);

	if (!db || !/^[A-Za-z0-9_-]{43}$/.test(key)) return expired();

	const hash = await hashOfferToken(key),
		at = new Date().toISOString();

	type Link = {
		id: string;
		offer_id: string;
		link_hash: string;
		recipient_email: string;
	};

	let link: Link | null;

	try {
		link = await db
			.prepare(
				"SELECT * FROM software_agreement_links WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?",
			)
			.bind(hash, purpose, at)
			.first<Link>();
	} catch (error) {
		return failed(error);
	}

	if (!link || (token && (await hashOfferToken(token)) !== link.link_hash))
		return expired();

	if (request.method === "GET") {
		if (token) {
			try {
				await liveSigningGuard(
					db,
					link.offer_id,
					link.link_hash,
					link.recipient_email,
				).first();
			} catch (error) {
				// The guard raised: the offer is no longer open for signing (A1).
				return refusedOrFailed(error);
			}
		}

		return agreementJson({ ok: true });
	}

	if (request.method !== "POST") return expired();

	const session = newOfferToken(),
		sessionHash = await hashOfferToken(session),
		csrf = newOfferToken();

	try {
		await db.batch([
			...(token
				? [
						liveSigningGuard(
							db,
							link.offer_id,
							link.link_hash,
							link.recipient_email,
						),
					]
				: []),
			db
				.prepare(
					`SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreement_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN 1 ELSE json_extract('Link already consumed','$') END`,
				)
				.bind(hash, at),
			db
				.prepare(
					"UPDATE software_agreement_links SET used_at=? WHERE token_hash=?",
				)
				.bind(at, hash),
			agreementEvent(db, "verified", sessionHash, at, null, link.offer_id),
			db
				.prepare(
					"INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,csrf_nonce) VALUES(?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					sessionHash,
					purpose,
					link.offer_id,
					link.link_hash,
					link.recipient_email,
					link.id,
					at,
					new Date(Date.parse(at) + 7200000).toISOString(),
					csrf,
				),
		]);
	} catch (error) {
		// A guard raised: another request used the link first (A5) or, for a signing link, the offer is no longer open for
		// signing (A1). Nothing else in the batch can lose a race: the ids and the session token are new.
		return refusedOrFailed(error);
	}

	return new Response(null, {
		status: 303,
		headers: {
			...agreementHeaders,
			location: token ? `/offer/${token}/sign` : "/agreements",
			"set-cookie": sessionCookie(
				session,
				new URL(request.url).protocol === "https:",
				purpose,
			),
		},
	});
}
