import { vi } from "vitest";
import {
	EffectLog,
	json,
	networkDown,
	recordingFetch,
	type Responder,
} from "../golden/harness";

/** One email the studio sent through the Resend API, as its request carried it. */
export type ResendEmail = {
	readonly authorization: string | null;
	readonly from: string;
	readonly to: string[];
	readonly subject: string;
	readonly text: string;
	readonly html?: string;
	readonly reply_to?: string;
};

/** How the Resend API answers one request: an HTTP status, or no answer at all (the connection fails). */
export type ResendAnswer = { readonly status: number } | "network-down";

/** What the stand-in answers. Each list is used in order; a request past its end gets the default. */
export type OutboundAnswers = {
	/** Answers to Resend requests, in order. Past the end, a request gets 200. */
	readonly resend?: readonly ResendAnswer[];
	/** Turnstile verdicts, in order (true passes the captcha). The last verdict repeats. Default: every check passes. */
	readonly turnstile?: readonly boolean[];
	/** When given, each Resend request waits for this promise before it is answered and recorded. */
	readonly hold?: Promise<void>;
};

const RESEND = "https://api.resend.com/";

/**
 * Replaces the global fetch with a stand-in for the two services the routes call: the Resend API and Turnstile's
 * siteverify. Each Resend request is answered in order from `resend`, and each one with a body (an email) is recorded
 * in the returned list. Each Turnstile request is answered from `turnstile`. Any other outgoing fetch throws, so a test
 * cannot reach the network by accident. The fetch is a vi.fn, so vi.mocked(fetch) lists every call. Returns the emails
 * recorded so far; vi.unstubAllGlobals() restores the real fetch.
 */
export function stubResend(answers: OutboundAnswers = {}): ResendEmail[] {
	const emails: ResendEmail[] = [];
	const resend = answers.resend ?? [];
	const turnstile = answers.turnstile ?? [true];

	const responder: Responder = ({ host, n }) => {
		if (host === "turnstile")
			return json(200, {
				success: turnstile[Math.min(n, turnstile.length - 1)] ?? true,
			});

		if (host !== "resend")
			return networkDown(`resend-fetch: no answer scripted for ${host}`);

		const answer = resend[n] ?? { status: 200 };

		if (answer === "network-down") return networkDown("fetch failed");

		return json(answer.status, { id: `email-${n + 1}` });
	};

	const answerFromHarness = recordingFetch(responder, new EffectLog());

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);

			if (url.startsWith(RESEND) && answers.hold) await answers.hold;

			if (
				url.startsWith(RESEND) &&
				init?.body !== undefined &&
				init.body !== null
			)
				emails.push(
					emailFrom(
						String(init.body),
						new Headers(init.headers).get("authorization"),
					),
				);

			return answerFromHarness(input, init);
		}),
	);

	return emails;
}

function emailFrom(body: string, authorization: string | null): ResendEmail {
	return {
		authorization,
		// SAFETY: the routes send each email as a JSON object with the Resend field names (from, to, subject, text, html, reply_to); the cast trusts that shape and does not check it, and the tests read only the fields they assert on.
		...(JSON.parse(body) as Omit<ResendEmail, "authorization">),
	};
}
