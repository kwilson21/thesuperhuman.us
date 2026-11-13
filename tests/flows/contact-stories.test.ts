import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { ContactInput } from "../../src/server/contact-input";
import { submitContact } from "../../src/server/flows/contact";
import {
	type MailMessage,
	Mail,
	MailRefused,
	MailUncertain,
	RateLimit,
	Turnstile,
	TurnstileFailed,
} from "../../src/server/services";
import { fakeKv } from "../helpers/doubles";
import { answerOfRun, done, refuse } from "../helpers/rule-answers";

// The contact form's rule as stories: each row is what the world was like (who already submitted, what the captcha and
// Resend said) and what the rule answered, with what it counted and emailed. The addresses are plain inputs.

const input: ContactInput = {
	name: "Ada Lovelace",
	email: "ada@example.com",
	company: "Analytical Engines",
	description: "I would like to talk about a project.",
	turnstileToken: "token-1",
};

type World = {
	/** The count already stored for the visitor's address. */
	counted?: string;
	captcha?: "pass" | "fail";
	/** What Resend answers to each email, in order; the last repeats. */
	mail?: readonly ("sent" | "refused" | "uncertain")[];
};

/** What the rule did: what it counted, and each email it tried to send. */
type Seen = { counts: string[]; mails: string[] };

const ask = async (world: World) => {
	const seen: Seen = { counts: [], mails: [] };
	const answers = world.mail ?? ["sent"];

	const answer = await answerOfRun(
		submitContact({
			input,
			visitor: { ip: "203.0.113.7", turnstileToken: input.turnstileToken },
			from: "site@example.test",
			to: "owner@example.test",
		}).pipe(
			Effect.provideService(
				RateLimit,
				fakeKv({
					get: async () => world.counted ?? null,
					put: async (_key: string, value: string) => {
						seen.counts.push(value);
					},
				}),
			),
			Effect.provideService(Turnstile, {
				verify: () =>
					world.captcha === "fail"
						? Effect.fail(new TurnstileFailed())
						: Effect.void,
			}),
			Effect.provideService(Mail, {
				send: (message: MailMessage) => {
					const outcome =
						answers[Math.min(seen.mails.length, answers.length - 1)];

					seen.mails.push(`${message.to.join(",")}: ${message.subject}`);

					return outcome === "sent"
						? Effect.void
						: outcome === "refused"
							? Effect.fail(new MailRefused())
							: Effect.fail(new MailUncertain());
				},
			}),
		),
	);

	return { answer, seen };
};

const OWNER = "owner@example.test: New message from Ada Lovelace";
const REPLY = "ada@example.com: Thanks for reaching out (Kazon Wilson)";

describe("Send a message through the contact form", () => {
	it.each([
		[
			"emails the owner, then thanks the visitor",
			{},
			done(undefined),
			{ counts: ["1"], mails: [OWNER, REPLY] },
		],
		[
			"counts a visitor whose count is zero",
			{ counted: "0" },
			done(undefined),
			{ counts: ["1"], mails: [OWNER, REPLY] },
		],
		[
			"waits when the visitor's address submitted in the last few minutes",
			{ counted: "1" },
			refuse(
				"RateLimited",
				"Please wait a few minutes before submitting again.",
			),
			{ counts: [], mails: [] },
		],
		[
			"waits when the stored count is not a number",
			{ counted: "abc" },
			refuse(
				"RateLimited",
				"Please wait a few minutes before submitting again.",
			),
			{ counts: [], mails: [] },
		],
		[
			"refuses a failed captcha, after counting the submission",
			{ captcha: "fail" },
			refuse("CaptchaFailed", "Captcha failed."),
			{ counts: ["1"], mails: [] },
		],
		[
			"says so when Resend refuses the email to the owner, and sends no thank-you",
			{ mail: ["refused"] },
			refuse(
				"ContactNotDelivered",
				"We could not confirm email delivery. Please email kazon.wilson@thesuperhuman.us directly.",
			),
			{ counts: ["1"], mails: [OWNER] },
		],
		[
			"says so when the email to the owner may not have gone",
			{ mail: ["uncertain"] },
			refuse(
				"ContactNotDelivered",
				"We could not confirm email delivery. Please email kazon.wilson@thesuperhuman.us directly.",
			),
			{ counts: ["1"], mails: [OWNER] },
		],
		[
			"still succeeds when only the thank-you is refused",
			{ mail: ["sent", "refused"] },
			done(undefined),
			{ counts: ["1"], mails: [OWNER, REPLY] },
		],
		[
			"still succeeds when the thank-you may not have gone",
			{ mail: ["sent", "uncertain"] },
			done(undefined),
			{ counts: ["1"], mails: [OWNER, REPLY] },
		],
	] as const)("%s", async (_story, world, answer, seen) => {
		expect(await ask(world)).toEqual({ answer, seen });
	});
});
