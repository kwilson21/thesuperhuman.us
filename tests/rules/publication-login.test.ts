import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	namesResource,
	resourceOf,
	tokenGiven,
} from "../../src/server/rules/publication-login";

const refused = <A, E>(answer: Effect.Effect<A, E>) =>
	Effect.runSync(
		Effect.match(answer, { onFailure: (e) => e, onSuccess: () => null }),
	);

describe("GitHub's answer to the code exchange", () => {
	it("takes an access token that came with no error", () => {
		expect(
			refused(
				tokenGiven.decide({ ok: true, error: undefined, token: "t" }, {}),
			),
		).toBeNull();
	});

	it.each([
		"incorrect_client_credentials",
		"redirect_uri_mismatch",
		"application_suspended",
	])("names %s the site's own fault", (error) => {
		expect(
			refused(tokenGiven.decide({ ok: true, error, token: undefined }, {}))
				?._tag,
		).toBe("GithubAppMisconfigured");
	});

	it.each([
		"bad_verification_code",
		"unverified_user_email",
		"a_code_nobody_documented",
	])("refuses %s as the visitor's", (error) => {
		expect(
			refused(tokenGiven.decide({ ok: true, error, token: undefined }, {}))
				?._tag,
		).toBe("LoginRefused");
	});

	it("refuses an answer with no token", () => {
		expect(
			refused(
				tokenGiven.decide({ ok: true, error: undefined, token: undefined }, {}),
			)?._tag,
		).toBe("LoginRefused");
	});
});

describe("the resource an authorization request names", () => {
	const resource = "https://example.test/mcp";

	it.each<[string, string | readonly string[] | undefined, boolean]>([
		["the string itself", resource, true],
		["a one-element array holding it", [resource], true],
		["a two-element array", [resource, resource], false],
		["a one-element array holding another value", ["other"], false],
		["an empty array", [], false],
		["another string", "other", false],
		["nothing", undefined, false],
	])("%s", (_name, asked, wanted) => {
		expect(namesResource(asked, resource)).toBe(wanted);
	});

	it("reads the one resource of a string or a one-element array", () => {
		expect(resourceOf(resource)).toBe(resource);
		expect(resourceOf([resource])).toBe(resource);
		expect(resourceOf(undefined)).toBeUndefined();
	});
});
