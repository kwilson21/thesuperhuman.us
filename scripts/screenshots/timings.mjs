// Measures where a screenshot run spends its time. Each scope (a scenario, or `pages`) has phases
// (seconds per kind of work), counts (how often something happened) and optionally a wall time.
// Importing this module has no side effects.

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** A recorder with the injected clock `now` (milliseconds). Pass a fake clock in tests. */
export function createTimings(now = () => performance.now()) {
	const scopes = new Map();

	function scopeFor(name) {
		if (!scopes.has(name))
			scopes.set(name, {
				phases: new Map(),
				counts: new Map(),
				wall: undefined,
				concurrency: 1,
			});

		return scopes.get(name);
	}

	/** Adds `ms` to a phase of a scope. Use it when start and stop can't wrap a function. */
	function add(scope, phase, ms) {
		const { phases } = scopeFor(scope);
		phases.set(phase, (phases.get(phase) ?? 0) + ms);
	}

	function count(scope, name) {
		const { counts } = scopeFor(scope);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	/** Awaits `fn`, adds the elapsed time to the phase (also when it throws), and returns its result. */
	async function time(scope, phase, fn) {
		const started = now();

		try {
			return await fn();
		} finally {
			add(scope, phase, now() - started);
		}
	}

	/**
	 * Awaits `fn` and records its wall time for the scope. `concurrency` above 1 means the scope ran
	 * that many things at once, so its phases can add up to more than its wall time.
	 */
	async function wall(scope, fn, concurrency = 1) {
		const started = now();
		const entry = scopeFor(scope);
		entry.concurrency = concurrency;

		try {
			return await fn();
		} finally {
			entry.wall = (entry.wall ?? 0) + (now() - started);
		}
	}

	/**
	 * One `Timing` line per scope in first-seen order, then a total line. The total is each scope's
	 * wall time (or its phases, when it has none), and the total phases add up every scope's phases.
	 */
	function summary() {
		if (scopes.size === 0) return [];

		const lines = [];
		const totalPhases = new Map();
		let totalMs = 0;

		for (const [name, entry] of scopes) {
			const phases = new Map(entry.phases);
			const phaseMs = [...phases.values()].reduce((sum, ms) => sum + ms, 0);
			const parallel = entry.concurrency > 1;

			if (entry.wall !== undefined && !parallel)
				phases.set("other", Math.max(0, entry.wall - phaseMs));

			const scopeMs = entry.wall ?? phaseMs;
			totalMs += scopeMs;

			for (const [phase, ms] of phases)
				totalPhases.set(phase, (totalPhases.get(phase) ?? 0) + ms);

			lines.push(
				line(name, scopeMs, {
					note: parallel ? ` (${entry.concurrency} at once)` : "",
					counts: entry.counts,
					phases,
				}),
			);
		}

		lines.push(line("total", totalMs, { phases: totalPhases }));

		return lines;
	}

	return { now, add, count, time, wall, summary };
}

function line(name, ms, { note = "", counts = new Map(), phases }) {
	const countText = [...counts].map(([label, n]) => `${n} ${label}`);

	const phaseText = [...phases]
		.sort((a, b) => b[1] - a[1])
		.map(([phase, value]) => `${phase} ${seconds(value)}`);

	return [
		`Timing ${name}: ${seconds(ms)}${note}`,
		countText.length ? `, ${countText.join(", ")}` : "",
		phaseText.length ? `. ${phaseText.join(", ")}` : "",
	].join("");
}
