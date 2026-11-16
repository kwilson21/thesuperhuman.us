// The rules of the archive link: a client asks for a link to the signed agreements kept for their address. The answer is
// the same sentence whether or not the address has an executed agreement, so the request is decided here and the flow
// only reads and writes. Each refusal names the sentence the route gives; the route never shows which check failed.
import { escapeHtml } from "../../lib/email-template";
import * as Data from "effect/Data";
import { alwaysWrites, rule, term, unless } from "../terms";

/** The receipt every archive answer gives, whether or not a link was sent. */
export const ARCHIVE_RECEIPT =
	"If an agreement is available, a link is on its way.";

export const CROWDED =
	"Please wait a few minutes before requesting another link.";

export const COOLDOWN =
	"Wait at least 30 seconds before requesting another link.";

export const SECURITY_AGAIN = "Complete the security check again.";
export const INVALID_EMAIL = "Enter a valid email address.";
export const UNAVAILABLE = "Agreement sign-in is temporarily unavailable.";

/** How many archive links one address may ask for in a window, and how many one client address may ask for. */
export const ADDRESS_ALLOWANCE = {
	scope: "archive-link-ip",
	limit: 20,
} as const;

export const EMAIL_ALLOWANCE = {
	scope: "archive-link-email",
	limit: 3,
} as const;

/** The least time between two links for one address, and how long a link works. */
export const COOLDOWN_MS = 30_000;
export const LINK_LIFETIME_MS = 3_600_000;

export class InvalidEmail extends Data.TaggedError("InvalidEmail") {
	readonly say = INVALID_EMAIL;
}

/** The per-address or per-client-address allowance is used up: a few minutes' wait. */
export class TooManyLinks extends Data.TaggedError("TooManyLinks") {
	readonly say = CROWDED;
}

export class SecurityCheckFailed extends Data.TaggedError(
	"SecurityCheckFailed",
) {
	readonly say = SECURITY_AGAIN;
}

/** The cooldown is running: the last link for this address is under 30 seconds old. */
export class CooldownRunning extends Data.TaggedError("CooldownRunning") {
	readonly say = COOLDOWN;
}

