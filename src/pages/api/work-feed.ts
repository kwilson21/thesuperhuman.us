import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { readFeed } from "~/server/flows/publication-feed";
import { authorizeFeed, receivePublication } from "~/server/flows/work-feed";
import { allowProject } from "~/server/rules/publication-access";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;
const headers = { "cache-control": "no-store" };

const reply = <T>(body: T, status = 200) =>
	Response.json(body, { status, headers });

const updatesUnavailable = () => reply({ error: "Updates unavailable." }, 500);

const deliveryFailed = () =>
	reply({ error: "Delivery pending. Retry the same event." }, 500);

const notListed = () => reply({ error: "Project unavailable." }, 404);

export const GET: APIRoute = async ({ locals, url }) => {
	const env = locals.runtime.env;
	const project = url.searchParams.get("project") ?? "";
	const bindings = bindingsOrUnavailable(env, ["PUBLICATION_DB"]);

	const listed = allowProject.decide(
		{ allowlist: env.PUBLICATION_PROJECTS, project },
		{},
	);

	const route = { route: "/api/work-feed", answer: updatesUnavailable };

	// The allowlist is answered first, so an unlisted project is a 404 even when the database is not bound.
	if (!bindings.ok)
		return runRoute(
			Context.empty(),
			listed.pipe(
				Effect.map(() => reply({ error: "Updates unavailable." }, 503)),
				Effect.catchTags({
					ProjectUnavailable: () => Effect.succeed(notListed()),
				}),
			),
			route,
		);

	return runRoute(
		bindings.services,
		listed.pipe(
			Effect.flatMap(() => readFeed(project)),
			Effect.map((feed) => reply(feed)),
			Effect.catchTags({
				ProjectUnavailable: () => Effect.succeed(notListed()),
				PublicationStoreFailed: () => Effect.succeed(updatesUnavailable()),
				StoredPublicationInvalid: () => Effect.succeed(updatesUnavailable()),
			}),
		),
		route,
	);
};

export const POST: APIRoute = async ({ locals, request }) => {
	const env = locals.runtime.env;
	const bindings = bindingsOrUnavailable(env, ["PUBLICATION_DB"]);

	const authorized = authorizeFeed(
		request.headers.get("authorization"),
		env.PUBLICATION_TOKEN,
	);

	const route = { route: "/api/work-feed", answer: deliveryFailed };
	const unauthorized = () => reply({ error: "Unauthorized." }, 401);

	// The token is checked first, so a caller without it learns nothing about the database.
	if (!bindings.ok)
		return runRoute(
			Context.empty(),
			authorized.pipe(
				Effect.map(() => reply({ error: "Delivery unavailable." }, 503)),
				Effect.catchTags({
					Unauthorized: () => Effect.succeed(unauthorized()),
				}),
			),
			route,
		);

	return runRoute(
		bindings.services,
		authorized.pipe(
			Effect.flatMap(() =>
				receivePublication(request.body, env.PUBLICATION_PROJECTS),
			),
			Effect.map((result) => reply(result)),
			Effect.catchTags({
				Unauthorized: () => Effect.succeed(unauthorized()),
				MissingPublication: () =>
					Effect.succeed(reply({ error: "Missing publication." }, 400)),
				BodyTooLarge: () =>
					Effect.succeed(reply({ error: "Publication too large." }, 413)),
				InvalidPublication: () =>
					Effect.succeed(reply({ error: "Invalid publication." }, 400)),
				ProjectUnavailable: () =>
					Effect.succeed(reply({ error: "Project unavailable." }, 403)),
				PublicationRejected: () =>
					Effect.succeed(reply({ status: "rejected" }, 400)),
				PublicationConflict: () =>
					Effect.succeed(reply({ status: "conflict" }, 409)),
				SaveKeptChanging: () =>
					Effect.succeed(reply({ status: "conflict" }, 409)),
				PublicationWithdrawn: () =>
					Effect.succeed(reply({ status: "withdrawn" }, 410)),
				PublicationStoreFailed: () => Effect.succeed(deliveryFailed()),
			}),
		),
		route,
	);
};
