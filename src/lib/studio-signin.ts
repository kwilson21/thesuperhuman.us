// The studio sign-in routes' sentences and fixed answers (POST /api/studio/code, /api/studio/session and
// /api/studio/sign-out), exactly as the routes gave them before the conversion: the status, the body key by key and the
// cookie. Each sentence is written once here, and the rules that carry one as their `say` (NoOpenProject and AddressFull
// in src/server/rules/signin-issue.ts, NoCodeToTry in src/server/rules/signin-complete.ts) refer to it, so a refused
// request, a wrong code and a lost race cannot drift apart: the non-interference property
// (tests/api/studio-signin-noninterference.test.ts) needs them to give one identical answer.
import {
	clearStudioSessionCookie,
	pendingSignInCookie,
	studioSessionCookie,
} from "./audio-client-access";

/** Every code request that reaches the issue is answered with this, whether or not a code was issued. */
export const CODE_ON_ITS_WAY =
	"If this email has a studio project, a sign-in code is on its way.";

/** A wrong, expired, used or never-issued code, and a browser that did not ask for it: one sentence for all. */
export const CODE_INVALID_OR_EXPIRED =
	"That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here.";

/** The code and session routes' sentence for a fault of the site: a missing or unusable binding or secret (503) or any other (500). */
export const SIGNIN_UNAVAILABLE = "Studio sign-in is temporarily unavailable.";

const failure = (error: string, status: number) =>
	Response.json({ ok: false, error }, { status });

// ---- every route ----

/** The client portal is off (AUDIO_CLIENT_PORTAL_ENABLED is not exactly "true"): plain text, before anything else. */
export const studioNotFound = () => new Response("Not found", { status: 404 });

/** A binding or secret the route needs is missing, or the code key is under 32 characters: 503. */
export const signinUnavailable = () => failure(SIGNIN_UNAVAILABLE, 503);

/** A store or hash failure, or a defect, logged once by the route first: 500 with the same sentence. */
export const signinFailed = () => failure(SIGNIN_UNAVAILABLE, 500);

// ---- POST /api/studio/code ----

/** The body is not an object with an address of at most 320 characters and a token of 1 to 2,048. */
export const codeRequestUnread = () =>
	failure("Enter your email and complete the security check.", 400);

/** The address is not one once trimmed and lower-cased. */
export const codeAddressInvalid = () =>
	failure("Enter a valid email address.", 400);

/** The `code-ip` or the `code-email` allowance is spent. */
export const codeAllowanceSpent = () =>
	failure("Please wait a few minutes before asking for another code.", 429);

/** Turnstile did not pass the token. */
export const codeCheckFailed = () =>
	failure("Please complete the security check again.", 403);

/**
 * Every answer that reaches the issue: the one sentence, and the pending sign-in cookie set to `pending` (the value the
 * browser sent, else the new code's, else a fresh one), so neither shows whether the address has a project.
 */
export const codeOnItsWay = (pending: string, secure: boolean) =>
	Response.json(
		{ ok: true, message: CODE_ON_ITS_WAY },
		{ headers: { "set-cookie": pendingSignInCookie(pending, secure) } },
	);

// ---- POST /api/studio/session ----

/** The body or its address does not read. */
export const entryUnread = () =>
	failure("Check the email and eight-digit code.", 400);

/** No well-formed pending cookie, a code the machine refuses, a wrong code or a lost race: one 401. */
export const codeInvalidOrExpired = () => failure(CODE_INVALID_OR_EXPIRED, 401);

/** The `session-ip` or the `session-requester` allowance is spent. */
export const entryAllowanceSpent = () =>
	failure("Too many attempts. Please wait a few minutes.", 429);

/**
 * The code was accepted: the 14-day session cookie. The pending cookie is left to expire (Max-Age, reset by each code
 * request): a browser that holds codes for two addresses needs it for the second sign-in. A used code cannot be used
 * again, and the cookie is HttpOnly, random and useless without a code.
 */
export const signedIn = (token: string, secure: boolean) => {
	const headers = new Headers();

	headers.append("set-cookie", studioSessionCookie(token, secure));

	return Response.json({ ok: true }, { headers });
};

// ---- POST /api/studio/sign-out ----

/** Signed out, or nothing to sign out: the session cookie is cleared. */
export const signedOut = (secure: boolean) =>
	Response.json(
		{ ok: true },
		{ headers: { "set-cookie": clearStudioSessionCookie(secure) } },
	);

/**
 * The session could not be revoked here: 503 with no database binding, 500 when the revoking statement or the hash failed
 * (logged once first). The cookie is cleared either way, and the page signs the browser out locally.
 */
export const signOutLocally = (status: 500 | 503, secure: boolean) =>
	Response.json(
		{ ok: false, localSignedOut: true },
		{
			status,
			headers: { "set-cookie": clearStudioSessionCookie(secure) },
		},
	);
