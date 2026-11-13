import { EffectFailure } from "@xstate/effect";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { describe, expect, it } from "vitest";
import { failureOf } from "../../src/server/machines/failure";

class Refused extends Data.TaggedError("Refused") {}

describe("failureOf", () => {
	it("gives the typed failure a Cause carries", () => {
		const refused = new Refused();

		expect(failureOf({ error: new EffectFailure(Cause.fail(refused)) })).toBe(
			refused,
		);
	});

	it("throws a defect, a typed failure with a defect beside it, and an interruption", () => {
		const bug = new Error("bug");

		expect(() =>
			failureOf({ error: new EffectFailure(Cause.die(bug)) }),
		).toThrow("bug");
		expect(() =>
			failureOf({
				error: new EffectFailure(
					Cause.combine(Cause.fail(new Refused()), Cause.die(bug)),
				),
			}),
		).toThrow("bug");
		expect(() =>
			failureOf({ error: new EffectFailure(Cause.interrupt()) }),
		).toThrow();
	});

	it("throws an error the bridge did not wrap, and a failure that is not tagged", () => {
		expect(() => failureOf({ error: new Error("plain") })).toThrow("plain");
		expect(() =>
			failureOf({ error: new EffectFailure(Cause.fail("untagged")) }),
		).toThrow();
	});
});
