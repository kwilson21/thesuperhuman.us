// The publication sign-in as three flows, one per step the visitor takes, in the order the old handler did them (the clock,
// the random values and the outside calls are made in that order, and thunks are passed in so a test can fix them):
//   showConsent     parse the authorization request, check it, look the client up, seal a new state, build the page
//   approveConsent  take the form only from this site, open the state, check the nonce, seal it approved, go to GitHub
//   finishSignIn    open the state, check the callback, exchange the code, ask who signed in, grant only the owner
// A flow builds no response text; a refusal is a LoginRefused, and the site's own faults are named failures.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
	consentHtml,
	consentPolicy,
	consentStyle,
	publicationBase,
	publicationOrigin,
	publicationResource,
	type LoginEnv,
} from "../../lib/publication/oauth-login";
import { sha256 } from "../digest";
import { BodyUnreadable } from "../bounded-body";
import { LoginRefused, resourceOf } from "../rules/publication-login";
import { encode, seal, unseal, type LoginState } from "../publication-cookie";
import { GithubSignIn, OAuthGrants } from "../publication-services";
import { listedProjects, scopeFor } from "../rules/publication-access";
import {
	approveConsent as approvesConsent,
	ownerSignedIn,
	registeredClient,
	returnFromGithub,
	sameSiteConsent,
	showConsent as showsConsent,
	tokenGiven,
} from "../rules/publication-login";

/** What a sign-in flow reads from the world: the clock and a source of random text, called in the old order. */
export type LoginWorld = {
	readonly now: () => number;
	readonly random: () => string;
};

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export const showConsent = (
	request: Request,
	env: LoginEnv,
	world: LoginWorld,
) =>
	Effect.gen(function* () {
		const grants = yield* OAuthGrants;
		const auth = yield* grants.parse(request);

		const supported = listedProjects(env.PUBLICATION_PROJECTS).map(scopeFor);

		yield* showsConsent.decide(
			{ auth, supported, resource: publicationResource },
			{},
		);

		const client = yield* grants.lookupClient(auth.clientId);

		const name = yield* registeredClient.decide(
			{ clientId: auth.clientId, client },
			{},
		);

		const state: LoginState = {
			request: auth,
			nonce: world.random(),
			verifier: world.random(),
			expires: world.now() + 600000,
			approved: false,
		};

		const cookie = yield* seal(state, env.PUBLICATION_COOKIE_KEY);
		const returnOrigin = new URL(auth.redirectUri).origin;

		const styleHash = base64(yield* sha256(consentStyle));

		return {
			html: consentHtml(
				name,
				auth.scope.map((s) => s.slice(12)),
				returnOrigin,
				state.nonce,
			),
			cookie,
			policy: consentPolicy(styleHash, returnOrigin),
		};
	});

export const approveConsent = (
	request: Request,
	env: LoginEnv,
	world: LoginWorld,
) =>
	Effect.gen(function* () {
		yield* sameSiteConsent.decide(
			{ origin: request.headers.get("origin"), site: publicationOrigin },
			{},
		);

		const state = yield* unseal(
			request.headers.get("cookie"),
			env.PUBLICATION_COOKIE_KEY,
			world.now,
		);

		const body = new URLSearchParams(
			yield* Effect.tryPromise({
				try: () => request.text(),
				catch: () => new BodyUnreadable(),
			}),
		);

		yield* approvesConsent.decide(
			{
				approved: state.approved,
				nonce: state.nonce,
				posted: body.get("nonce"),
			},
			{},
		);

		const challenge = encode(yield* sha256(state.verifier));
		const github = new URL("https://github.com/login/oauth/authorize");

		github.search = new URLSearchParams({
			client_id: env.PUBLICATION_GITHUB_CLIENT_ID,
			redirect_uri: publicationOrigin + publicationBase + "/callback",
			state: state.nonce,
			scope: "",
			code_challenge: challenge,
			code_challenge_method: "S256",
			allow_signup: "false",
		}).toString();

		const cookie = yield* seal(
			{ ...state, approved: true },
			env.PUBLICATION_COOKIE_KEY,
		);

		return { location: github.href, cookie };
	});

const tokenReply = Schema.decodeUnknownResult(
	Schema.Struct({
		access_token: Schema.optional(Schema.String),
		error: Schema.optional(Schema.Unknown),
	}),
);

const userReply = Schema.decodeUnknownResult(
	Schema.Struct({
		id: Schema.optional(Schema.Unknown),
	}),
);

export const finishSignIn = (
	request: Request,
	env: LoginEnv,
	world: LoginWorld,
) =>
	Effect.gen(function* () {
		const url = new URL(request.url);

		const state = yield* unseal(
			request.headers.get("cookie"),
			env.PUBLICATION_COOKIE_KEY,
			world.now,
		);

		const code = yield* returnFromGithub.decide(
			{
				approved: state.approved,
				nonce: state.nonce,
				code: url.searchParams.get("code"),
				state: url.searchParams.get("state"),
			},
			{},
		);

		const github = yield* GithubSignIn;

		const exchange = yield* github.exchange(
			new URLSearchParams({
				client_id: env.PUBLICATION_GITHUB_CLIENT_ID,
				client_secret: env.PUBLICATION_GITHUB_CLIENT_SECRET,
				code,
				redirect_uri: publicationOrigin + publicationBase + "/callback",
				code_verifier: state.verifier,
			}),
		);

		const token = tokenReply(exchange.body);

		if (!Result.isSuccess(token)) return yield* Effect.fail(new LoginRefused());

		const accessToken = yield* tokenGiven.decide(
			{
				ok: exchange.ok,
				error: token.success.error,
				token: token.success.access_token,
			},
			{},
		);

		const lookup = yield* github.user(accessToken);
		const user = userReply(lookup.body);

		if (!Result.isSuccess(user)) return yield* Effect.fail(new LoginRefused());

		const ownerId = yield* ownerSignedIn.decide(
			{
				ok: lookup.ok,
				id: String(user.success.id),
				ownerId: env.PUBLICATION_OWNER_ID,
			},
			{},
		);

		const grants = yield* OAuthGrants;

		const granted = yield* grants.complete({
			request: {
				...state.request,
				resource: resourceOf(state.request.resource),
			},
			userId: ownerId,
			scope: state.request.scope,
			metadata: {},
			props: { ownerId, scopes: state.request.scope },
		});

		return granted.redirectTo;
	});
