import type { APIContext } from "astro";
import { partial } from "./doubles";

/** The runtime an Astro route reads from locals in these tests. */
export type TestRuntime = APIContext["locals"]["runtime"];

/**
 * A runtime with the env bindings the test supplies. A binding the test leaves out is absent, and a route that reads it
 * fails the way the test expects.
 */
export function testRuntime(env: Partial<TestRuntime["env"]>): TestRuntime {
	return partial<TestRuntime>({ env: partial<TestRuntime["env"]>(env) });
}

/**
 * Locals for an Astro container render: a runtime whose env has the members the test supplies,
 * and the owner when the test signs one in. The code under test reads only these members.
 */
export function fakeLocals(
	env: Partial<Env>,
	owner?: { email: string },
): App.Locals {
	return partial<App.Locals>({ owner, runtime: testRuntime(env) });
}
