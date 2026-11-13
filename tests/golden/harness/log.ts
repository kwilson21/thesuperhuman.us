// The ordered effect log of one case, and the entries in it.
import type { ByteRecord, Recorded } from "./plain";

/** Where an effect happened: while the handler ran, or after it had answered (ctx.waitUntil work). */
export type Phase = "request" | "background";

/** What a statement or call gave back that a caller can see: how many rows, how many changes, or that it threw. */
export type D1Outcome =
	| { rows: number; changes: number | null }
	| { threw: string };

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

export type Effect = EffectBody & { step: number; phase: Phase };

/** The shared, ordered log. Every fake writes here; the runner sets the step and phase. */
export class EffectLog {
	readonly entries: Effect[] = [];
	step = 0;
	phase: Phase = "request";
	private quiet = 0;

	push(body: EffectBody) {
		if (this.quiet > 0) return;

		this.entries.push({ ...body, step: this.step, phase: this.phase });
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
