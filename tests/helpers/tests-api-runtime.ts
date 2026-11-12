import type { APIContext } from "astro";
import { double } from "./doubles";

/** The runtime an Astro route reads from locals in these tests. */
export type TestRuntime = APIContext["locals"]["runtime"];

/**
 * A runtime with the env bindings the test supplies. A binding the test leaves out is absent, and a route that reads it
 * fails the way the test expects.
 */
export function testRuntime(env: Partial<TestRuntime["env"]>): TestRuntime {
	return double<TestRuntime>({ env: double<TestRuntime["env"]>(env) });
}
