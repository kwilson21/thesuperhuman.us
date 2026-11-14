import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { freshMusicDb, freshPublicationDb } from "./db";
import { digestDatabase } from "./digest";
import {
	asVisitor,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
} from "./index";

/** Recordings per case. Five is enough to show the snapshot is the same every time. */
const RECORDINGS = 5;

// Five recordings of a case take about 100 ms; 30 s leaves a loaded CI runner room.
const RECORDED_TIMEOUT_MS = 30_000;

// The digest at the response is the state of the databases when the response was read, before any background work. These
// tests check that mechanism with synthetic handlers on the real harness. The expected digests are computed here, from
// rows inserted by hand into a fresh database (digestDatabase), never read back from a recording.

const env = (context: APIContext) => context.locals.runtime.env;
const ctxOf = (context: APIContext) => context.locals.runtime.ctx;

/** Row A: a budget row, in brief_suggestion_budget. Written by the request. */
const ROW_A =
	"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('a', 's', 1)";

/** Row B: an unmatched Stripe event, in a different table. Written by background work. */
const ROW_B =
	"INSERT INTO stripe_unmatched_events (event_id, event_type, invoice_id, request_id, installment, status, occurred_at, received_at, reason) VALUES ('e1', 'invoice.paid', 'inv_1', 'req_1', 'booking', 'unmatched', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'request-not-found')";

/** Row C: a second budget row, written by the second step. */
const ROW_C =
	"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('c', 's', 1)";

/** Publication rows: an accepted event in publication_events (the publication database). */
const PUBLICATION_ROW_A =
	"INSERT INTO publication_events (project_id, event_id, entry_id, revision, operation, origin, payload_hash, published_at) VALUES ('p', 'ev_a', 'entry', 1, 'publish', 'work', 'hash_a', '2026-01-01T00:00:00Z')";

/** A second publication row, written by background work. */
const PUBLICATION_ROW_B =
	"INSERT INTO publication_events (project_id, event_id, entry_id, revision, operation, origin, payload_hash, published_at) VALUES ('p', 'ev_b', 'entry', 2, 'correct', 'work', 'hash_b', '2026-01-01T00:00:01Z')";

const write = async (context: APIContext, sql: string): Promise<void> => {
	await env(context).MUSIC_DB?.prepare(sql).run();
};

const writePublication = async (
	context: APIContext,
	sql: string,
): Promise<void> => {
	await env(context).PUBLICATION_DB?.prepare(sql).run();
};

/** The digest of a publication database that holds exactly the given rows, computed from scratch in this test. */
const digestPublicationWith = (...rows: string[]): string => {
	const db = freshPublicationDb();

	try {
		for (const sql of rows) db.exec(sql);

		return digestDatabase(db).sha256;
	} finally {
		db.close();
	}
};

/** The digest of a music database that holds exactly the given rows, computed from scratch in this test. */
const digestWith = (...rows: string[]): string => {
	const db = freshMusicDb();

	try {
		for (const sql of rows) db.exec(sql);

		return digestDatabase(db).sha256;
	} finally {
		db.close();
	}
};

const one = (steps: Case["steps"]): Case => ({
	name: "snapshot",
	steps,
});

const step = { path: "/api/snapshot", method: "POST", as: asVisitor() };

/** Runs a case RECORDINGS times and checks that every run gives the same answer. */
async function recordedTimes<T>(
	run: () => Promise<T>,
	check: (got: T) => void,
): Promise<void> {
	const seen = new Set<string>();

	for (let index = 0; index < RECORDINGS; index += 1) {
		const got = await run();

		seen.add(JSON.stringify(got));
		check(got);
	}

	expect(seen.size).toBe(1);
}

const phases = (got: CaseRecord) =>
	got.effects
		.filter(
			(effect) =>
				effect.kind === "d1" ||
				effect.kind === "d1-batch" ||
				effect.kind === "waitUntil",
		)
		.map((effect) => `${effect.kind}:${effect.phase}`);

