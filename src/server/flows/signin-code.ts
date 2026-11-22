// A visitor asks for an emailed sign-in code (POST /api/studio/code), as docs/plans/2026-11-studio-signin-conversion.md,
// section 3, sets it out. The order is the one the route has always kept. The code key is checked first (one under 32
// characters is refused before any clock reading). Then each step is a write or an outside call: the client address's
// allowance is counted (`code-ip`, ten per five minutes), the captcha is checked, the address's allowance is counted
// (`code-email`, three), and only then is the code issued. Each allowance reads the clock as it is counted.
//
// The issue reads the clock once, before its read batch, and binds that time in every later statement. It makes the
// same three round trips with the same statements whatever the address and the answer: the read (the address's projects
// and code rows, one batch), the sweep of the rows the sweep rule named (one batch), and the write (one batch, run for
// every answer and bound to do nothing when the issue rule refused). The rules decide from the one read; the read, the
// two decisions and the two writes are sequenced here by hand rather than through `decideAndSave`, which reads again on
// each try and skips the save on a refusal. A refused guard (the facts changed since the read) is answered like a refusal
// and not retried, so a request never makes extra round trips that depend on the address: NoOpenProject, AddressFull and
// a refused guard all end in the same answer and the same cookie. That is the owner's exception to the 409 rule for this
// route (the design's "Owner decisions").
//
// An issued code's email is handed to the background (`Background.defer`: ctx.waitUntil, and with no context it is waited
// for, as the route has done since #367). A confirmed rejection discards the code: the clock is read after the email, the
// code's `used_at` and the projects are read, the machine is asked DISCARD, and the guarded write runs. A timeout or a
// provider error keeps the code, since the email may still arrive. A store failure or a defect there (the email is
// rendered inside the delivery) is logged as the one fixed line the route has always written; the discard swallows only a
// refused guard (the code was used or removed since it was read) and the machine's refusal.
//
// The cookie value is decided here and returned with the outcome, never the outcome alone: the value the browser sent,
// else the new code's, else a fresh random one, so neither the answer nor the cookie shows whether the address has a
// project. The flow builds no response text.
import * as Effect from "effect/Effect";
import { studioCodeEmail } from "../../lib/client-emails";
import { CODE_LIFETIME_MS } from "../../lib/client-portal";
import { codeAllows, discardStateOf } from "../machines/signin-code";
import { discardCode, NothingToDiscard } from "../rules/signin-discard";
import { issueCode } from "../rules/signin-issue";
import { sweepCodes } from "../rules/signin-sweep";
import { allowanceTimes, takeAllowance } from "../rules/studio-allowance";
import { Background, Mail, MusicDb, Turnstile } from "../services";
import { SigninKeys } from "../signin-services";
import {
	countAllowance,
	type DiscardKey,
	readDiscardFacts,
	readIssueFacts,
	sweepExpired,
	writeDiscard,
	writeIssue,
} from "../studio-signin-store";

/** An allowance: the scope its key is counted under, and the most uses a five-minute window allows. */
export type Allowance = { readonly scope: string; readonly limit: number };

/** The client address's allowance for code requests. */
export const CODE_IP: Allowance = { scope: "code-ip", limit: 10 };

/** The address's allowance for code requests: three emails per five minutes. */
export const CODE_EMAIL: Allowance = { scope: "code-email", limit: 3 };

/**
 * One use of a studio allowance for `subject`: the clock is read, the key is the keyed hash of the scope and the subject,
 * the use is counted in one batch, and the allowance rule refuses with AllowanceSpent when the window is over its limit.
 * The code and session routes count through this, after asking `SigninKeys.usable`, so a code key under 32 characters is
 * refused before the first allowance reads the clock, as the routes have always refused it.
 */
