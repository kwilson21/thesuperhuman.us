// A D1 binding that runs real SQL on node:sqlite (tests/helpers/sqlite-d1.ts) and records every statement it runs.
//
// What is recorded: the SQL text exactly as prepared, the bound arguments (tagged where JSON cannot say them), which
// database, whether the statement ran through first(), all() or run() or inside a batch() (one entry for the whole
// batch, with its statements in order and whether it committed or rolled back), and the result shape a caller reads:
// the row count and meta.changes. Only a statement that is executed is recorded, never one that is merely prepared.
//
// Two hooks make a branch that only a race or an outage reaches testable. A `Interleave` runs raw SQL on the database
// just before the n-th statement that matches (another request got there first), and an `InjectedFailure` makes the
// n-th matching statement or batch throw without running. Both appear in the log, so a fixture shows them.
import type { SQLInputValue } from "node:sqlite";
import { double } from "../../helpers/doubles";
import { sqliteD1, type SqliteDatabase } from "../../helpers/sqlite-d1";
import type { D1Outcome, D1Statement } from "./log";
import type { EffectLog } from "./log";
import { argRecord, errorText } from "./plain";
import type { Triggers } from "./triggers";

/** Picks the n-th statement (or batch containing a statement) whose SQL matches. `on` must not use the g flag. */
export type SqlTrigger = {
	/** Database name, such as MUSIC_DB. Leave out to match either. */
	readonly db?: string;
	readonly on: RegExp;
	/** 1 for the first match (the default), 2 for the second, and so on. */
	readonly nth?: number;
};

export type Interleave = SqlTrigger & {
	readonly label: string;
	readonly run: (sqlite: SqliteDatabase) => void;
};

export type InjectedFailure = SqlTrigger & { readonly message: string };

/** The hooks of a case, with the count of matches each has seen. */
export class SqlHooks {
	private readonly seen = new Map<SqlTrigger, number>();
	private readonly ids = new Map<SqlTrigger, string>();
	private paused = 0;

	constructor(
		private readonly interleaves: readonly Interleave[],
		private readonly failures: readonly InjectedFailure[],
		private readonly triggers: Triggers,
	) {
		const where = (trigger: SqlTrigger) =>
			`${trigger.db === undefined ? "" : `${trigger.db} `}${trigger.on}${trigger.nth === undefined || trigger.nth === 1 ? "" : ` (match ${trigger.nth})`}`;

		for (const interleave of interleaves)
			this.declare(
				interleave,
				`d1 interleave "${interleave.label}" on ${where(interleave)}`,
			);

		for (const failure of failures)
			this.declare(failure, `d1 failure on ${where(failure)}`);
	}

	private declare(trigger: SqlTrigger, id: string) {
		this.ids.set(trigger, id);
		this.triggers.declare(id, trigger.nth ?? 1);
	}

	/** Runs `work` with no hook firing and no match counted, for setup that is not part of the case (sign-in). */
	async quietly<T>(work: () => Promise<T>): Promise<T> {
		this.paused += 1;

		try {
			return await work();
		} finally {
			this.paused -= 1;
		}
	}

	private hit(trigger: SqlTrigger, db: string, sqls: readonly string[]) {
		if (trigger.db !== undefined && trigger.db !== db) return false;

		if (!sqls.some((sql) => trigger.on.test(sql))) return false;

		const count = (this.seen.get(trigger) ?? 0) + 1;
		this.seen.set(trigger, count);

		const id = this.ids.get(trigger);

		if (id !== undefined) this.triggers.see(id);

		return count === (trigger.nth ?? 1);
	}

	/** Runs the interleaves due before these statements, and returns the failure to throw, if one is due. */
	before(
		db: string,
		sqls: readonly string[],
		sqlite: SqliteDatabase,
		log: EffectLog,
	): string | null {
		if (this.paused > 0) return null;

		for (const interleave of this.interleaves) {
			if (!this.hit(interleave, db, sqls)) continue;

			log.push({ kind: "interleave", label: interleave.label });
			interleave.run(sqlite);
		}

		// Every trigger counts every matching call, so `nth` means the n-th match of that trigger alone, even when an
		// earlier trigger fails the same call. The first trigger due supplies the message.
		let due: string | null = null;

		for (const failure of this.failures)
			if (this.hit(failure, db, sqls)) due ??= failure.message;

		return due;
	}
}

type Wrapped = {
	sql: string;
	args: SQLInputValue[];
	inner: D1PreparedStatement;
};

