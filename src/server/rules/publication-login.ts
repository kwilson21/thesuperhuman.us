// The decisions of the publication sign-in, each over plain values and each pure: whether an authorization request may be
// shown the consent page, whether the consent form came from this site and carries the page's nonce, whether the sealed
// login state is still open, whether the GitHub callback matches that state, and whether GitHub's answers name the owner.
// Every refusal is the visitor's: the sign-in could not be completed and starts again. What is the site's own fault (the
// grant store, the cookie key, GitHub being down) is not decided here; the services and the cookie name those failures.
// Nothing is read or written, so no write-time guard applies.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** Said to the visitor in the answer's body. */
export class LoginRefused extends Data.TaggedError("LoginRefused") {
	readonly say =
		"Sign-in could not be completed. Start again from your connection settings.";
}

const refuse = () => new LoginRefused();

/** An authorization request as the OAuth library parsed it. */
export type AuthorizationAsked = {
	readonly responseType: string;
	readonly codeChallengeMethod?: string | undefined;
	readonly codeChallenge?: string | undefined;
	readonly scope: readonly string[];
	readonly resource?: string | undefined;
};

type ShowConsentRequest = {
	readonly auth: AuthorizationAsked;
	readonly supported: readonly string[];
	readonly resource: string;
};

export const showConsent = alwaysWrites({
	name: "Show the consent page for an authorization request",
	given: (request: ShowConsentRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<ShowConsentRequest>(
				"it asks for an authorization code with an S256 challenge, for scopes of listed projects, for this site's resource",
				(g) =>
					g.auth.responseType === "code" &&
					g.auth.codeChallengeMethod === "S256" &&
					Boolean(g.auth.codeChallenge) &&
					g.auth.scope.length > 0 &&
					g.auth.scope.every((s) => g.supported.includes(s)) &&
					g.auth.resource === g.resource,
			),
			refuse,
		),
	],
	writes: () => true,
	writesText: "nothing: the consent page is shown",
});

type RegisteredClientRequest = {
	readonly clientId: string;
	readonly client: { readonly clientName?: string | undefined } | null;
};

export const registeredClient = alwaysWrites({
	name: "Know the client that asks",
	given: (request: RegisteredClientRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<RegisteredClientRequest>(
				"the client is registered",
				(g) => g.client !== null,
			),
			refuse,
		),
	],
	// The name it gave itself, or its id when it gave none.
	writes: (g) => g.client?.clientName || g.clientId,
	writesText: "the name the page shows for the client",
});

type SameSiteConsentRequest = {
	readonly origin: string | null;
	readonly site: string;
};

export const sameSiteConsent = alwaysWrites({
	name: "Take consent only from this site's own page",
	given: (request: SameSiteConsentRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<SameSiteConsentRequest>(
				"the form was posted from this site",
				(g) => g.origin === g.site,
			),
			refuse,
		),
	],
	writes: () => true,
	writesText: "nothing: the visitor goes on to GitHub",
});

type LoginOpenRequest = { readonly expires: number; readonly now: number };

export const loginOpen = alwaysWrites({
	name: "Keep a sign-in open for ten minutes",
	given: (request: LoginOpenRequest, _facts: Record<string, never>) => request,
	refusals: [
		unless(
			term<LoginOpenRequest>(
				"the sealed state has a finite expiry that has not passed",
				(g) => Number.isFinite(g.expires) && !(g.expires < g.now),
			),
			refuse,
		),
	],
	writes: () => true,
	writesText: "nothing: the state is open",
});

type ApproveConsentRequest = {
	readonly approved: boolean;
	readonly nonce: string;
	readonly posted: string | null;
};

export const approveConsent = alwaysWrites({
	name: "Approve consent once, with the page's nonce",
	given: (request: ApproveConsentRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<ApproveConsentRequest>(
				"the sign-in is not approved yet and the form carries its nonce",
				(g) => !g.approved && g.posted === g.nonce,
			),
			refuse,
		),
	],
	writes: () => true,
	writesText: "nothing: the state is marked approved",
});

const LONGEST_CODE = 512;

type ReturnFromGithubRequest = {
	readonly approved: boolean;
	readonly nonce: string;
	readonly code: string | null;
	readonly state: string | null;
};

export const returnFromGithub = alwaysWrites({
	name: "Take GitHub's callback for an approved sign-in",
	given: (request: ReturnFromGithubRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<ReturnFromGithubRequest>(
				"the sign-in was approved, and the callback has a code of at most 512 characters and the sign-in's nonce",
				(g) =>
					g.approved &&
					Boolean(g.code) &&
					(g.code?.length ?? 0) <= LONGEST_CODE &&
					g.state === g.nonce,
			),
			refuse,
		),
	],
	writes: (g) => g.code ?? "",
	writesText: "the code to exchange at GitHub",
});

type TokenGivenRequest = {
	readonly ok: boolean;
	readonly error: unknown;
	readonly token: string | undefined;
};

export const tokenGiven = alwaysWrites({
	name: "Take GitHub's answer to the code exchange",
	given: (request: TokenGivenRequest, _facts: Record<string, never>) => request,
	refusals: [
		unless(
			term<TokenGivenRequest>(
				"GitHub answered with success, no error and an access token",
				(g) => g.ok && !g.error && Boolean(g.token),
			),
			refuse,
		),
	],
	writes: (g) => g.token ?? "",
	writesText: "the access token, used once to ask who signed in",
});

type OwnerSignedInRequest = {
	readonly ok: boolean;
	readonly id: string | undefined;
	readonly ownerId: string | undefined;
};

export const ownerSignedIn = alwaysWrites({
	name: "Grant only the owner",
	given: (request: OwnerSignedInRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<OwnerSignedInRequest>(
				"GitHub answered with success, an owner is configured, and the account is the owner's",
				(g) => g.ok && Boolean(g.ownerId) && g.id === g.ownerId,
			),
			refuse,
		),
	],
	writes: (g) => g.id ?? "",
	writesText: "the owner's id, for the grant",
});
