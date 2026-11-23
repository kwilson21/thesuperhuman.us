import type { JsonValue } from "./json-value";
import { siteOrigin } from "./site-origin.mjs";
import { agreementHeaders, canonicalAgreementRequest } from "./agreement-host";
import { agreementEvent } from "./agreement-events";
import {
	hashOfferToken,
	getLinkedOffer,
	newOfferToken,
} from "./software-offers";
import { reserveStudioAllowance } from "./audio-client-access";
import { codeKeyUsable, normalizeClientEmail } from "./client-portal";
import { sendAudioMessage } from "./audio-resend";
import { escapeHtml } from "./email-template";
import { verifyTurnstile } from "./turnstile";

export const maskedAgreementEmail = (email: string) =>
	`${[...email][0]}•••@${email.split("@")[1]}`;

export const agreementJson = (body: JsonValue, status = 200) =>
	Response.json(body, { status, headers: agreementHeaders });

/** A plain-text answer with the agreement headers (private, no store, no index). */
export const agreementText = (body: string, status: number) =>
	new Response(body, { status, headers: agreementHeaders });

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

/**
 * The signing link of an offer: a link to review and sign the agreement is mailed to the offer's recipient. `isGuard`
 * says whether a failed link batch was refused by one of its guards (the route passes the site's recogniser,
 * `raisedByJsonGuard`); only that is the 429, and any other failure, like every other failed call here, is thrown for
 * the route to answer.
 */
export async function issueAgreementLink(
	env: Env,
	request: Request,
	input: { turnstileToken: string },
	token: string,
	isGuard: (error: Error) => boolean,
) {
	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	const db = env.MUSIC_DB;

	if (
		!db ||
		!env.AUDIO_CLIENT_CODE_KEY ||
		!env.RESEND_API_KEY ||
		!env.CONTACT_FROM_EMAIL ||
		!env.TURNSTILE_SECRET_KEY
	)
		return agreementJson(
			{ ok: false, error: "Agreement sign-in is temporarily unavailable." },
			503,
		);

	if (!(await signingEnabled(db)))
		return agreementJson({ ok: false, error: "Website signing is off." }, 404);
	const offer = await getLinkedOffer(db, token);

	if (!offer?.recipient_email_snapshot || !offer.msa_template_id)
		return agreementJson(
			{ ok: false, error: "This offer is unavailable for signing." },
			404,
		);

	const email = normalizeClientEmail(offer.recipient_email_snapshot);

	if (!email)
		return agreementJson(
			{ ok: false, error: "Enter a valid email address." },
			400,
		);
	const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";

	// The address allowance is coarse and is charged first, so the captcha service is not asked without bound. The
	// recipient's allowance is charged only after the captcha passes, so bots cannot exhaust a recipient's access.
	const allowances: Awaited<ReturnType<typeof reserveStudioAllowance>>[] = [];

	const charge = async (scope: string, value: string, limit: number) => {
		const allowance = await reserveStudioAllowance(
			db,
			scope,
			value,
			limit,
			env.AUDIO_CLIENT_CODE_KEY!,
		);

		allowances.push(allowance);

		return allowance.allowed
			? null
			: agreementJson(
					{
						ok: false,
						error: "Please wait a few minutes before requesting another link.",
					},
					429,
				);
	};

	// A code key under 32 characters fails the first keyed hash, the address allowance's: the 503 of a missing key, at the
	// point it failed before (after the signing setting, the offer and the recipient are read), with nothing written.
	if (!codeKeyUsable(env.AUDIO_CLIENT_CODE_KEY))
		return agreementJson(
			{ ok: false, error: "Agreement sign-in is temporarily unavailable." },
			503,
		);

	const crowded = await charge("agreement-link-ip", ip, 20);

	if (crowded) return crowded;

	if (
		!(await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip))
	)
		return agreementJson(
			{ ok: false, error: "Complete the security check again." },
			403,
		);

	const busy = await charge("agreement-link-email", email, 3);

	if (busy) return busy;

	const receipt = {
		ok: true,
		message: `I sent a link to ${(await agreementSession(db, request, "agreement", offer.id)) ? email : maskedAgreementEmail(email)}. Tap it on any device to open your agreement.`,
	};

	const at = new Date(),
		id = crypto.randomUUID(),
		key = newOfferToken(),
		hash = await hashOfferToken(key),
		linkHash = await hashOfferToken(token);

	try {
		await db.batch([
			db
				.prepare(
					`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another link','$') END`,
				)
				.bind(
					"agreement",
					email,
					offer.id,
					new Date(at.getTime() - 30000).toISOString(),
				),
			liveSigningGuard(db, offer.id, linkHash, email),
			agreementEvent(
				db,
				"link-issued",
				await hashOfferToken(id),
				at.toISOString(),
				null,
				offer.id,
			),
			db
				.prepare(
					"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
				)
				.bind(
					id,
					"agreement",
					offer.id,
					linkHash,
					email,
					hash,
					at.toISOString(),
					new Date(at.getTime() + 3600000).toISOString(),
				),
		]);
	} catch (error) {
		// Only a guard that raised is the 429: a link issued in the last 30 seconds, or the offer no longer open for
		// signing. Any other failure of the batch goes to the route, which answers 500 (the archive link's answer).
		if (!(error instanceof Error && isGuard(error))) throw error;

		return agreementJson(
			{
				ok: false,
				error: "Wait at least 30 seconds before requesting another link.",
			},
			429,
		);
	}

	const url = new URL(`/offer/${token}/verify`, siteOrigin(env.SITE_ORIGIN));

	url.searchParams.set("key", key);

	const brief = await db
		.prepare("SELECT name FROM owner_requests WHERE id=?")
		.bind(offer.request_id)
		.first<{ name: string }>();

	const project = JSON.parse(offer.terms_json).outcome;
	const greeting = `Hi ${brief?.name?.trim().split(/\s+/)[0] || "there"},`;
	const intro = `Tap below to review and sign the agreement for ${project}.`;
	const action = "Review and sign";

	const expiry =
		"This link works once and expires in an hour. If you didn’t ask for it, you can ignore this email.";

	const sent = await sendAudioMessage({
		apiKey: env.RESEND_API_KEY,
		payload: {
			from: env.CONTACT_FROM_EMAIL,
			to: [email],
			subject: "Open your agreement",
			text: `${greeting}\n\n${intro}\n\n${action}: ${url.href}\n\n${expiry}\n\nKazon`,
			html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url.href)}">${action}</a></p><p>${escapeHtml(expiry)}</p><p>Kazon</p>`,
		},
	});

	if (!sent.ok && !sent.uncertain) {
		await db.batch([
			db
				.prepare("DELETE FROM software_agreement_sessions WHERE link_id=?")
				.bind(id),
			db.prepare("DELETE FROM software_agreement_links WHERE id=?").bind(id),
			...allowances.flatMap((allowance) => [
				db
					.prepare(
						"DELETE FROM audio_client_allowances WHERE key=? AND window_start=? AND uses=1",
					)
					.bind(allowance.key, allowance.windowStart),
				db
					.prepare(
						"UPDATE audio_client_allowances SET uses=uses-1 WHERE key=? AND window_start=? AND uses>1",
					)
					.bind(allowance.key, allowance.windowStart),
			]),
		]);

		return agreementJson(
			{ ok: false, error: "That email didn’t go through. Please try again." },
			502,
		);
	}

	await db
		.prepare(
			"UPDATE software_agreement_links SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL AND id<>? AND issued_at<=?",
		)
		.bind(at.toISOString(), "agreement", email, offer.id, id, at.toISOString())
		.run();

	return agreementJson(receipt);
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
