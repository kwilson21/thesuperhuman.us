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
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { statementOf } from "../../../scripts/sql-effects.mjs";
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

	/** The statements the trigger matched, when this is the match it fires on; otherwise null. */
	private hit(
		trigger: SqlTrigger,
		db: string,
		sqls: readonly string[],
	): string[] | null {
		if (trigger.db !== undefined && trigger.db !== db) return null;

		const matching = sqls.filter((sql) => trigger.on.test(sql));

		if (matching.length === 0) return null;

		const count = (this.seen.get(trigger) ?? 0) + 1;
		this.seen.set(trigger, count);

		const id = this.ids.get(trigger);

		if (id !== undefined) this.triggers.see(id);

		return count === (trigger.nth ?? 1) ? matching : null;
	}

	private marker(
		log: EffectLog,
		trigger: "failure" | "interleave",
		name: string,
		db: string,
		matching: readonly string[],
	) {
		log.push({
			kind: "trigger-hit",
			trigger,
			name,
			db,
			hits: matching.map((sql) => {
				const { op, table, write } = statementOf(sql);

				return { op, table, access: write ? "write" : "read" };
			}),
		});
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
			const matching = this.hit(interleave, db, sqls);

			if (!matching) continue;

			log.push({ kind: "interleave", label: interleave.label });
			this.marker(log, "interleave", interleave.label, db, matching);
			interleave.run(sqlite);
		}

		// Every trigger counts every matching call, so `nth` means the n-th match of that trigger alone, even when an
		// earlier trigger fails the same call. The first trigger due supplies the message.
		let due: string | null = null;

		for (const failure of this.failures) {
			const matching = this.hit(failure, db, sqls);

			if (!matching) continue;

			this.marker(log, "failure", failure.message, db, matching);
			due ??= failure.message;
		}

		return due;
	}
}

/** With GOLDEN_VERIFY_COUNTS=1 every recorded count is compared with SQLite's `total_changes()` measured around the statement. */
const VERIFY_COUNTS = process.env.GOLDEN_VERIFY_COUNTS === "1";

/**
 * Counts the rows each statement run through the database changed, so the record holds the real number for every D1
 * method (first(), all(), run() and batch()), never a null that reads as "no row". A statement that is not a write
 * changed nothing; for a write the count is SQLite's own `changes()` after it ran.
 */
class ChangeMeter {
	/** One count per executed statement, in the order they ran. */
	readonly counts: number[] = [];

	constructor(private readonly sqlite: SqliteDatabase) {}

	private changes(sql: string): number {
		let write = true;

		try {
			write = statementOf(sql).write;
		} catch {
			// A write the reader cannot attribute still counts: ask SQLite.
		}

		if (!write) return 0;

		return Number(this.sqlite.prepare("SELECT changes() AS n").get()?.n ?? 0);
	}

	private total(): number {
		return Number(
			this.sqlite.prepare("SELECT total_changes() AS n").get()?.n ?? 0,
		);
	}

	/** Whether SQLite's `total_changes()` also counts rows this statement's table writes elsewhere (triggers, foreign key actions, REPLACE). */
	private writesElsewhere(sql: string): boolean {
		let table: string | null = null;

		try {
			table = statementOf(sql).table;
		} catch {
			return true;
		}

		if (/\bOR\s+REPLACE\b|^\s*REPLACE\b/i.test(sql)) return true;

		const triggers = this.sqlite
			.prepare(
				"SELECT 1 AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?",
			)
			.get(table ?? "");

		if (triggers) return true;

		const tables = this.sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all();

		return tables.some((row) =>
			this.sqlite
				.prepare(
					`PRAGMA foreign_key_list("${String(row.name).replaceAll('"', '""')}")`,
				)
				.all()
				.some(
					(key) =>
						key.table === table &&
						!["NO ACTION", "RESTRICT"].includes(
							`${key.on_update}`.toUpperCase(),
						),
				),
		);
	}

	/**
	 * The check behind GOLDEN_VERIFY_COUNTS=1: the count recorded for a statement against the difference in SQLite's
	 * `total_changes()` measured around it. A read changes nothing (0 and 0). A write on a table with no trigger, foreign
	 * key action or REPLACE changes exactly the recorded count; on one that has them, `total_changes()` also counts what
	 * they wrote, so the check is that the statement changed a row exactly when SQLite says rows changed, and no more rows
	 * than SQLite counted.
	 */
	private verify(sql: string, count: number, delta: number) {
		let write = true;

		try {
			write = statementOf(sql).write;
		} catch {
			// Treated as a write.
		}

		const fine = !write
			? count === 0 && delta === 0
			: this.writesElsewhere(sql)
				? count <= delta && count > 0 === delta > 0
				: count === delta;

		if (!fine)
			throw new Error(
				`golden harness: the recorded change count ${count} does not agree with the ${delta} rows SQLite's total_changes() counted around this statement: ${sql.slice(0, 160)}`,
			);
	}

	private watch(sql: string, statement: StatementSync): StatementSync {
		const measured = <T>(work: () => T): T => {
			const before = VERIFY_COUNTS ? this.total() : 0;
			const result = work();
			const count = this.changes(sql);

			if (VERIFY_COUNTS) this.verify(sql, count, this.total() - before);

			this.counts.push(count);

			return result;
		};

		// SAFETY: get, all and run are overloaded for named parameters; the fake D1 only passes positional ones, and each member runs the real statement with exactly the arguments it was given.
		return double<StatementSync>({
			get: ((...args: SQLInputValue[]) =>
				measured(() => statement.get(...args))) as StatementSync["get"],
			all: ((...args: SQLInputValue[]) =>
				measured(() => statement.all(...args))) as StatementSync["all"],
			run: ((...args: SQLInputValue[]) =>
				measured(() => statement.run(...args))) as StatementSync["run"],
		});
	}

	/** The database, with every statement it runs measured. The fake D1 uses only `prepare` and `exec`. */
	get database(): SqliteDatabase {
		return double<SqliteDatabase>({
			prepare: (sql: string) => this.watch(sql, this.sqlite.prepare(sql)),
			exec: (sql: string) => this.sqlite.exec(sql),
		});
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
	const meter = new ChangeMeter(sqlite);
	const real = sqliteD1(meter.database);
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
			outcome: (value: T, changes: number) => D1Outcome,
		): Promise<T> => {
			guard(via);

			try {
				// The statement runs on the database synchronously, as the call starts, so its count is the next one the
				// meter holds; reading it after the await would take whatever statement a parallel call ran meanwhile.
				const position = meter.counts.length;
				const pending = work();
				const changes = meter.counts[position] ?? 0;
				const value = await pending;

				log.push({
					kind: "d1",
					db: label,
					via,
					sql,
					args: argRecords(args),
					outcome: outcome(value, changes),
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
					(row, changes) => ({ rows: row === null ? 0 : 1, changes }),
				);
			}) as D1PreparedStatement["first"],
			// SAFETY: as for first().
			all: (() =>
				ran(
					"all",
					() => inner.all(),
					(result, changes) => ({ rows: result.results.length, changes }),
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

			// The whole batch runs on the database synchronously, as the call starts (see `ran`), so its statements' counts
			// are the next ones the meter holds.
			const first = meter.counts.length;
			const pending = real.batch(parts.map((part) => part.inner));
			const counts = meter.counts.slice(first);

			try {
				const results = await pending;

				log.push({
					kind: "d1-batch",
					db: label,
					result: "committed",
					error: null,
					statements: records(
						results.map((result, index) => ({
							rows: result.results.length,
							changes: counts[index] ?? 0,
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