describe("the digest at the response: the snapshot mechanism", () => {
	it(
		"a write, then waitUntil with a write: the snapshot holds A and not B, touches A's table only, and the waitUntil state is the response",
		async () => {
			const handler: Handler = async (context) => {
				await write(context, ROW_A);
				ctxOf(context).waitUntil(write(context, ROW_B));

				return new Response("ok");
			};

			await recordedTimes(
				() => runCase(handler, one([step])),
				(got) => {
					const atResponse = got.steps[0]?.digest.atResponse;

					expect(atResponse?.music).toBe(digestWith(ROW_A));
					expect(atResponse?.touched).toEqual(["brief_suggestion_budget"]);
					expect(got.steps[0]?.digest.music).toBe(digestWith(ROW_A, ROW_B));
					expect(phases(got)).toEqual([
						"d1:request",
						"waitUntil:request",
						"d1:background",
					]);

					const waitUntil = got.effects.find(
						(effect) => effect.kind === "waitUntil",
					);

					expect(waitUntil?.state).toEqual({
						music: atResponse?.music,
						publication: atResponse?.publication,
						touched: atResponse?.touched,
					});
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);

	it(
		"a write started before waitUntil is called, and not awaited: the snapshot does not hold it, and it is background",
		async () => {
			const handler: Handler = async (context) => {
				await write(context, ROW_A);

				// The write starts here, synchronously, before the handler returns. The response does not wait for it.
				const pending = (async () => {
					await write(context, ROW_B);
				})();

				ctxOf(context).waitUntil(pending);

				return new Response("ok");
			};

			await recordedTimes(
				() => runCase(handler, one([step])),
				(got) => {
					expect(got.steps[0]?.digest.atResponse.music).toBe(digestWith(ROW_A));
					expect(got.steps[0]?.digest.atResponse.touched).toEqual([
						"brief_suggestion_budget",
					]);

					const statements = got.effects.filter(
						(effect) => effect.kind === "d1",
					);

					expect(statements.map((effect) => effect.phase)).toEqual([
						"request",
						"background",
					]);
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);

	it(
		"a handler that awaits a write after calling waitUntil: the snapshot holds the awaited write",
		async () => {
			// The harness cannot tell that the response did not need the un-awaited write while the handler is still running, so
			// the write started before the awaited one is released as request (phases.test.ts, "known limit"). The awaited write
			// is in the snapshot, and so is that one.
			const handler: Handler = async (context) => {
				ctxOf(context).waitUntil(write(context, ROW_B));
				await write(context, ROW_A);

				return new Response("ok");
			};

			await recordedTimes(
				() => runCase(handler, one([step])),
				(got) => {
					const atResponse = got.steps[0]?.digest.atResponse;

					expect(atResponse?.music).toBe(digestWith(ROW_A, ROW_B));
					expect(atResponse?.touched).toEqual([
						"brief_suggestion_budget",
						"stripe_unmatched_events",
					]);
					expect(got.steps[0]?.digest.music).toBe(digestWith(ROW_A, ROW_B));
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);

	it(
		"two steps: step 2's snapshot holds step 1's background write",
		async () => {
			const first: Handler = async (context) => {
				await write(context, ROW_A);
				ctxOf(context).waitUntil(write(context, ROW_B));

				return new Response("first");
			};

			const second: Handler = async (context) => {
				await write(context, ROW_C);

				return new Response("second");
			};

			await recordedTimes(
				() => runCase(first, one([step, { ...step, handler: second }])),
				(got) => {
					expect(got.steps[0]?.digest.atResponse.music).toBe(digestWith(ROW_A));
					expect(got.steps[1]?.digest.atResponse.music).toBe(
						digestWith(ROW_A, ROW_B, ROW_C),
					);
					expect(got.steps[1]?.digest.atResponse.touched).toEqual([
						"brief_suggestion_budget",
					]);
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);

	it(
		"a request write and a background write, both to the publication database: the snapshot holds the request's write only",
		async () => {
			const handler: Handler = async (context) => {
				await writePublication(context, PUBLICATION_ROW_A);
				ctxOf(context).waitUntil(writePublication(context, PUBLICATION_ROW_B));

				return new Response("ok");
			};

			await recordedTimes(
				() => runCase(handler, one([step])),
				(got) => {
					const atResponse = got.steps[0]?.digest.atResponse;

					expect(atResponse?.publication).toBe(
						digestPublicationWith(PUBLICATION_ROW_A),
					);
					expect(atResponse?.touched).toEqual(["publication_events"]);
					expect(atResponse?.music).toBe(digestWith());
					expect(got.steps[0]?.digest.publication).toBe(
						digestPublicationWith(PUBLICATION_ROW_A, PUBLICATION_ROW_B),
					);
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);

	it(
		"a request write to the music database and a background write to the publication database: each database holds its own write",
		async () => {
			const handler: Handler = async (context) => {
				await write(context, ROW_A);
				ctxOf(context).waitUntil(writePublication(context, PUBLICATION_ROW_B));

				return new Response("ok");
			};

			await recordedTimes(
				() => runCase(handler, one([step])),
				(got) => {
					const atResponse = got.steps[0]?.digest.atResponse;

					expect(atResponse?.music).toBe(digestWith(ROW_A));
					expect(atResponse?.publication).toBe(digestPublicationWith());
					expect(atResponse?.touched).toEqual(["brief_suggestion_budget"]);
					expect(got.steps[0]?.digest.publication).toBe(
						digestPublicationWith(PUBLICATION_ROW_B),
					);
				},
			);
		},
		RECORDED_TIMEOUT_MS,
	);
});
