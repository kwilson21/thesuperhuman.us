// Runs a route's program with the request's own services (kwilson21/tally `runWith` in `src/db/database.ts`, and
// `src/routes/push.ts` for how a route maps its refusals). A route maps every refusal its rules and services can make to
// a Response with `Effect.catchTags`; the program's error type must then be `never`, so a refusal left unmapped fails the
// type check. A defect (a failed save that is not a guard, a bug) rejects, and Astro answers 500 as it does today.
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { logUnexpected } from "./failure";

/** A route's program: every refusal already mapped to a Response, needing only the services it names. */
export type RouteProgram<Services> = Effect.Effect<Response, never, Services>;

/**
 * What a route says when its program dies with a defect (a bug, or a call that was never meant to fail and did): the route's
 * name for the log, and the answer it gives. A route that gives none keeps the old behaviour: the defect rejects and Astro
 * answers 500, which is what the contact and resume routes do and their golden corpus holds them to.
 */
export type DefectAnswer = {
	readonly route: string;
	readonly answer: () => Response;
};

/**
 * Runs the program with the services `bindingsOrUnavailable` gave the route (a route calls that first, and answers a
 * missing binding itself), and answers its Response. With a `DefectAnswer`, a defect is logged once, through
 * `logUnexpected` (which never logs a message that can quote what was sent), and answered with the route's own Response,
 * so a converted route never lets a raw error reach the visitor or the log.
 */
export const runRoute = <Services>(
	services: Context.Context<Services>,
	program: RouteProgram<Services>,
	onDefect?: DefectAnswer,
): Promise<Response> =>
	Effect.runPromise(
		(onDefect
			? program.pipe(
					Effect.catchDefect((defect) =>
						Effect.sync(() => {
							logUnexpected(onDefect.route, defect);

							return onDefect.answer();
						}),
					),
				)
			: program
		).pipe(Effect.provideContext(services)),
	);
