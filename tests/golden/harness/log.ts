// The ordered effect log of one case, and the entries in it.
import type { ByteRecord, Recorded } from "./plain";

/**
 * Whether the response waited for an effect. "request": the answer (its status, headers and the whole body) could not
 * have been produced without the effect finishing, or the effect cannot be told apart from work the answer waited for.
 * "background": the answer was produced and read while the effect had not yet begun (work handed to ctx.waitUntil, or
 * left floating). It is decided by what the answer waited for (see `start` below), never by how many microtask turns a
 * route takes.
 */
export type Phase = "request" | "background";

/** What a statement or call gave back that a caller can see: how many rows, how many changes, or that it threw. */
export type D1Outcome = { rows: number; changes: number } | { threw: string };

export type D1Statement = {
	sql: string;
	args: Recorded[];
	outcome: D1Outcome;
};

export type EffectBody =
	| {
			kind: "d1";
			db: string;
			via: "first" | "all" | "run";
			sql: string;
			args: Recorded[];
			outcome: D1Outcome;
	  }
	| {
			kind: "d1-batch";
			db: string;
			/** `committed`, `rolled-back` (a statement threw), or `injected-failure` (the case made it fail unrun). */
			result: "committed" | "rolled-back" | "injected-failure";
			error: string | null;
			statements: D1Statement[];
	  }
	| {
			kind: "interleave";
			label: string;
	  }
	/**
	 * Which statement an injected failure or an interleave hit: the operation, the table and whether it reads or writes,
	 * never the SQL text, the pattern or `nth`, which a conversion legitimately edits. The hook fires before the statement
	 * runs (an injected failure never runs it), so whether a write changed a row is not known here.
	 */
	| {
			kind: "trigger-hit";
			trigger: "failure" | "interleave";
			/** The failure's message or the interleave's label. */
			name: string;
			db: string;
			hits: { op: string; table: string | null; access: "read" | "write" }[];
	  }
	| {
			kind: "r2";
			bucket: string;
			op: string;
			key: string | null;
			detail: Recorded;
	  }
	| {
			kind: "kv";
			namespace: string;
			op: "get" | "put" | "delete" | "list";
			key: string | null;
			detail: Recorded;
	  }
	| {
			kind: "fetch";
			host: string;
			url: string;
			method: string;
			headers: Record<string, string>;
			body: string | ByteRecord | null;
			hasSignal: boolean;
			answered: string;
	  }
	| { kind: "ai"; model: string; input: Recorded; options: Recorded }
	| { kind: "rate-limit"; binding: string; key: string; success: boolean }
	/** A call the script had no answer for: the binding failed (an outage), which is not a refusal. */
	| { kind: "rate-limit"; binding: string; key: string; threw: string }
	| { kind: "waitUntil"; id: number }
	| {
			kind: "waitUntil-settled";
			id: number;
			outcome: "fulfilled" | "rejected";
			error: string | null;
	  }
	| { kind: "advance"; ms: number }
	| { kind: "console"; level: "error" | "warn"; args: Recorded[] };

/** The databases as they were at one moment (see digest.ts): one digest each. */
export type DatabaseStates = { music: string; publication: string };

/**
 * The state of the databases when an outside effect happened, or when the response had been read: the two digests, and
 * the names of the tables that committed row-changing writes had touched so far in the step (names only: no operation,
 * no count). The digests cannot see a same-value UPDATE, or a row inserted and deleted again; the table set can, and it
 * is the same for a statement rewritten as a DELETE and an INSERT of the same table.
 */
export type EffectState = DatabaseStates & { touched: string[] };

export type Effect = EffectBody & {
	step: number;
	phase: Phase;
	/**
	 * Every effect that is not a D1 statement or a marker of the harness carries the digest of both databases as they were
	 * when it happened: what existed when the email, the Stripe call, the R2 or KV operation, the AI call or the console
	 * line went out.
	 */
	state?: EffectState;
};

export const UNSTATED = new Set([
	"d1",
	"d1-batch",
	"interleave",
	"trigger-hit",
	"advance",
]);

/** The shared, ordered log. Every fake writes here; the runner sets the step and phase. */
export class EffectLog {
	readonly entries: Effect[] = [];
	step = 0;
	/** The phase of an effect that cannot wait at the gate (a console line, a waitUntil call, a clock move): request until the answer has been read. */
	phase: Phase = "request";
	private quiet = 0;

	/** While true, an effect that starts waits at the gate until the runner releases it (see `start`). Off outside a driven request. */
	gating = false;

	private readonly held: ((phase: Phase) => void)[] = [];

	/** Told when an effect arrives at the gate, so a runner that is waiting for something else can wake. */
	onHeld: (() => void) | undefined;

	/** How many effects wait at the gate. */
	get waiting() {
		return this.held.length;
	}

	/**
	 * The first thing every fake does, before it reads or changes anything. While a request is driven the effect waits
	 * here, so whether it ran before the response was read depends only on whether the response needed it, never on how
	 * many microtask turns the route took to get there: the runner lets the event loop go quiet, and an effect still
	 * waiting then is one the response is waiting for (it is released as "request"), unless the answer has already been
	 * read, in which case nothing waited for it (it is released as "background"). Resolves with the effect's phase.
	 * Off-record work and an undriven log pass straight through.
	 */
	start(): Promise<Phase> {
		if (!this.gating || this.quiet > 0) return Promise.resolve(this.phase);

		return new Promise((resolve) => {
			this.held.push(resolve);
			this.onHeld?.();
		});
	}

	/** Lets every waiting effect begin, in the order they arrived, labelled `phase`. */
	release(phase: Phase) {
		for (const resolve of this.held.splice(0)) resolve(phase);
	}

	/** False while off-record work (sign-in, seeding, a hook) runs. */
	get recording() {
		return this.quiet === 0;
	}

	/** Answers the state of the databases now; set by the runner once they are open. */
	probe: (() => DatabaseStates) | undefined;

	/** Per step, the tables that committed row-changing writes have touched. */
	private readonly written = new Map<number, Set<string>>();

	/** The tables touched so far in the current step, by name. */
	touched(): string[] {
		return [...(this.written.get(this.step) ?? [])].sort();
	}

	/**
	 * Notes tables whose rows changed in the current step. The D1 wrapper calls it as a statement runs (a batch when it
	 * commits), so the set and the state digest describe the same instant, whatever order parallel calls settle in.
	 */
	touch(tables: readonly string[]) {
		if (this.quiet > 0 || tables.length === 0) return;

		const set = this.written.get(this.step) ?? new Set<string>();

		for (const table of tables) set.add(table);

		this.written.set(this.step, set);
	}

	/** Records an effect. `phase` is the one `start` gave it; an effect that never waited at the gate has the log's own. */
	push(body: EffectBody, phase: Phase = this.phase) {
		if (this.quiet > 0) return;

		const entry: Effect = { ...body, step: this.step, phase };

		if (this.probe && !UNSTATED.has(body.kind))
			entry.state = { ...this.probe(), touched: this.touched() };

		this.entries.push(entry);
	}

	/** Runs `work` without recording, for setup that is not part of the case (sign-in, seeding). */
	async unrecorded<T>(work: () => Promise<T>): Promise<T> {
		this.quiet += 1;

		try {
			return await work();
		} finally {
			this.quiet -= 1;
		}
	}
}
