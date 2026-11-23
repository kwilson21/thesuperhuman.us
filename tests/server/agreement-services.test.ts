import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyedHash } from "../../src/lib/client-portal";
import {
	AgreementAllowance,
	AgreementAllowanceFailed,
	liveAgreementAllowance,
} from "../../src/server/agreement-services";
import { CodeKeyUnusable } from "../../src/server/signin-services";
import { freshMusicDb } from "../golden/harness/db";
import { double } from "../helpers/doubles";
import { sqliteD1 } from "../helpers/sqlite-d1";

// The agreement area's services (src/server/agreement-services.ts) with fake bindings: the allowance on the real schema
// (the use it counted, a code key under 32 characters).

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const run = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.match(effect, {
			onFailure: (failure) => ({ failed: failure }),
			onSuccess: (value) => ({ value }),
		}),
	);

/** What an effect failed with; an effect that succeeds fails the test. */
async function failureOf<A, E>(effect: Effect.Effect<A, E>) {
	const ran = await run(effect);

	if (!("failed" in ran)) throw new Error("The effect succeeded.");

	return ran.failed;
}

/** What a failure that carries one says caused it. */
const causeOf = (failure: { readonly failure: unknown }) => failure.failure;

// ---- the allowance ----

const SECRET = "k".repeat(32);

/** A database on the real schema whose statements are logged by their SQL. */
function loggedDb() {
	const sql = freshMusicDb();
	const real = sqliteD1(sql);
	const log: string[] = [];

	const db = double<D1Database>({
		prepare: (query: string) => {
			log.push(query);

			return real.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			log.push("batch");

			return real.batch<T>(items);
		},
	});

	return { sql, db, log };
}

describe("AgreementAllowance", () => {
	it("answers each use with whether it is allowed, its keyed hash and the start of the window it counted in", async () => {
		const { db } = loggedDb();

		const allowance = Context.get(
			liveAgreementAllowance(db, SECRET),
			AgreementAllowance,
		);

		const key = await keyedHash(SECRET, "agreement-link-ip:203.0.113.7");

		vi.useFakeTimers({ now: new Date("2026-11-23T12:00:00.000Z") });

		const first = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		vi.setSystemTime(new Date("2026-11-23T12:01:00.000Z"));

		const second = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		const third = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		vi.useRealTimers();

		// Every use of the window answers the window's start, so a refund finds its row.
		const window_start = "2026-11-23T12:00:00.000Z";

		expect([first, second, third]).toEqual([
			{ value: { key, window_start, allowed: true } },
			{ value: { key, window_start, allowed: true } },
			{ value: { key, window_start, allowed: false } },
		]);
	});

	it("refuses a code key under 32 characters before anything is counted or hashed", async () => {
		const { db, log } = loggedDb();

		const allowance = Context.get(
			liveAgreementAllowance(db, "k".repeat(31)),
			AgreementAllowance,
		);

		expect(
			await failureOf(allowance.reserve("agreement-link-ip", "x", 20)),
		).toBeInstanceOf(CodeKeyUnusable);
		expect(
			await failureOf(allowance.keyed("archive-link-cooldown:x")),
		).toBeInstanceOf(CodeKeyUnusable);
		expect(log).toEqual([]);
	});

	it("is AgreementAllowanceFailed with the cause when the count fails", async () => {
		const failure = new Error("D1_ERROR: unavailable");

		const statement = double<D1PreparedStatement>({});
		statement.bind = () => statement;

		const allowance = Context.get(
			liveAgreementAllowance(
				double<D1Database>({
					prepare: () => statement,
					batch: async () => {
						throw failure;
					},
				}),
				SECRET,
			),
			AgreementAllowance,
		);

		const failed = await failureOf(
			allowance.reserve("agreement-link-ip", "x", 20),
		);

		expect(failed).toBeInstanceOf(AgreementAllowanceFailed);
		expect(failed instanceof AgreementAllowanceFailed && causeOf(failed)).toBe(
			failure,
		);
	});
});
