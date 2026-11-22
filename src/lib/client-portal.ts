// The pure helpers of the client portal that other areas import: the portal flag, the address normalizer and the two
// hashes. No D1, mail or sessions, so an area can use them without loading src/lib/audio-client-access.ts, which keeps
// the sign-in codes, sessions and allowances. The address normalizer still validates with Zod; it moves to Effect
// Schema with the studio sign-in area (docs/plans/2026-11-effect-conversion.md, step 2).
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

/** `input` is the email field of a request body. Every caller passes a string; the schema still rejects anything that is not a valid address. */
export function normalizeClientEmail(input: string): string | null {
	const parsed = emailSchema.safeParse(input);

	return parsed.success ? parsed.data : null;
}

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
