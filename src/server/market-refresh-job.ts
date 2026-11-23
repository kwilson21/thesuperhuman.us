// The scheduled handler's work (docs/plans/2026-11-market-refresh.md, section 2): the daily market refresh, with the
// live search (the owner's Tavily key) and reader (the AI binding). It never rejects: whatever happens is logged once
// with a fixed line, since no one is waiting for an answer.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { logUnexpected } from "./failure";
import { refreshMarket } from "./flows/market-refresh";
import { liveMarketReader, liveMarketSearch } from "./market-refresh-services";
import { bindingsOrUnavailable } from "./services";

const ROUTE = "scheduled market refresh";

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

	try {
		const outcome = await Effect.runPromise(
			refreshMarket({ now, hasKey: key !== "" }).pipe(
				Effect.provideContext(services),
			),
		);

		if (outcome !== "idle") console.info(`${ROUTE}: ${outcome}.`);
	} catch (failure) {
		logUnexpected(ROUTE, failure);
	}
}
