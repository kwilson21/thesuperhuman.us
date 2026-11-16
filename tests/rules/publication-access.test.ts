import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	allowConnection,
	allowProject,
	listedProjects,
	narrowScopes,
	scopeFor,
} from "../../src/server/rules/publication-access";
import {
	presentsBearer,
	sameDigest,
} from "../../src/server/rules/publication-token";

const refused = <A, E>(answer: Effect.Effect<A, E>) =>
	Effect.runSync(
		Effect.match(answer, { onFailure: (e) => e, onSuccess: () => null }),
	);

const connection = { ownerId: "1", scopes: [scopeFor("threadline")] };

describe("who may use which project", () => {
	it("reads the allowlist with spaces and empty items", () => {
		expect(listedProjects(" a, ,b ,,")).toEqual(["a", "b"]);
		expect(listedProjects(undefined)).toEqual([]);
	});

	it("allows a listed project only", () => {
		expect(
			refused(allowProject.decide({ allowlist: "a,b", project: "b" }, {})),
		).toBeNull();
		expect(
			refused(allowProject.decide({ allowlist: "a,b", project: "c" }, {}))
				?._tag,
		).toBe("ProjectUnavailable");
		expect(
			refused(allowProject.decide({ allowlist: "", project: "" }, {}))?._tag,
		).toBe("ProjectUnavailable");
	});

	it("allows a connection that is the owner, holds the scope, and whose project is listed now", () => {
		const ask = (
			over: Partial<{ ownerId: string | undefined; allowlist: string }>,
			project = "threadline",
		) =>
			refused(
				allowConnection.decide(
					{
						ownerId: "1",
						allowlist: "threadline",
						connection,
						project,
						...over,
					},
					{},
				),
			);

		expect(ask({})).toBeNull();
		expect(ask({ ownerId: "2" })?._tag).toBe("ProjectForbidden");
		expect(ask({ ownerId: undefined })?._tag).toBe("ProjectForbidden");
		expect(ask({ allowlist: "" })?._tag).toBe("ProjectForbidden");
		expect(ask({ allowlist: "threadline,other" }, "other")?._tag).toBe(
			"ProjectForbidden",
		);
	});

	it("a refresh narrows a grant and never widens it", () => {
		const narrowed = Effect.runSync(
			narrowScopes.decide(
				{
					requested: ["publication:a", "publication:b", "publication:c"],
					granted: ["publication:a", "publication:b"],
					supported: ["publication:a", "publication:c"],
				},
				{},
			),
		);

		expect(narrowed).toEqual(["publication:a"]);
	});
});

describe("the work feed's bearer token", () => {
	const ask = (configured: string | undefined, header: string | null) =>
		refused(presentsBearer.decide({ configured, header }, {}));

	it("needs a configured token and a Bearer header within 4096 characters", () => {
		expect(ask("t", "Bearer t")).toBeNull();
		expect(ask(undefined, "Bearer t")?._tag).toBe("Unauthorized");
		expect(ask("", "Bearer t")?._tag).toBe("Unauthorized");
		expect(ask("t", null)?._tag).toBe("Unauthorized");
		expect(ask("t", "bearer t")?._tag).toBe("Unauthorized");
		expect(ask("t", "Bearer " + "a".repeat(4090))?._tag).toBe("Unauthorized");
		expect(ask("t", "Bearer " + "a".repeat(4089))).toBeNull();
	});

	it("compares every byte of the digests", () => {
		const same = (a: number[], b: number[]) =>
			refused(
				sameDigest.decide(
					{ presented: Uint8Array.from(a), configured: Uint8Array.from(b) },
					{},
				),
			);

		expect(same([1, 2, 3], [1, 2, 3])).toBeNull();
		expect(same([1, 2, 3], [1, 2, 4])?._tag).toBe("Unauthorized");
		expect(same([1, 2], [1, 2, 3])?._tag).toBe("Unauthorized");
	});
});
