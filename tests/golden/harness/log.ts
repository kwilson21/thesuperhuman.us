// The ordered effect log of one case, and the entries in it.
import type { ByteRecord, Recorded } from "./plain";

/** Where an effect happened: while the handler ran, or after it had answered (ctx.waitUntil work). */
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
	phase: Phase = "request";
	private quiet = 0;

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

	push(body: EffectBody) {
		if (this.quiet > 0) return;

		const entry: Effect = { ...body, step: this.step, phase: this.phase };

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
