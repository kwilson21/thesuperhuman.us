// The scheduled handler's work (docs/plans/2026-11-market-refresh.md, section 2): the daily market refresh, with the
// live search (the owner's Tavily key) and reader (the AI binding). It never rejects, since no one is waiting for an
// answer: a store failure is mapped by name and logged with a fixed line, and a defect (a bug) is logged once through
// `logUnexpected`, as `runRoute` does for a route.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { logUnexpected } from "./failure";
import { type RefreshOutcome, refreshMarket } from "./flows/market-refresh";
import { liveMarketReader, liveMarketSearch } from "./market-refresh-services";
import { bindingsOrUnavailable } from "./services";

const ROUTE = "scheduled market refresh";

/** How a run ended, for its one log line: the flow's outcome, the store failing, or a defect already logged. */
type Ended = RefreshOutcome | "store failed" | "defect";

export async function runScheduledRefresh(env: Env, now: string) {
	const bindings = bindingsOrUnavailable(env, ["RESUME_STORE"]);

	if (!bindings.ok || !env.AI) {
		console.error(`${ROUTE}: the store or the AI binding is not set.`);

		return;
	}

	const key = env.TAVILY_API_KEY ?? "";

	const services = Context.merge(
		Context.merge(bindings.services, liveMarketSearch(key)),
		liveMarketReader(env.AI),
	);

	const program: Effect.Effect<Ended> = refreshMarket({
		now,
		hasKey: key !== "",
	}).pipe(
		Effect.catchTags({
			MarketRefreshStoreFailed: () => Effect.succeed<Ended>("store failed"),
			PricingStoreFailed: () => Effect.succeed<Ended>("store failed"),
		}),
		Effect.catchDefect((defect) =>
			Effect.sync((): Ended => {
				logUnexpected(ROUTE, defect);

				return "defect";
			}),
		),
		Effect.provideContext(services),
	);

	const ended = await Effect.runPromise(program);

	if (ended === "store failed")
		console.error(
			`${ROUTE}: the store failed; the next daily check tries again.`,
		);
	else if (ended !== "idle" && ended !== "defect")
		console.info(`${ROUTE}: ${ended}.`);
}

/** The Worker's scheduled handler (src/worker.ts): the refresh at the cron's time, kept running past the handler's return. */
export const onScheduled =
	(refresh: typeof runScheduledRefresh = runScheduledRefresh) =>
	(controller: ScheduledController, env: Env, context: ExecutionContext) => {
		context.waitUntil(
			refresh(env, new Date(controller.scheduledTime).toISOString()),
		);
	};
