// The sealed login cookie: one sign-in's state (the authorization request, a nonce, a PKCE verifier, an expiry and whether
// the visitor approved), encrypted with AES-GCM under the site's cookie key so the visitor can carry it but not read or
// change it. Sealing and opening are local cryptography, no outside service; each failure is named. A cookie that cannot
// be opened is the visitor's (LoginRefused, said by the sign-in's rules); a cookie key that is not a usable key is the
// site's own fault (CookieKeyInvalid), which the route answers with its fixed 500.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { cookieName } from "../lib/publication/oauth-login";
import { LoginRefused, loginOpen } from "./rules/publication-login";

/** The cookie key setting is not 32 bytes of base64, or the cryptography could not use it. */
export class CookieKeyInvalid extends Data.TaggedError("CookieKeyInvalid") {}

/** The login state, as it is sealed. The authorization request round-trips whole: its members are the OAuth library's. */
const loginState = Schema.Struct({
	request: Schema.Struct({
		responseType: Schema.String,
		clientId: Schema.String,
		redirectUri: Schema.String,
		scope: Schema.mutable(Schema.Array(Schema.String)),
		state: Schema.String,
		codeChallenge: Schema.optional(Schema.String),
		codeChallengeMethod: Schema.optional(Schema.String),
		resource: Schema.optional(Schema.String),
		issuer: Schema.optional(Schema.String),
	}),
	nonce: Schema.String,
	verifier: Schema.String,
	expires: Schema.Number,
	approved: Schema.Boolean,
});

export type LoginState = typeof loginState.Type;

const LONGEST_COOKIE = 3600;

export const encode = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/** Base64url text as bytes; text that is not base64url is a LoginRefused. */
const decode = (value: string | undefined) =>
	Effect.try({
		try: (): Uint8Array<ArrayBuffer> =>
			Uint8Array.from(
				atob((value ?? "").replace(/-/g, "+").replace(/_/g, "/")),
				(c) => c.charCodeAt(0),
			),
		catch: () => new LoginRefused(),
	}).pipe(
		Effect.flatMap((bytes) =>
			value === undefined
				? Effect.fail(new LoginRefused())
				: Effect.succeed(bytes),
		),
	);

/** The cookie key, imported for AES-GCM. */
const importKey = (setting: string) =>
	Effect.try({
		try: () =>
			Uint8Array.from(
				atob(setting.replace(/-/g, "+").replace(/_/g, "/")),
				(c) => c.charCodeAt(0),
			),
		catch: () => new CookieKeyInvalid(),
	}).pipe(
		Effect.filterOrFail(
			(bytes) => bytes.length === 32,
			() => new CookieKeyInvalid(),
		),
		Effect.flatMap((bytes) =>
			Effect.tryPromise({
				try: () =>
					crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
						"encrypt",
						"decrypt",
					]),
				catch: () => new CookieKeyInvalid(),
			}),
		),
	);

/** The sealed text for a state, or a LoginRefused when the request is too large to fit in a cookie. */
export const seal = (state: LoginState, setting: string) =>
	Effect.gen(function* () {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = yield* importKey(setting);

		const encrypted = yield* Effect.tryPromise({
			try: () =>
				crypto.subtle.encrypt(
					{ name: "AES-GCM", iv },
					key,
					new TextEncoder().encode(JSON.stringify(state)),
				),
			catch: () => new CookieKeyInvalid(),
		});

		const token = encode(iv) + "." + encode(new Uint8Array(encrypted));

		if (token.length > LONGEST_COOKIE)
			return yield* Effect.fail(new LoginRefused());

		return token;
	});

/** The login state in the request's cookies, opened; `now` is read once the state is opened. */
export const unseal = (
	cookies: string | null,
	setting: string,
	now: () => number,
) =>
	Effect.gen(function* () {
		const value = cookies
			?.split(";")
			.map((c) => c.trim())
			.find((c) => c.startsWith(cookieName + "="))
			?.slice(cookieName.length + 1);

		if (!value || value.length > LONGEST_COOKIE)
			return yield* Effect.fail(new LoginRefused());
		const [ivText, ciphertextText] = value.split(".");

		const iv = yield* decode(ivText);
		const key = yield* importKey(setting);
		const ciphertext = yield* decode(ciphertextText);

		const bytes = yield* Effect.tryPromise({
			try: () =>
				crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
			catch: () => new LoginRefused(),
		});

		const json = yield* Effect.try({
			try: () => JSON.parse(new TextDecoder().decode(bytes)),
			catch: () => new LoginRefused(),
		});

		const read = Schema.decodeUnknownResult(loginState)(json);

		if (!Result.isSuccess(read)) return yield* Effect.fail(new LoginRefused());

		yield* loginOpen.decide({ expires: read.success.expires, now: now() }, {});

		return read.success;
	});
