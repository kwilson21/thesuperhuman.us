// The step a screenshot scenario is at, and the moves that set both clocks to it. capture.mjs builds one stepper:
// `setLocal` sets this process's clock, and `setServer` posts the step to the dev server (see clock.mjs and
// clock-endpoint.mjs). Nothing here reads the environment, so the rules can be tested with fake setters.

/**
 * Returns `{ step, reset, next, nextLocal }`.
 * - `reset()` sets step 0 on both clocks.
 * - `next()` moves one step on and sets both clocks. Two overlapping `next` or `reset` calls throw.
 * - `nextLocal()` moves one step on and sets only the local clock. It is synchronous, so `sql` can use it.
 * - `step()` returns the step the stepper is at.
 * Every move throws past `maxMs` of pinned time, and `next` or `reset` throws when the server's answer does not echo
 * the instant it was sent.
 */
export function createStepper({ setLocal, setServer, stepTime, maxMs }) {
	let step = 0;
	let inFlight = false;

	const checkInFlight = () => {
		if (inFlight)
			throw new Error(
				"Scenario steps (capture, ownerFetch) must be awaited one at a time: a step started before the previous one finished.",
			);
	};

	const checkLimit = (target) => {
		if (stepTime(target) - stepTime(0) > maxMs)
			throw new Error(
				`A scenario has too many steps for the owner token: step ${target} is past ${maxMs / 60_000} minutes of pinned time. Raise setExpirationTime("1h") in capture.mjs.`,
			);
	};

	// Sets both clocks to `target`. The local clock moves first, then the server is asked and must echo the instant.
	async function moveTo(target) {
		step = target;
		checkLimit(target);

		const now = stepTime(target);
		setLocal(now);

		const answer = await setServer(now);

		if (answer?.ok !== true || answer.now !== now)
			throw new Error(
				"No clock update at /__screenshots/clock: start the dev server with --config scripts/screenshots/dev.config.mjs.",
			);
	}

	// Runs one two-clock move, holding the in-flight flag until the server has answered or refused.
	async function moveBoth(target) {
		checkInFlight();
		inFlight = true;

		try {
			await moveTo(target);
		} finally {
			inFlight = false;
		}
	}

	return {
		step: () => step,

		reset: () => moveBoth(0),

		next: () => moveBoth(step + 1),

		nextLocal() {
			step += 1;
			checkLimit(step);
			setLocal(stepTime(step));
		},
	};
}