export const useAllowance = (
	allowance: Allowance,
	subject: string,
	now: () => Date,
) =>
	Effect.gen(function* () {
		const at = now();
		const keys = yield* SigninKeys;
		const key = yield* keys.keyed(`${allowance.scope}:${subject}`);
		const count = yield* countAllowance(key, allowanceTimes(at));

		yield* takeAllowance.decide({ limit: allowance.limit }, count);
	});

/** A pending sign-in value is 64 hex characters (src/lib/audio-client-access.ts `pendingSignInFromRequest`). */
const PENDING_FORMAT = /^[0-9a-f]{64}$/;

/** The browser's pending value when it is well formed, else null: a browser with no usable value is a new browser. */
export const wellFormedPending = (pending: string | null) =>
	pending !== null && PENDING_FORMAT.test(pending) ? pending : null;

/** What the issue needs: the address, the browser's cookie value, the sender, the clock and the two random draws. */
export type IssueRequest = {
	/** The address, trimmed, lower-cased and checked (`normalizeClientEmail`). */
	readonly address: string;
	/** The pending sign-in value the browser sent, or null. */
	readonly pending: string | null;
	/** The sender of the code's email (env.CONTACT_FROM_EMAIL). */
	readonly from: string;
	/** The time, read at each point the route has always read it. */
	readonly now: () => Date;
	/** A fresh eight-digit code (`newSigninCode`). */
	readonly newCode: () => string;
	/** A fresh pending sign-in value (`newPendingNonce`). */
	readonly newNonce: () => string;
};

export type CodeRequest = IssueRequest & {
	readonly turnstileToken: string;
	/** The address Cloudflare saw. */
	readonly ip: string;
};

/** How the issue ended, for the tests: every outcome gets the same answer. */
export type IssueOutcome =
	| "issued"
	| "NoOpenProject"
	| "AddressFull"
	| "GuardRefused";

export type CodeAnswer = {
	readonly outcome: IssueOutcome;
	/** The value the pending sign-in cookie is set to. */
	readonly pending: string;
};

/** The email's subject. */
const SUBJECT = "Your studio sign-in code";

/**
 * Discards a code whose email Resend refused: the clock is read after the email, then the code's `used_at` and the
 * projects (one batch), the machine is asked DISCARD from the state `used_at` alone gives, the discard rule names the
 * audit's projects, and the guarded write runs (C8). The machine's refusal (the code was used, or is gone) is
 * NothingToDiscard; a refused guard (the code was used or removed since the read) is GuardRefused.
 */
export const discardUndelivered = (key: DiscardKey, now: () => Date) =>
	Effect.gen(function* () {
		const at = now().toISOString();
		const facts = yield* readDiscardFacts(key);

		if (!codeAllows(discardStateOf(facts.code), "DISCARD"))
			return yield* Effect.fail(new NothingToDiscard());

		const discard = yield* discardCode.decide(null, facts);

		yield* writeDiscard({ ...key, at, discard });
	});

/** The discard after a refused email: its two refusals mean the code was used or removed since, and nothing is left to do. */
const discardRefused = (key: DiscardKey, now: () => Date) =>
	discardUndelivered(key, now).pipe(
		Effect.catchTags({
			NothingToDiscard: () => Effect.void,
			GuardRefused: () => Effect.void,
		}),
	);

/**
 * The one line a failed delivery or cleanup writes. Keep private details out of logs; the next request can issue a fresh
 * code.
 */
const deliveryFailed = Effect.sync(() =>
	console.error("Studio code delivery or cleanup failed."),
);

/**
 * Hands the code's email to the background. Each failure is named and handled where it happens: a confirmed rejection
 * discards the code, an uncertain send keeps it, the discard's two refusals end it, and a store failure is the fixed line.
 * A defect (the email failing to render, a bug in the send or the discard) is the fixed line too: the route caught any
 * rejection of its delivery, so the visitor keeps the generic answer and the background settles fulfilled.
 */
