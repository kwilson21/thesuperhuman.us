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
import type { DatabaseDigester } from "./digest";
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

/** With GOLDEN_VERIFY_COUNTS=1 every RECORDED count is compared with SQLite's `total_changes()` measured around the statement. */
const VERIFY_COUNTS = process.env.GOLDEN_VERIFY_COUNTS === "1";

/** What the meter learned about one statement as it ran. */
type Measure = {
	/** SQLite's `changes()` after it: the rows the statement itself changed (0 for a read). */
	count: number;
	/** The difference in `total_changes()` around it; measured only with GOLDEN_VERIFY_COUNTS=1. */
	delta: number;
	/** The tables whose rows changed, whoever changed them (the statement or a trigger), plus the statement's own table when it changed a row. */
	tables: string[];
};

const writes = (sql: string): boolean => {
	try {
		return statementOf(sql).write;
	} catch {
		// A write the reader cannot attribute still counts as a write.
		return true;
	}
};

/** Whether SQLite's `total_changes()` also counts rows this statement's table writes elsewhere (triggers, foreign key actions, REPLACE). */
function writesElsewhere(sqlite: SqliteDatabase, sql: string): boolean {
	let table: string | null = null;

	try {
		table = statementOf(sql).table;
	} catch {
		return true;
	}

	if (/\bOR\s+REPLACE\b|^\s*REPLACE\b/i.test(sql)) return true;

	const triggers = sqlite
		.prepare(
			"SELECT 1 AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?",
		)
		.get(table ?? "");

	if (triggers) return true;

	return sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all()
		.some((row) =>
			sqlite
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
 * The check behind GOLDEN_VERIFY_COUNTS=1: the count that ends up RECORDED for a statement against the difference in
 * SQLite's `total_changes()` measured around it. A read changes nothing (0 and 0). A write on a table with no trigger,
 * foreign key action or REPLACE changes exactly the recorded count; on one that has them, `total_changes()` also counts
 * what they wrote, so the check is that the statement changed a row exactly when SQLite says rows changed, and no more
 * rows than SQLite counted.
 */
export function verifyCount(
	sqlite: SqliteDatabase,
	sql: string,
	recorded: number,
	delta: number,
) {
	const fine = !writes(sql)
		? recorded === 0 && delta === 0
		: writesElsewhere(sqlite, sql)
			? recorded <= delta && recorded > 0 === delta > 0
			: recorded === delta;

	if (!fine)
		throw new Error(
			`golden harness: the recorded change count ${recorded} does not agree with the ${delta} rows SQLite's total_changes() counted around this statement: ${sql.slice(0, 160)}`,
		);
}

/** The measure of a statement that ran, or an error: a count that is missing must never be recorded as 0. */
export function measureOf(measure: Measure | undefined, sql: string): Measure {
	if (measure === undefined)
		throw new Error(
			`golden harness: no change count was measured for this statement, so none can be recorded: ${sql.slice(0, 160)}`,
		);

	return measure;
}

/**
 * Measures every statement run through the database, as it runs: the rows it changed (so the record holds the real number
 * for every D1 method, never a null that reads as "no row"), and the tables whose rows changed. The tables come from
 * comparing the per-table digests before and after a write, so a table a trigger wrote counts, and a rule moved from a
 * trigger into code looks the same; the statement's own table is added when it changed a row, which also covers a
 * same-value UPDATE that no digest sees.
 */
class ChangeMeter {
	/** One measure per executed statement, in the order they ran. */
	readonly measures: Measure[] = [];

	/** How the last transaction ended, set when the fake D1 runs COMMIT or ROLLBACK. */
	transaction: "COMMIT" | "ROLLBACK" | null = null;

	constructor(
		private readonly sqlite: SqliteDatabase,
		private readonly digester: DatabaseDigester,
	) {}

	private total(): number {
		return Number(
			this.sqlite.prepare("SELECT total_changes() AS n").get()?.n ?? 0,
		);
	}

	/** Checks a recorded count against what the statement measured. */
	check(sql: string, recorded: number, measure: Measure) {
		if (VERIFY_COUNTS) verifyCount(this.sqlite, sql, recorded, measure.delta);
	}

	private watch(sql: string, statement: StatementSync): StatementSync {
		const write = writes(sql);

		const measured = <T>(work: () => T): T => {
			const before = write ? this.digester.perTable() : undefined;
			const totalBefore = VERIFY_COUNTS ? this.total() : 0;
			let result: T;

			try {
				result = work();
			} catch (error) {
				// A statement that failed part way puts its rows back without moving total_changes().
				this.digester.invalidate();

				throw error;
			}

			const count = write
				? Number(this.sqlite.prepare("SELECT changes() AS n").get()?.n ?? 0)
				: 0;

			const tables = new Set<string>();

			if (before) {
				const after = this.digester.perTable();

				for (const [name, digest] of after)
					if (before.get(name) !== digest) tables.add(name);

				if (count > 0) {
					try {
						const own = statementOf(sql).table;

						if (own) tables.add(own);
					} catch {
						// An unattributable write: the digests above are what is known.
					}
				}
			}

			this.measures.push({
				count,
				delta: VERIFY_COUNTS ? this.total() - totalBefore : 0,
				tables: [...tables].sort(),
			});

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
			exec: (sql: string) => {
				const result = this.sqlite.exec(sql);

				if (sql === "COMMIT" || sql === "ROLLBACK") this.transaction = sql;

				// A rollback puts rows back without moving total_changes(): the cached digests are stale.
				if (sql === "ROLLBACK") this.digester.invalidate();

				return result;
			},
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
	digester: DatabaseDigester,
): D1Database {
	const meter = new ChangeMeter(sqlite, digester);
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

		const recorded = (result: D1Outcome, known: Measure): D1Outcome => {
			if ("changes" in result) meter.check(sql, result.changes, known);

			return result;
		};

		const ran = async <T>(
			via: "first" | "all" | "run",
			work: () => Promise<T>,
			outcome: (value: T, changes: number) => D1Outcome,
		): Promise<T> => {
			guard(via);

			try {
				// The statement runs on the database synchronously, as the call starts, so its measure is the next one the
				// meter holds; reading it after the await would take whatever statement a parallel call ran meanwhile. The
				// tables it changed are noted now, when it ran, so they describe the same instant as the state digest.
				const position = meter.measures.length;
				const pending = work();
				const measure = meter.measures[position];

				log.touch(measure?.tables ?? []);

				const value = await pending;
				const known = measureOf(measure, sql);
				log.push({
					kind: "d1",
					db: label,
					via,
					sql,
					args: argRecords(args),
					outcome: recorded(outcome(value, known.count), known),
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

			// The whole batch runs on the database synchronously, as the call starts (see `ran`), so its statements'
			// measures are the next ones the meter holds, and by the time the call returns it has committed or rolled back.
			// Its tables are noted when it committed, not before, and never when it rolled back.
			const first = meter.measures.length;
			meter.transaction = null;
			const pending = real.batch(parts.map((part) => part.inner));
			const ran = meter.measures.slice(first);

			if (meter.transaction === "COMMIT")
				log.touch(ran.flatMap((measure) => measure.tables));

			try {
				const results = await pending;

				if (ran.length !== parts.length)
					throw new Error(
						`golden harness: ${ran.length} change counts were measured for a batch of ${parts.length} statements, so none can be recorded.`,
					);

				log.push({
					kind: "d1-batch",
					db: label,
					result: "committed",
					error: null,
					statements: records(
						results.map((result, index) => {
							const known = measureOf(ran[index], parts[index]?.sql ?? "");
							const sql = parts[index]?.sql ?? "";

							meter.check(sql, known.count, known);

							return { rows: result.results.length, changes: known.count };
						}),
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
