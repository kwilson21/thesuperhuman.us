// A studio client signs out (POST /api/studio/sign-out), as docs/plans/2026-11-studio-signin-conversion.md, section 3,
// sets it out. Whoever holds the session cookie can end the session; the route has no origin check and no body. With no
// well-formed token nothing is read or written. Otherwise the clock is read and the one guarded statement runs (C9): the
// session with the token's hash is revoked only while it is not revoked, so a second sign-out keeps the first time.
// Sign-out reads nothing and decides nothing: the answer is the same whether the token was unknown, live, expired or
// already revoked, so there is no rule and no machine, and the guard is the only condition. The flow builds no response
// text.
import * as Effect from "effect/Effect";
import { SigninKeys } from "../signin-services";
import { revokeSession } from "../signin-store";

/** A session token is 72 characters of hex and dashes, in either case (src/lib/audio-client-access.ts). */
const TOKEN_FORMAT = /^[0-9a-f-]{72}$/i;

export type SignOutRequest = {
	/** The session cookie's value, or null when the browser sent none. */
	readonly token: string | null;
	/** The time, read just before the statement. */
	readonly now: () => Date;
};

export const signOut = (request: SignOutRequest) =>
	Effect.gen(function* () {
		const { token } = request;

		if (token === null || !TOKEN_FORMAT.test(token)) return;

		const at = request.now().toISOString();
		const keys = yield* SigninKeys;
		const tokenHash = yield* keys.plain(token);

		yield* revokeSession(tokenHash, at);
	});
