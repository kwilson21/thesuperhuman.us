// Runs a route's program with the request's own services (kwilson21/tally `runWith` in `src/db/database.ts`, and
// `src/routes/push.ts` for how a route maps its refusals). A route maps every refusal its rules and services can make to
// a Response with `Effect.catchTags`; the program's error type must then be `never`, so a refusal left unmapped fails the
// type check. A defect (a failed save that is not a guard, a bug) rejects, and Astro answers 500 as it does today.
import * as Effect from "effect/Effect";
import { type BindingServices, liveServices } from "./services";

/** A route's program: every refusal already mapped to a Response, needing only the bindings. */
export type RouteProgram = Effect.Effect<Response, never, BindingServices>;

/** Provides the live services from `locals.runtime.env` and runs the program to its Response. */
export const runRoute = (
	locals: App.Locals,
	program: RouteProgram,
): Promise<Response> =>
	Effect.runPromise(
		program.pipe(Effect.provideContext(liveServices(locals.runtime.env))),
	);