function loud(what: string): never {
	throw new Error(`golden harness: ${what} is not recorded. Add it to d1.ts.`);
}

/**
 * A recording D1 over `sqlite`. `label` names the database in the log. Statements are recorded in the order they run.
 */
export function recordingD1(
	label: string,
	sqlite: SqliteDatabase,
	log: EffectLog,
	hooks: SqlHooks,
): D1Database {
	const real = sqliteD1(sqlite);
	const wrapped = new WeakMap<D1PreparedStatement, Wrapped>();

	const argRecords = (args: readonly SQLInputValue[]) =>
		args.map((arg) => argRecord(arg));

	const statement = (
		sql: string,
		args: SQLInputValue[],
	): D1PreparedStatement => {
		const inner = real.prepare(sql).bind(...args);

		const guard = (via: "first" | "all" | "run") => {
			const failure = hooks.before(label, [sql], sqlite, log);

			if (failure === null) return;

			log.push({
				kind: "d1",
				db: label,
				via,
				sql,
				args: argRecords(args),
				outcome: { threw: failure },
			});

			throw new Error(failure);
		};

		const ran = async <T>(
			via: "first" | "all" | "run",
			work: () => Promise<T>,
			outcome: (value: T) => D1Outcome,
		): Promise<T> => {
			guard(via);

			try {
				const value = await work();

				log.push({
					kind: "d1",
					db: label,
					via,
					sql,
					args: argRecords(args),
					outcome: outcome(value),
				});

				return value;
			} catch (error) {
				log.push({
					kind: "d1",
					db: label,
					via,
					sql,
					args: argRecords(args),
					outcome: {
						threw: error instanceof Error ? errorText(error) : "non-error",
					},
				});

				throw error;
			}
		};

		const prepared = double<D1PreparedStatement>({
			bind: (...values: SQLInputValue[]) => statement(sql, values),
			// SAFETY: first(), all() and run() are generic over the row type, so a non-generic function cannot be typed as the member; each returns what the real fake returns, and the caller names the row type itself.
			first: (async (column?: string) => {
				if (column !== undefined) loud("first(column)");

				return ran(
					"first",
					() => inner.first(),
					(row) => ({ rows: row === null ? 0 : 1, changes: null }),
				);
			}) as D1PreparedStatement["first"],
			// SAFETY: as for first().
			all: (() =>
				ran(
					"all",
					() => inner.all(),
					(result) => ({ rows: result.results.length, changes: null }),
				)) as D1PreparedStatement["all"],
			// SAFETY: as for first().
			run: (() =>
				ran(
					"run",
					() => inner.run(),
					(result) => ({ rows: 0, changes: result.meta.changes }),
				)) as D1PreparedStatement["run"],
			raw: () => loud("raw()"),
		});

		wrapped.set(prepared, { sql, args, inner });

		return prepared;
	};

	return double<D1Database>({
		prepare: (sql: string) => statement(sql, []),
		exec: () => loud("exec()"),
		// SAFETY: batch() is generic over the row type, so a non-generic function cannot be typed as the member; it returns the results the real fake returns.
		batch: (async (items: D1PreparedStatement[]) => {
			const parts = items.map((item) => {
				const found = wrapped.get(item);

				if (!found)
					throw new Error(
						"golden harness: batch() got a statement it did not prepare.",
					);

				return found;
			});

			const records = (outcomes: D1Outcome[]): D1Statement[] =>
				parts.map((part, index) => ({
					sql: part.sql,
					args: argRecords(part.args),
					outcome: outcomes[index],
				}));

			const failure = hooks.before(
				label,
				parts.map((part) => part.sql),
				sqlite,
				log,
			);

			if (failure !== null) {
				log.push({
					kind: "d1-batch",
					db: label,
					result: "injected-failure",
					error: failure,
					statements: records(parts.map(() => ({ threw: "not run" }))),
				});

				throw new Error(failure);
			}

			try {
				const results = await real.batch(parts.map((part) => part.inner));

				log.push({
					kind: "d1-batch",
					db: label,
					result: "committed",
					error: null,
					statements: records(
						results.map((result) => ({
							rows: result.results.length,
							changes: result.meta.changes ?? null,
						})),
					),
				});

				return results;
			} catch (error) {
				log.push({
					kind: "d1-batch",
					db: label,
					result: "rolled-back",
					error: error instanceof Error ? errorText(error) : "non-error",
					statements: records(
						parts.map(() => ({ threw: "batch rolled back" })),
					),
				});

				throw error;
			}
		}) as D1Database["batch"],
	});
}
