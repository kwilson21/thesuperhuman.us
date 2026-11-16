import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { ResumeRequestInput } from "../../src/server/contact-input";
import { approveResume, requestResume } from "../../src/server/flows/resume";
import {
	type MailMessage,
	Mail,
	MailRefused,
	MailUncertain,
	RateLimit,
	ResumeStore,
	Turnstile,
	TurnstileFailed,
} from "../../src/server/services";
import { fakeKv } from "../helpers/doubles";
import { answerOfRun, done, refuse, refuseWith } from "../helpers/rule-answers";

// The resume rules as stories. A visitor asks (`requestResume`): the request is stored and the owner is emailed a link.
// The owner opens the link (`approveResume`): the PDF is emailed and only then is the request deleted. The time, the id
// and the origin are plain inputs.

type Outcome = "sent" | "refused" | "uncertain";

const mailAnswer = (outcome: Outcome) =>
	outcome === "sent"
		? Effect.void
		: outcome === "refused"
			? Effect.fail(new MailRefused())
			: Effect.fail(new MailUncertain());

const ALLOWANCE = "rl:203.0.113.7";

const input: ResumeRequestInput = {
	name: "Grace Hopper",
	email: "grace@example.com",
	company: "Navy",
	audience: "general",
	note: "For the open role.",
	turnstileToken: "token-1",
};

type RequestWorld = {
	counted?: string;
	captcha?: "pass" | "fail";
	mail?: Outcome;
};

/** What the rule did: what it counted, what it stored, and each email it tried to send (to, and the line with the link). */
type Seen = { counts: string[]; stored: string[]; mails: string[] };

