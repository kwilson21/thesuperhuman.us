import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	newPendingNonce,
	newSessionToken,
	newSigninCode,
} from "~/lib/audio-client-access";
import {
	type Allowance,
	issueSigninCode,
	useAllowance,
	wellFormedPending,
} from "~/server/flows/signin-code";
import { enterSigninCode } from "~/server/flows/signin-session";
import { signOut } from "~/server/flows/signin-sign-out";
import {
	type Background,
	liveBackground,
	Mail,
	MailRefused,
	MusicDb,
} from "~/server/services";
import { liveSigninKeys, type SigninKeys } from "~/server/signin-services";

// The studio sign-in flows (src/server/flows/signin-*.ts) on a test's database, for tests that need a code, a session or
// an allowance: the issue and the entry as the routes run them after their allowances and the captcha, sign-out, and one
// use of an allowance. The background runs with no execution context, so a code's email (and a discard after a refused
// one) is done before `issue` answers. `secret` is the code key.

/** What the code's email does: Resend accepts it, or refuses it (the flow then discards the code). */
export type Delivery = "sent" | "refused";

const servicesFor = (db: D1Database, secret: string, delivery: Delivery) =>
	Context.make(MusicDb, db).pipe(
		Context.merge(liveSigninKeys(secret)),
		Context.merge(liveBackground(undefined)),
		Context.add(Mail, {
			send: () =>
				delivery === "sent" ? Effect.void : Effect.fail(new MailRefused()),
		}),
	);

export function studioSignin(db: D1Database, secret: string) {
	const run = <A, E>(
		program: Effect.Effect<A, E, MusicDb | Mail | Background | SigninKeys>,
		delivery: Delivery = "sent",
	) =>
		Effect.runPromise(
			program.pipe(Effect.provideContext(servicesFor(db, secret, delivery))),
		);

	return {
		/**
		 * Issues a code to `address` for the browser holding `pending` (a new browser when null), at `now`. Answers the code
		 * and the browser's value, or null when none was issued (no open project, a full address, a lost race).
		 */
		issue: async (
			address: string,
			now = new Date(),
			pending: string | null = null,
			delivery: Delivery = "sent",
		): Promise<{ code: string; nonce: string } | null> => {
			let code = "";

			const answer = await run(
				issueSigninCode({
					address,
					pending,
					from: "studio@example.test",
					now: () => now,
					newCode: () => {
						code = newSigninCode();

						return code;
					},
					newNonce: newPendingNonce,
				}),
				delivery,
			);

			return answer.outcome === "issued"
				? { code, nonce: answer.pending }
				: null;
		},
		/**
		 * Enters `code` for `address` from the browser holding `nonce`, at `now`. Answers the session token, or null when the
		 * code was not accepted. A value that is not a well-formed pending value reads and writes nothing, as the route does.
		 */
		enter: (
			address: string,
			code: string,
			nonce: string | null,
			now = new Date(),
		): Promise<string | null> => {
			const pending = wellFormedPending(nonce);

			if (pending === null) return Promise.resolve(null);

			return run(
				enterSigninCode({
					address,
					code,
					pending,
					now: () => now,
					newToken: newSessionToken,
				}).pipe(
					Effect.catchTags({
						NoCodeToTry: () => Effect.succeed(null),
						CodeNotAccepted: () => Effect.succeed(null),
					}),
				),
			);
		},
		/** Signs out the session with `token` at `now`. */
		signOut: (token: string, now = new Date()) =>
			run(signOut({ token, now: () => now })),
		/** One use of `allowance` for `subject` at `now`: whether it was within the limit. */
		allow: (allowance: Allowance, subject: string, now = new Date()) =>
			run(
				useAllowance(allowance, subject, () => now).pipe(
					Effect.as(true),
					Effect.catchTags({ AllowanceSpent: () => Effect.succeed(false) }),
				),
			),
	};
}

/** A signed-in client: a code issued to `address` and entered, at `now`. Throws when no session was made. */
export async function signedInClient(
	db: D1Database,
	secret: string,
	address: string,
	now = new Date(),
): Promise<string> {
	const signin = studioSignin(db, secret);
	const issued = await signin.issue(address, now);

	if (!issued) throw new Error(`no code was issued to ${address}`);

	const token = await signin.enter(address, issued.code, issued.nonce, now);

	if (!token) throw new Error(`the code issued to ${address} did not sign in`);

	return token;
}
