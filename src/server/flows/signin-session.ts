// A visitor enters the emailed code (POST /api/studio/session), as docs/plans/2026-11-studio-signin-conversion.md,
// section 3, sets it out. A code only works in the browser that asked for it: without that browser's well-formed pending
// value nothing is read, counted or charged, so someone who only knows the address cannot use up anyone's attempts or
// allowances. Then the client address's allowance is counted (`session-ip`, twenty per five minutes), then the address's
// with the browser's value (`session-requester`, ten), each reading the clock as it is counted.
//
// The entry reads the clock once, as the route always has, and binds that time in every later statement. It makes the
// same two round trips with the same statements whatever the state of the code (no row, used, expired, out of attempts,
// wrong, right): the read (the browser's own code row for the address and the address's projects, one batch), and the
// write (four guarded statements, one batch, run for every entry and bound to match no row when the machine refused
// ENTER). The machine is asked ENTER from the row's state at the time read; only a `live` code reaches the entry rule,
// which counts the attempt and says whether it signs in. A session token is made and hashed on every entry, accepted or
// not, so a right and a wrong code do the same work, and it is returned only when the accept's `RETURNING` row came back.
//
// No well-formed value and a code the machine refuses are NoCodeToTry; a wrong code and a lost race (a guard that no
// longer held at write time) are CodeNotAccepted. The route answers all of them with the one 401, so the answer never
// tells a stranger what state an address's code is in; that is the owner's exception to the 409 rule for this route (the
// design's "Owner decisions"). None is retried. The flow builds no response text.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { CODE_INVALID_OR_EXPIRED } from "../../lib/studio-signin";
import { SESSION_LIFETIME_MS } from "../../lib/client-portal";
import { codeAllows, codeStateOf } from "../machines/signin-code";
import { enterCode, NoCodeToTry } from "../rules/signin-complete";
import { SigninKeys } from "../signin-services";
import { readEntryFacts, writeEntry } from "../signin-store";
import { type Allowance, useAllowance, wellFormedPending } from "./signin-code";

/**
 * A live code was tried and not accepted: the typed code is wrong, no project of the address is open, or a guard no longer
 * held at write time (a lost race). Answered with the one sentence a refused code gets.
 */
export class CodeNotAccepted extends Data.TaggedError("CodeNotAccepted") {
	readonly say = CODE_INVALID_OR_EXPIRED;
}

/** The client address's allowance for code entries. */
export const SESSION_IP: Allowance = { scope: "session-ip", limit: 20 };

/** The address's allowance for code entries from one browser, keyed by the address and the hash of its pending value. */
export const SESSION_REQUESTER: Allowance = {
	scope: "session-requester",
	limit: 10,
};

export type EntryRequest = {
	/** The address, trimmed, lower-cased and checked (`normalizeClientEmail`). */
	readonly address: string;
	/** The eight digits typed. */
	readonly code: string;
	/** The browser's pending value: the code is bound to it. */
	readonly pending: string;
	/** The time, read at each point the route has always read it. */
	readonly now: () => Date;
	/** A fresh session token (`newSessionToken`). */
	readonly newToken: () => string;
};

export type SignInRequest = Omit<EntryRequest, "pending"> & {
	/** The pending sign-in value the browser sent, or null. */
	readonly pending: string | null;
	/** The address Cloudflare saw. */
	readonly ip: string;
};

/**
 * The entry, after the allowances: the clock, the two hashes, the read, the machine and the rule, the token, and the
 * write. Answers the session token when the code was accepted.
 */
export const enterSigninCode = (request: EntryRequest) =>
	Effect.gen(function* () {
		const now = request.now();
		const keys = yield* SigninKeys;
		const nonceHash = yield* keys.plain(request.pending);

		// Keyed with the address and the browser's value, as the issue keyed the stored hash.
		const digest = yield* keys.keyed(
			`${request.address}:${nonceHash}:${request.code}`,
		);

		const at = now.toISOString();
		const key = { address: request.address, nonceHash };
		const facts = yield* readEntryFacts(key);

		// The machine allows ENTER only from `live`, which a missing row never is.
		const entry =
			codeAllows(codeStateOf(facts.code, at), "ENTER") && facts.code !== null
				? yield* enterCode.decide(
						{ digest },
						{ codeHash: facts.code.codeHash, projects: facts.projects },
					)
				: null;

		// Made and hashed whether or not it is used, so a right and a wrong code do the same work.
		const token = request.newToken();
		const tokenHash = yield* keys.plain(token);

		const written = yield* writeEntry({
			...key,
			readHash: facts.code?.codeHash ?? "",
			at,
			tokenHash,
			sessionExpiresAt: new Date(
				now.getTime() + SESSION_LIFETIME_MS,
			).toISOString(),
			entry,
		});

		if (written.accepted) return token;

		return yield* Effect.fail(
			entry === null ? new NoCodeToTry() : new CodeNotAccepted(),
		);
	});

/**
 * The code entry: the browser's value checked, `session-ip`, `session-requester`, then the entry. A spent allowance is
 * AllowanceSpent. Answers the session token.
 */
export const signIn = (request: SignInRequest) =>
	Effect.gen(function* () {
		const pending = wellFormedPending(request.pending);

		if (pending === null) return yield* Effect.fail(new NoCodeToTry());

		yield* useAllowance(SESSION_IP, request.ip, request.now);

		const keys = yield* SigninKeys;
		const pendingHash = yield* keys.plain(pending);

		yield* useAllowance(
			SESSION_REQUESTER,
			`${request.address}:${pendingHash}`,
			request.now,
		);

		return yield* enterSigninCode({ ...request, pending });
	});
