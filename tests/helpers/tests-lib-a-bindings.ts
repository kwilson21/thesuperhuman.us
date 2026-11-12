import { double } from "./doubles";

/**
 * A D1 prepared statement's first(), which resolves to the row `read` returns when it is called. The code under
 * test names the row shape in its own first<Row>() call; the fake returns the row without inspecting it.
 */
export function fakeFirst<Row>(
	read: () => Row | null | Promise<Row | null>,
): D1PreparedStatement["first"] {
	// SAFETY: each test's read() returns a row written in the shape the code under test's first<Row>() call names; first() is generic, so a non-generic async function cannot be typed as D1PreparedStatement["first"] without this cast.
	return (async () => read()) as D1PreparedStatement["first"];
}

/**
 * A D1 prepared statement's run() or all(), which resolves to the D1Result `read` returns when it is called. Both
 * are generic over the row type; the code under test names that type in its own call, and the fake returns the
 * result without inspecting it.
 */
export function fakeResult(
	read: () => D1Result | Promise<D1Result>,
): D1PreparedStatement["run"] {
	// SAFETY: run() and all() are generic over the row type; each test's read() returns rows selected by that statement's own SQL, and the code under test reads them in the shape that SQL selects. A non-generic function cannot be typed as D1PreparedStatement["run"] without this cast.
	return (async () => read()) as D1PreparedStatement["run"];
}

/** The `meta` of a D1Result that reports `changes` written rows, and no other meta fields. */
export function d1Meta(changes: number): D1Result["meta"] {
	return double<D1Result["meta"]>({ changes });
}

/**
 * A D1 database batch(), which runs `run` over the statements the code under test passes and resolves to its
 * results. batch() is generic over the row type; run() returns rows selected by the statements the test wrote.
 */
export function fakeBatch(
	run: (statements: D1PreparedStatement[]) => D1Result[] | Promise<D1Result[]>,
): D1Database["batch"] {
	// SAFETY: batch() is generic over the row type; run() returns results for the statements the test wrote, and the code under test reads each result in the shape its own SQL selects. A non-generic function cannot be typed as D1Database["batch"] without this cast.
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

/** An R2 bucket whose get() resolves to an object whose arrayBuffer() returns a copy of `bytes`, and no other members. */
export function fakeR2Bytes(bytes: Uint8Array): R2Bucket {
	return double<R2Bucket>({
		get: async () =>
			double<R2ObjectBody>({ arrayBuffer: async () => bytes.slice().buffer }),
	});
}
