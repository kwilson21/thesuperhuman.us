import type { SQLInputValue } from "node:sqlite";
import { double } from "./doubles";

/** The SQL and bound arguments of a prepared statement. */
export type BoundStatement = { query: string; args: SQLInputValue[] };

/** The members of a prepared statement for `query` bound to `args`, besides `bind`. */
type StatementMembers = (
	query: string,
	args: SQLInputValue[],
) => Partial<D1PreparedStatement>;

/**
 * Prepared statements that preparedStatement made, mapped to their SQL and arguments, so a fake batch() can run
 * them and a test can read the SQL of a statement it intercepts.
 */
const bound = new WeakMap<D1PreparedStatement, BoundStatement>();

/**
 * A prepared statement that records its SQL and arguments. `bind` returns a new statement with the arguments bound,
 * built from the same `members`; `members` supplies first, all, run or any other member the test needs.
 */
export function preparedStatement(
	query: string,
	args: SQLInputValue[] = [],
	members: StatementMembers = () => ({}),
): D1PreparedStatement {
	const prepared = double<D1PreparedStatement>({
		...members(query, args),
		bind: (...values: SQLInputValue[]) =>
			preparedStatement(query, values, members),
	});

	bound.set(prepared, { query, args });

	return prepared;
}

/** The SQL text of a statement that preparedStatement made, or undefined for any other statement. */
export function boundQuery(statement: D1PreparedStatement): string | undefined {
	return bound.get(statement)?.query;
}

/** The SQL and arguments of a statement that preparedStatement made; any other statement throws. */
export function boundStatement(statement: D1PreparedStatement): BoundStatement {
	const found = bound.get(statement);

	if (!found) throw new Error("Expected a statement prepared by this fake.");

	return found;
}

/**
 * A D1 prepared statement's first(), which resolves to the row `read` returns when it is called. The code under
 * test names the row shape in its own first<Row>() call; the fake returns the row without inspecting it.
 */
export function fakeFirst<Row>(
	read: () => Row | null | Promise<Row | null>,
): D1PreparedStatement["first"] {
	// SAFETY: first() is generic, so a non-generic async function cannot be typed as D1PreparedStatement["first"]; each test's read() returns a row in the shape the code under test names in its own first<Row>() call.
	return (async () => read()) as D1PreparedStatement["first"];
}

/**
 * A D1 database batch(), which runs `run` over the statements the code under test passes and resolves to its
 * results.
 */
export function fakeBatch(
	run: (statements: D1PreparedStatement[]) => D1Result[] | Promise<D1Result[]>,
): D1Database["batch"] {
	// SAFETY: batch() is generic over the row type, so a non-generic function cannot be typed as D1Database["batch"]; run() returns results for the statements the test wrote, in the shape each statement's SQL selects.
	return (async (statements: D1PreparedStatement[]) =>
		run(statements)) as D1Database["batch"];
}

/** A D1 database whose prepare().bind().first() resolves to `row`, and no other members. */
export function fakeD1First<Row>(row: Row | null): D1Database {
	return double<D1Database>({
		prepare: () =>
			double<D1PreparedStatement>({
				bind: () =>
					double<D1PreparedStatement>({ first: fakeFirst(() => row) }),
			}),
	});
}