const deliver = (
	code: string,
	key: DiscardKey,
	request: Pick<IssueRequest, "from" | "now">,
) =>
	Effect.gen(function* () {
		const mail = yield* Mail;
		const db = yield* MusicDb;
		const background = yield* Background;

		// The email is rendered inside the delivery, as the route rendered it inside its caught promise. The background
		// starts the delivery at once, so the render and the send still begin before the answer.
		const delivery = Effect.suspend(() =>
			mail.send({
				from: request.from,
				to: [key.address],
				subject: SUBJECT,
				...studioCodeEmail(code),
			}),
		).pipe(
			Effect.catchTags({
				MailRefused: () => discardRefused(key, request.now),
				// After a timeout or a provider error the email may still arrive, so the code stays usable until it expires.
				MailUncertain: () => Effect.void,
			}),
			Effect.catchTags({ StudioSigninStoreFailed: () => deliveryFailed }),
			Effect.catchDefect(() => deliveryFailed),
			Effect.provideService(MusicDb, db),
		);

		yield* background.defer([delivery]);
	});

/**
 * The issue, after the allowances and the captcha: the clock, the code and the browser's value drawn, the two hashes, the
 * read, the two decisions, the sweep and the write, then the email of an issued code. Answers how it ended and the cookie
 * value.
 */
export const issueSigninCode = (request: IssueRequest) =>
	Effect.gen(function* () {
		const now = request.now();
		const keys = yield* SigninKeys;
		const code = request.newCode();
		const sent = wellFormedPending(request.pending);
		const nonce = sent ?? request.newNonce();
		const nonceHash = yield* keys.plain(nonce);

		// The code's hash covers the browser's value, so a code only works with the cookie it was issued to.
		const codeHash = yield* keys.keyed(
			`${request.address}:${nonceHash}:${code}`,
		);

		const issuedAt = now.toISOString();
		const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS).toISOString();
		const facts = yield* readIssueFacts(request.address);
		const sweep = yield* sweepCodes.decide({ now: issuedAt }, facts);

		const decided = yield* issueCode
			.decide(
				{ address: request.address, ownNonceHash: nonceHash, now: issuedAt },
				facts,
			)
			.pipe(
				Effect.match({
					onFailure: (refusal) => ({ issue: null, outcome: refusal._tag }),
					onSuccess: (issue) => ({ issue, outcome: "issued" as const }),
				}),
			);

		// The sweep runs for every answer, and is kept when the write below is refused.
		yield* sweepExpired({ address: request.address, at: issuedAt, sweep });

		const outcome: IssueOutcome = yield* writeIssue({
			address: request.address,
			nonceHash,
			codeHash,
			issuedAt,
			expiresAt,
			issue: decided.issue,
		}).pipe(
			Effect.as(decided.outcome),
			Effect.catchTags({
				GuardRefused: () => Effect.succeed("GuardRefused" as const),
			}),
		);

		if (outcome === "issued")
			yield* deliver(
				code,
				{ address: request.address, nonceHash, codeHash },
				request,
			);

		return {
			outcome,
			pending: sent ?? (outcome === "issued" ? nonce : request.newNonce()),
		} satisfies CodeAnswer;
	});

/**
 * The code request: the code key checked, `code-ip`, the captcha, `code-email`, then the issue. A code key under 32
 * characters is CodeKeyUnusable, before any clock reading or statement; a spent allowance is AllowanceSpent, a token
 * Turnstile did not pass is TurnstileFailed; every outcome of the issue is the same answer, with the cookie value.
 */
export const requestCode = (request: CodeRequest) =>
	Effect.gen(function* () {
		const keys = yield* SigninKeys;

		yield* keys.usable;
		yield* useAllowance(CODE_IP, request.ip, request.now);

		const turnstile = yield* Turnstile;

		yield* turnstile.verify(request.turnstileToken, request.ip);
		yield* useAllowance(CODE_EMAIL, request.address, request.now);

		return yield* issueSigninCode(request);
	});
