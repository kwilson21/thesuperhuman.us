// Runs a route's program with the request's own services (kwilson21/tally `runWith` in `src/db/database.ts`, and
// `src/routes/push.ts` for how a route maps its refusals). A route maps every refusal its rules and services can make to
// a Response with `Effect.catchTags`; the program's error type must then be `never`, so a refusal left unmapped fails the
// type check. A defect (a failed save that is not a guard, a bug) rejects, and Astro answers 500 as it does today.
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** A route's program: every refusal already mapped to a Response, needing only the services it names. */
export type RouteProgram<Services> = Effect.Effect<Response, never, Services>;

/**
 * Runs the program with the services `bindingsOrUnavailable` gave the route (a route calls that first, and answers a
 * missing binding itself), and answers its Response.
 */
export const runRoute = <Services>(
	services: Context.Context<Services>,
	program: RouteProgram<Services>,
): Promise<Response> =>
	Effect.runPromise(program.pipe(Effect.provideContext(services)));