/** Whether a counted use is within its allowance (the counter says; this is the refusal when it is not). */
export const withinAllowance = alwaysWrites({
	name: "admit a request within its allowance",
	given: (_request: null, facts: { readonly allowed: boolean }) => facts,
	refusals: [
		unless(
			term(
				"the allowance is not used up",
				(given: { allowed: boolean }) => given.allowed,
			),
			() => new TooManyLinks(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the request goes on",
});

/**
 * The cooldown: the address's cooldown row is taken when it is absent or at least 30 seconds old. The write is a
 * compare-and-set on the same condition, so two requests at once cannot both take it; this rule judges the same
 * condition from the row that was read, so a lost write is judged again on the row that won.
 */
export const takeCooldown = alwaysWrites({
	name: "take the address's cooldown",
	given: (
		request: { readonly at: Date },
		facts: { readonly windowStart: string | null },
	) => ({
		at: request.at.toISOString(),
		since: new Date(request.at.getTime() - COOLDOWN_MS).toISOString(),
		windowStart: facts.windowStart,
	}),
	refusals: [
		unless(
			term(
				"the cooldown row is absent or at least 30 seconds old",
				(given: { windowStart: string | null; since: string }) =>
					given.windowStart === null || given.windowStart <= given.since,
			),
			() => new CooldownRunning(),
		),
	],
	writes: (given) => ({ at: given.at, since: given.since }),
	writesText: "the cooldown row, set to now",
});

/** An archive link of the address as stored. */
export type StoredArchiveLink = {
	readonly id: string;
	readonly issued_at: string;
	readonly used_at: string | null;
};

/** What an address's links and agreements say, read together, and the time the decision is made. */
export type ArchiveLinkFacts = {
	/** The status of each agreement of the address's clients. */
	readonly agreementStatuses: readonly string[];
	/** The address's archive links. */
	readonly links: readonly StoredArchiveLink[];
	readonly at: Date;
};

/**
 * Whether a link is sent. Nothing to do when the address has no executed agreement: the receipt is given and no link row
 * or mail is written. A link issued in the last 30 seconds refuses with the cooldown's sentence (the batch that stores the
 * link carries the same condition as its write-time guard).
 */
export const issueArchiveLink = rule({
	name: "issue an archive link",
	given: (_request: null, facts: ArchiveLinkFacts) => {
		const since = new Date(facts.at.getTime() - COOLDOWN_MS).toISOString();

		return {
			executed: facts.agreementStatuses.some((status) => status === "executed"),
			recentlyIssued: facts.links.some((link) => link.issued_at > since),
			at: facts.at.toISOString(),
			since,
			expiresAt: new Date(facts.at.getTime() + LINK_LIFETIME_MS).toISOString(),
		};
	},
	nothingToDoIf: term(
		"the address has no executed agreement",
		(given: { executed: boolean }) => !given.executed,
	),
	refusals: [
		unless(
			term(
				"no link was issued to the address in the last 30 seconds",
				(given: { recentlyIssued: boolean }) => !given.recentlyIssued,
			),
			() => new CooldownRunning(),
		),
	],
	writes: (given) => ({
		at: given.at,
		since: given.since,
		expiresAt: given.expiresAt,
	}),
	writesText: "one link row, its issue event, and the mail with the link",
});

/** One signature of the address's clients, with the status of its agreement. */
export type StoredSignature = {
	readonly typed_name: string;
	readonly party: string;
	readonly signed_at: string;
	readonly status: string;
};

/** The name of the address's most recent client signature on an executed agreement (the first when two are equally recent). */
export const signerName = alwaysWrites({
	name: "greet the signer of the address's latest executed agreement",
	given: (_request: null, facts: readonly StoredSignature[]) =>
		facts.reduce<StoredSignature | null>(
			(latest, signature) =>
				signature.party === "client" &&
				signature.status === "executed" &&
				(latest === null || signature.signed_at > latest.signed_at)
					? signature
					: latest,
			null,
		),
	refusals: [],
	writes: (latest) => latest?.typed_name ?? null,
	writesText: "the name for the greeting, or none",
});

/** The older links to consume once a link has been sent: the address's unused links issued no later than this one. */
export const consumeOlderLinks = alwaysWrites({
	name: "consume the address's older unused links",
	given: (
		request: { readonly id: string; readonly at: string },
		facts: readonly StoredArchiveLink[],
	) => ({
		at: request.at,
		ids: facts.flatMap((link) =>
			link.used_at === null &&
			link.id !== request.id &&
			link.issued_at <= request.at
				? [link.id]
				: [],
		),
	}),
	refusals: [],
	writes: (given) => given,
	writesText: "used_at on each older unused link (none when there is none)",
});

/** What the answer of the mail service means for the links: a refused mail marks its own link used; any other keeps it and consumes the older ones. */
export const afterMail = alwaysWrites({
	name: "settle the links once the mail has been tried",
	given: (
		_request: null,
		facts: { readonly outcome: "sent" | "refused" | "uncertain" },
	) => facts.outcome,
	refusals: [],
	writes: (outcome): "mark-used" | "consume-older" =>
		outcome === "refused" ? "mark-used" : "consume-older",
	writesText: "the new link marked used, or the older links consumed",
});

/** The mail's words for an archive link: the greeting takes the first word of the signature name, or "there". */
export function archiveMail(input: {
	readonly name: string | null | undefined;
	readonly url: string;
}) {
	const greeting = `Hi ${input.name?.trim().split(/\s+/)[0] || "there"},`;
	const intro = "Tap below to open your signed agreement documents.";
	const action = "Open your documents";

	const expiry =
		"This link works once and expires in an hour. If you didn’t ask for it, you can ignore this email.";

	return {
		subject: "Your signed documents",
		text: `${greeting}\n\n${intro}\n\n${action}: ${input.url}\n\n${expiry}\n\nKazon`,
		html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(input.url)}">${action}</a></p><p>${escapeHtml(expiry)}</p><p>Kazon</p>`,
	};
}

/** The bindings and secrets the archive link needs, once all are set. */
export type LinkSettings = {
	readonly database: D1Database;
	readonly codeKey: string;
	readonly resendKey: string;
	readonly sender: string;
	readonly turnstileSecret: string;
};

/**
 * The settings the sign-in runs with, or null: the database, the code key (of at least 32 characters, the least the keyed
 * hash takes), the mail key and sender, and the captcha secret must all be set. Any missing one is the same unavailable
 * answer.
 */
export function linkSettings(env: {
	readonly MUSIC_DB?: D1Database;
	readonly AUDIO_CLIENT_CODE_KEY?: string;
	readonly RESEND_API_KEY?: string;
	readonly CONTACT_FROM_EMAIL?: string;
	readonly TURNSTILE_SECRET_KEY?: string;
}): LinkSettings | null {
	const { MUSIC_DB, AUDIO_CLIENT_CODE_KEY, RESEND_API_KEY } = env;
	const { CONTACT_FROM_EMAIL, TURNSTILE_SECRET_KEY } = env;

	return MUSIC_DB &&
		AUDIO_CLIENT_CODE_KEY &&
		AUDIO_CLIENT_CODE_KEY.length >= 32 &&
		RESEND_API_KEY &&
		CONTACT_FROM_EMAIL &&
		TURNSTILE_SECRET_KEY
		? {
				database: MUSIC_DB,
				codeKey: AUDIO_CLIENT_CODE_KEY,
				resendKey: RESEND_API_KEY,
				sender: CONTACT_FROM_EMAIL,
				turnstileSecret: TURNSTILE_SECRET_KEY,
			}
		: null;
}
