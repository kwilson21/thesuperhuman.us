// The rules of the archive link: a client asks for a link to the signed agreements kept for their address. The answer is
// the same sentence whether or not the address has an executed agreement, so the request is decided here and the flow
// only reads and writes. Each refusal names the sentence the route gives; the route never shows which check failed.
import { escapeHtml } from "../../lib/email-template";
import { rule, term } from "../terms";

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

const DEFAULT_ORIGIN = "https://thesuperhuman.us";

/**
 * Whether the request came to the site's own origin (`SITE_ORIGIN`, or the default), on the same host. A configured origin
 * that does not parse is not the site's origin.
 */
export function isCanonicalRequest(input: {
	readonly configuredOrigin: string | undefined;
	readonly requestUrl: string;
	readonly hostHeader: string | null;
}): boolean {
	const configured = input.configuredOrigin ?? DEFAULT_ORIGIN;

	if (!URL.canParse(configured) || !URL.canParse(input.requestUrl))
		return false;
	const canonical = new URL(configured);
	const url = new URL(input.requestUrl);

	return (
		url.origin === canonical.origin &&
		(input.hostHeader === null ||
			input.hostHeader.toLowerCase() === canonical.host)
	);
}

/** The facts the decision needs once the address is allowed through: whether it has an executed agreement. */
export type ArchiveLinkFacts = { readonly hasExecutedAgreement: boolean };

/**
 * Whether a link is sent. Nothing to do when the address has no executed agreement: the receipt is given and no link row
 * or mail is written. Otherwise the link is issued.
 */
export const issueArchiveLink = rule({
	name: "issue an archive link",
	given: (_request: null, facts: ArchiveLinkFacts) => facts,
	nothingToDoIf: term(
		"the address has no executed agreement",
		(given: ArchiveLinkFacts) => !given.hasExecutedAgreement,
	),
	refusals: [],
	writes: (given: ArchiveLinkFacts) => given,
	writesText: "one link row, its issue event, and the mail with the link",
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

/**
 * Whether the sign-in can run: the database, the code key (of at least 32 characters, the least the keyed hash takes), the
 * mail key and sender, and the captcha secret are all set. Any missing one is the same unavailable answer.
 */
export function linkIsConfigured(input: {
	readonly database: unknown;
	readonly codeKey: string | undefined;
	readonly resendKey: string | undefined;
	readonly sender: string | undefined;
	readonly turnstileSecret: string | undefined;
}): boolean {
	return Boolean(
		input.database &&
			input.codeKey &&
			input.codeKey.length >= 32 &&
			input.resendKey &&
			input.sender &&
			input.turnstileSecret,
	);
}
