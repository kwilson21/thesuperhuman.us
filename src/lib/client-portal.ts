// The pure helpers of the client portal that other areas import: the portal flag, the address normalizer, the two
// hashes and the lifetimes of a code and a session. No D1, mail or sessions, so an area can use them without loading
// src/lib/audio-client-access.ts, which keeps the cookies and the session reads. The
// address normalizer checks with Effect Schema and answers every input as the Zod 4 schema it replaced did
// (tests/server/validators-differential.test.ts holds it to a frozen copy of it).
import * as Schema from "effect/Schema";
import { emailPattern } from "./fields";

/**
 * An address once trimmed and lower-cased: the email pattern, and at most 320 characters. Zod 4's default email pattern,
 * which this replaced, accepts exactly the text `emailPattern` (Zod 3.25's) accepts, so the shared one is used; the
 * differential test holds the two answers together. Zod 4 counted the 320 in code points, not UTF-16 units; the pattern
 * admits only ASCII, so for any text it accepts the two counts are the same.
 */
const ClientEmail = Schema.String.check(
	Schema.isPattern(emailPattern),
	Schema.isMaxLength(320),
);

const isText = Schema.is(Schema.String);
const isClientEmail = Schema.is(ClientEmail);

/**
 * `input` is the email field of a request body: trimmed, then lower-cased, then checked, as Zod did. Every caller passes
 * a string; anything that is not one, or not a valid address, is null.
 */
export function normalizeClientEmail(input: string): string | null {
	if (!isText(input)) return null;

	const address = input.trim().toLowerCase();

	return isClientEmail(address) ? address : null;
}

/**
 * How long a sign-in code lives: the issue stamps its row with it (src/server/flows/signin-code.ts), and the pending
 * sign-in cookie lasts as long (src/lib/audio-client-access.ts).
 */
export const CODE_LIFETIME_MS = 10 * 60 * 1000;

/**
 * How long a studio session lives: an accepted code's session row ends after it (src/server/flows/signin-session.ts),
 * and the session cookie lasts as long (src/lib/audio-client-access.ts).
 */
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function clientPortalEnabled(env: Env | undefined): boolean {
	return env?.AUDIO_CLIENT_PORTAL_ENABLED === "true";
}

export async function hashValue(value: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

/** Whether a code key is long enough for `keyedHash`, which refuses one under 32 characters. */
export function codeKeyUsable(secret: string): boolean {
	return secret.length >= 32;
}

export async function keyedHash(
	secret: string,
	message: string,
): Promise<string> {
	if (!codeKeyUsable(secret))
		throw new Error("Studio code key is not configured.");

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const bytes = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
	);

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
