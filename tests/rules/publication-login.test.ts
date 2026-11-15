import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	namesResource,
	returnFromGithub,
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

	it.each(["incorrect_client_credentials", "redirect_uri_mismatch"])(
		"names %s the site's own fault",
		(error) => {
			expect(
				refused(tokenGiven.decide({ ok: true, error, token: undefined }, {}))
					?._tag,
			).toBe("GithubAppMisconfigured");
		},
	);

	it.each([
		"bad_verification_code",
		"application_suspended",
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

describe("GitHub's callback", () => {
	const approved = { approved: true, nonce: "n", code: null, state: "n" };

	it.each(["application_suspended", "redirect_uri_mismatch"])(
		"names %s, for an approved sign-in, the site's own fault",
		(error) => {
			expect(
				refused(returnFromGithub.decide({ ...approved, error }, {}))?._tag,
			).toBe("GithubAppMisconfigured");
		},
	);

	it.each(["access_denied", "a_code_nobody_documented"])(
		"refuses %s as the visitor's",
		(error) => {
			expect(
				refused(returnFromGithub.decide({ ...approved, error }, {}))?._tag,
			).toBe("LoginRefused");
		},
	);

	it("refuses a configuration error on a callback that is not this sign-in's as the visitor's", () => {
		const error = "application_suspended";

		expect(
			refused(
				returnFromGithub.decide({ ...approved, state: "other", error }, {}),
			)?._tag,
		).toBe("LoginRefused");
		expect(
			refused(
				returnFromGithub.decide({ ...approved, approved: false, error }, {}),
			)?._tag,
		).toBe("LoginRefused");
	});

	it("takes a code of an approved sign-in with no error", () => {
		expect(
			refused(
				returnFromGithub.decide({ ...approved, code: "c", error: null }, {}),
			),
		).toBeNull();
	});
});
