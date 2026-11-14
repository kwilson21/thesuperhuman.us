// Who may use which project. Two decisions over settings and a caller, both pure: a project is on the site's allowlist
// (the comma-separated PUBLICATION_PROJECTS setting), and a signed-in connection may read or publish a project (it is the
// owner, it holds the project's scope, and the project is on the allowlist now, not only when its token was issued).
// Nothing is read or written, so no write-time guard applies.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** The project is not on the allowlist. */
export class ProjectUnavailable extends Data.TaggedError("ProjectUnavailable") {
	readonly say = "Project unavailable.";
}

/** The connection may not use the project. */
export class ProjectForbidden extends Data.TaggedError("ProjectForbidden") {
	readonly say = "forbidden";
}

/** The projects a setting lists: its items, trimmed, with empty items dropped. */
export const listedProjects = (setting: string | undefined): string[] =>
	(setting ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

/** The scope a connection holds for a project. */
export const scopeFor = (project: string) => `publication:${project}`;

type AllowProjectRequest = {
	readonly allowlist: string | undefined;
	readonly project: string;
};

export const allowProject = alwaysWrites({
	name: "Allow a project on the public allowlist",
	given: (request: AllowProjectRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<AllowProjectRequest>("the project is on the allowlist", (g) =>
				listedProjects(g.allowlist).includes(g.project),
			),
			() => new ProjectUnavailable(),
		),
	],
	writes: (g) => g.project,
	writesText: "the project, unchanged",
});

/** A connection as the OAuth library hands it to the MCP handler. */
export type Connection = {
	readonly ownerId: string;
	readonly scopes: readonly string[];
};

type AllowConnectionRequest = {
	readonly ownerId: string | undefined;
	readonly allowlist: string | undefined;
	readonly connection: Connection;
	readonly project: string;
};

export const allowConnection = alwaysWrites({
	name: "Allow a connection to use a project",
	given: (request: AllowConnectionRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<AllowConnectionRequest>(
				"the connection is the owner, holds the project's scope, and the project is on the allowlist",
				(g) =>
					Boolean(g.ownerId) &&
					g.connection.ownerId === g.ownerId &&
					g.connection.scopes.includes(scopeFor(g.project)) &&
					(g.allowlist ?? "")
						.split(",")
						.map((item) => item.trim())
						.includes(g.project),
			),
			() => new ProjectForbidden(),
		),
	],
	writes: (g) => g.project,
	writesText: "the project, unchanged",
});

/** The connection an access token carries must be the configured owner's. */
export const signedInOwner = (
	connection: Connection,
	ownerId: string | undefined,
): boolean => connection.ownerId === ownerId;

type NarrowScopesRequest = {
	readonly requested: readonly string[];
	readonly granted: readonly string[];
	readonly supported: readonly string[];
};

/** A refresh may narrow the grant and never widen it: only scopes that were requested, were granted, and are still supported. */
export const narrowScopes = alwaysWrites({
	name: "Narrow the scopes a refreshed token carries",
	given: (request: NarrowScopesRequest, _facts: Record<string, never>) =>
		request,
	refusals: [],
	writes: (g) =>
		g.requested.filter(
			(scope) => g.granted.includes(scope) && g.supported.includes(scope),
		),
	writesText: "the scopes the new access token carries",
});