const askToRequest = async (world: RequestWorld) => {
	const seen: Seen = { counts: [], stored: [], mails: [] };

	const answer = await answerOfRun(
		requestResume({
			input,
			visitor: { ip: "203.0.113.7", turnstileToken: input.turnstileToken },
			now: 1_794_571_200_000,
			id: "id-1",
			origin: "https://thesuperhuman.us",
			from: "site@example.test",
			to: "owner@example.test",
		}).pipe(
			Effect.provideService(
				RateLimit,
				fakeKv({
					// Only the visitor's own allowance is recorded here; the coarse count of attempts has its own stories
					// in tests/security/rate-order.test.ts.
					get: async (key: string) =>
						key === ALLOWANCE ? (world.counted ?? null) : null,
					put: async (key: string, value: string) => {
						if (key === ALLOWANCE) seen.counts.push(value);
					},
				}),
			),
			Effect.provideService(
				ResumeStore,
				fakeKv({
					get: async () => null,
					put: async (
						key: string,
						_value: string,
						options: { expirationTtl: number },
					) => {
						seen.stored.push(`${key} ${JSON.stringify(options)}`);
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
					seen.mails.push(
						`${message.to.join(",")}: ${message.text.split("\n").find((line) => line.startsWith("https://"))}`,
					);

					return mailAnswer(world.mail ?? "sent");
				},
			}),
		),
	);

	return { answer, seen };
};

const WAIT = refuse(
	"RateLimited",
	"Please wait a few minutes before submitting again.",
);

const NOT_SENT = refuse(
	"ResumeRequestNotSent",
	"Could not send the request right now. Please email kazon.wilson@thesuperhuman.us directly.",
);

const LINK =
	"owner@example.test: https://thesuperhuman.us/api/resume-approve?id=id-1";

const STORED = 'req:id-1 {"expirationTtl":604800}';

describe("Ask for the resume", () => {
	it.each([
		[
			"stores the request for seven days and emails the owner the link",
			{},
			done(undefined),
			{ counts: ["1"], stored: [STORED], mails: [LINK] },
		],
		[
			"waits when the visitor's address submitted in the last few minutes",
			{ counted: "1" },
			WAIT,
			{ counts: [], stored: [], mails: [] },
		],
		[
			"refuses a failed captcha, leaves the visitor's allowance unused, and stores nothing",
			{ captcha: "fail" },
			refuse("CaptchaFailed", "Captcha failed."),
			{ counts: [], stored: [], mails: [] },
		],
		[
			"says so when Resend refuses the email, though the request stays stored",
			{ mail: "refused" },
			NOT_SENT,
			{ counts: ["1"], stored: [STORED], mails: [LINK] },
		],
		[
			"says so when the email may not have gone",
			{ mail: "uncertain" },
			NOT_SENT,
			{ counts: ["1"], stored: [STORED], mails: [LINK] },
		],
	] as const)("%s", async (_story, world, answer, seen) => {
		expect(await askToRequest(world)).toEqual({ answer, seen });
	});
});

const stored = (audience: string) =>
	JSON.stringify({
		name: "Grace Hopper",
		email: "grace@example.com",
		company: "Navy",
		audience,
		note: "",
		ts: 1_700_000_000_000,
	});

type ApproveWorld = {
	id?: string | null;
	/** The stored request under `req:abc`, as the text that is stored. */
	request?: string;
	/** Which resumes are in storage. */
	pdfs?: readonly string[];
	mail?: Outcome;
};

/** What the rule did: each key it read, each email's recipient and attachment name, and each key it deleted. */
type Reads = { read: string[]; mails: string[]; deleted: string[] };

const askToApprove = async (world: ApproveWorld) => {
	const seen: Reads = { read: [], mails: [], deleted: [] };

	const answer = await answerOfRun(
		approveResume({
			id: world.id === undefined ? "abc" : world.id,
			from: "site@example.test",
		}).pipe(
			Effect.provideService(
				ResumeStore,
				fakeKv({
					get: async (key: string, type?: string) => {
						seen.read.push(key);

						if (type === "arrayBuffer") {
							return world.pdfs?.includes(key.replace("pdf:", ""))
								? new ArrayBuffer(4)
								: null;
						}

						return key === "req:abc" ? (world.request ?? null) : null;
					},
					delete: async (key: string) => {
						seen.deleted.push(key);
					},
				}),
			),
			Effect.provideService(Mail, {
				send: (message: MailMessage) => {
					seen.mails.push(
						`${message.to.join(",")}: ${message.attachments?.map((a) => a.filename).join(",")}`,
					);

					return mailAnswer(world.mail ?? "sent");
				},
			}),
		),
	);

	return { answer, seen };
};

describe("Approve a resume request from the owner's link", () => {
	it.each([
		[
			"emails the general resume, then deletes the request",
			{ request: stored("general"), pdfs: ["general"] },
			done({ audience: "general", email: "grace@example.com" }),
			{
				read: ["req:abc", "pdf:general"],
				mails: ["grace@example.com: Kazon-Wilson-Resume.pdf"],
				deleted: ["req:abc"],
			},
		],
		[
			"still fulfils a stored legacy dod request",
			{ request: stored("dod"), pdfs: ["dod"] },
			done({ audience: "dod", email: "grace@example.com" }),
			{
				read: ["req:abc", "pdf:dod"],
				mails: ["grace@example.com: kazon-wilson-resume-dod.pdf"],
				deleted: ["req:abc"],
			},
		],
		[
			"refuses a link with no id, reading nothing",
			{ id: null },
			refuse("MissingRequestId", "This link is malformed."),
			{ read: [], mails: [], deleted: [] },
		],
		[
			"refuses a link with an empty id, reading nothing",
			{ id: "" },
			refuse("MissingRequestId", "This link is malformed."),
			{ read: [], mails: [], deleted: [] },
		],
		[
			"refuses a link whose request was used or has expired",
			{},
			refuse(
				"RequestNotFound",
				"This approval link has either been used already or expired. Requests are single-use and live for seven days.",
			),
			{ read: ["req:abc"], mails: [], deleted: [] },
		],
		[
			"treats a stored request that is not JSON as not found",
			{ request: "not json" },
			refuse(
				"RequestNotFound",
				"This approval link has either been used already or expired. Requests are single-use and live for seven days.",
			),
			{ read: ["req:abc"], mails: [], deleted: [] },
		],
		[
			"says which key is empty when the resume is not in storage, and keeps the request",
			{ request: stored("general") },
			refuseWith("ResumePdfMissing", { audience: "general" }),
			{ read: ["req:abc", "pdf:general"], mails: [], deleted: [] },
		],
		[
			"keeps the request when Resend refuses the email",
			{ request: stored("general"), pdfs: ["general"], mail: "refused" },
			refuseWith("ResumeNotSent", {
				requesterName: "Grace Hopper",
				email: "grace@example.com",
			}),
			{
				read: ["req:abc", "pdf:general"],
				mails: ["grace@example.com: Kazon-Wilson-Resume.pdf"],
				deleted: [],
			},
		],
		[
			"keeps the request when the email may not have gone",
			{ request: stored("general"), pdfs: ["general"], mail: "uncertain" },
			refuseWith("ResumeNotSent", {
				requesterName: "Grace Hopper",
				email: "grace@example.com",
			}),
			{
				read: ["req:abc", "pdf:general"],
				mails: ["grace@example.com: Kazon-Wilson-Resume.pdf"],
				deleted: [],
			},
		],
	] as const)("%s", async (_story, world, answer, seen) => {
		expect(await askToApprove(world)).toEqual({ answer, seen });
	});
});
