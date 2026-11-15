// SHA-256 of text, for the publication routes (the work feed's token comparison, the journal's payload hash, the consent
// page's style hash and the sign-in's PKCE challenge). `Effect.promise`, not `tryPromise`: the digest of bytes cannot reject
// for SHA-256, so there is no failure to name, and a defect here would be a fault of the runtime.
import * as Effect from "effect/Effect";

/** The SHA-256 digest of the UTF-8 bytes of `text`. */
export const sha256 = (text: string) =>
	Effect.promise(
		async () =>
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
			),
	);

/** The SHA-256 digest of `text` as lower-case hex. */
export const sha256Hex = (text: string) =>
	sha256(text).pipe(
		Effect.map((bytes) =>
			Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
		),
	);
