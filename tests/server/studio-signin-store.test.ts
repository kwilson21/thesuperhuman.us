import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { GuardRefused } from "../../src/server/guarded-save";
import { ATTEMPTS_PER_CODE } from "../../src/server/machines/signin-code";
import { LIVE_CODES_PER_ADDRESS } from "../../src/server/rules/signin-issue";
import { allowanceTimes } from "../../src/server/rules/studio-allowance";
import { MusicDb } from "../../src/server/services";
import {
	countAllowance,
	readDiscardFacts,
	readEntryFacts,
	readIssueFacts,
	revokeSession,
	StudioSigninStoreFailed,
	sweepExpired,
	writeDiscard,
	writeEntry,
	writeIssue,
} from "../../src/server/studio-signin-store";
import { boundStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";

// The studio sign-in store (src/server/studio-signin-store.ts) against the real schema on node:sqlite: what each read
// finds, what each batch writes, what each guard (C1 to C9 of docs/plans/2026-11-studio-signin-conversion.md) refuses,
// and the failure each answers with (StudioSigninStoreFailed for a rejection, GuardRefused for a raised guard). And its
// SQL against the golden corpora of the three routes: every statement text and every batch's statements, in order, are
// ones the routes ran when the corpora were recorded, and every batch and statement the corpora recorded is one the
// store runs.

const ADDRESS = "grace@example.test";
const OTHER = "ada@example.test";
const NOW = "2026-11-13T12:00:00.000Z";
const LATER = "2026-11-13T12:10:00.000Z";
const EARLIER = "2026-11-13T11:00:00.000Z";
const SESSION_ENDS = "2026-11-27T12:00:00.000Z";
const OWN = "a".repeat(64);
const THEIRS = "b".repeat(64);
const TOKEN = "t".repeat(64);

/** A world: the real schema, every batch and statement the store runs recorded, and one statement failing when asked to. */
function signinWorld(failOn?: RegExp) {
	const sql = freshMusicDb();
	const real = sqliteD1(sql);
	const prepared: string[] = [];
	const batches: string[][] = [];

	const db = double<D1Database>({
		prepare: (query: string) => {
			prepared.push(query);

			if (failOn?.test(query)) throw new Error("d1 down");

			return real.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			batches.push(items.map((item) => boundStatement(item).query));

			return real.batch<T>(items);
		},
	});

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		prepared,
		batches,
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		seed: (tables: Seed) => seed(sql, tables),
		all: (query: string, ...args: string[]) => sql.prepare(query).all(...args),
	};
}

type World = ReturnType<typeof signinWorld>;

/** A service request (which makes its audio project) for the address. */
const request = (id: string, over: Record<string, string> = {}) =>
	rows.ownerRequest(id, { email: ADDRESS, ...over });

/** A code row of the address. */
const code = (
	nonceHash: string,
	over: Record<string, string | number> = {},
) => ({
	nonce_hash: nonceHash,
	email: ADDRESS,
	code_hash: `code-${nonceHash}`,
	attempts: 0,
	created_at: NOW,
	expires_at: LATER,
	...over,
});

const codes = (world: World) =>
	world.all(
		"SELECT nonce_hash,email,code_hash,attempts,used_at,session_token_hash,expires_at FROM audio_client_signin_codes ORDER BY email,nonce_hash",
	);

const audit = (world: World) =>
	world.all(
		"SELECT request_id,action,occurred_at FROM audio_client_access_audit ORDER BY id",
	);

const sessions = (world: World) =>
	world.all(
		"SELECT token_hash,email,created_at,expires_at,last_seen_at,revoked_at FROM audio_client_sessions",
	);

describe("the code request's read", () => {
	it("reads the address's projects that are not closed, withdrawn or not, in id order, and only the address's codes", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [
				request("r2"),
				request("r1", { status: "withdrawn" }),
				request("r3"),
				rows.ownerRequest("r9", { email: OTHER }),
			],
			audio_client_signin_codes: [
				code(OWN),
				code(THEIRS, { used_at: EARLIER }),
				code(OWN, { email: OTHER }),
			],
		});
		world.sql
			.prepare("UPDATE audio_projects SET revoked_at=? WHERE request_id='r3'")
			.run(NOW);

		expect(await world.ok(readIssueFacts(ADDRESS))).toEqual({
			projects: [
				{ requestId: "r1", withdrawn: true },
				{ requestId: "r2", withdrawn: false },
			],
			codes: [
				{
					nonceHash: OWN,
					email: ADDRESS,
					codeHash: `code-${OWN}`,
					usedAt: null,
					expiresAt: LATER,
				},
				{
					nonceHash: THEIRS,
					email: ADDRESS,
					codeHash: `code-${THEIRS}`,
					usedAt: EARLIER,
					expiresAt: LATER,
				},
			],
		});
	});

	it("reads a software project whose content is kept, and not one whose content is deleted", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [
				rows.softwareRequest("s1", { email: ADDRESS }),
				rows.softwareRequest("s2", { email: ADDRESS }),
			],
			software_offers: [
				rows.softwareOffer("o1", "s1"),
				rows.softwareOffer("o2", "s2"),
			],
			software_projects: [
				rows.softwareProject("s1", "o1"),
				rows.softwareProject("s2", "o2", { content_deleted_at: EARLIER }),
			],
		});

		expect((await world.ok(readIssueFacts(ADDRESS))).projects).toEqual([
			{ requestId: "s1", withdrawn: false },
		]);
	});
});

describe("the sweep", () => {
	it("deletes the rows named while each is still expired and holds the code read (C3), and no row of another address", async () => {
		const world = signinWorld();

		world.seed({
			audio_client_signin_codes: [
				code("1".repeat(64), { expires_at: NOW }),
				// Replaced since the read: it holds another code now, so it stays.
				code("2".repeat(64), { expires_at: EARLIER, code_hash: "fresh" }),
				code("3".repeat(64), { expires_at: EARLIER }),
				// Named, but not expired at the time bound: it stays.
				code("4".repeat(64)),
				code("1".repeat(64), { email: OTHER, expires_at: EARLIER }),
			],
		});

		await world.ok(
			sweepExpired({
				address: ADDRESS,
				at: NOW,
				sweep: {
					expired: ["1", "2", "4"].map((digit) => ({
						nonceHash: digit.repeat(64),
						codeHash: `code-${digit.repeat(64)}`,
					})),
				},
			}),
		);

		expect(codes(world).map((row) => [row.email, row.nonce_hash])).toEqual([
			[OTHER, "1".repeat(64)],
			[ADDRESS, "2".repeat(64)],
			[ADDRESS, "3".repeat(64)],
			[ADDRESS, "4".repeat(64)],
		]);
	});

	it("deletes nothing when nothing is named", async () => {
		const world = signinWorld();

		world.seed({
			audio_client_signin_codes: [code(OWN, { expires_at: EARLIER })],
		});
		await world.ok(
			sweepExpired({ address: ADDRESS, at: NOW, sweep: { expired: [] } }),
		);

		expect(codes(world)).toHaveLength(1);
	});
});

describe("the issue's write", () => {
	const issued = {
		address: ADDRESS,
		nonceHash: OWN,
		codeHash: "new-code",
		issuedAt: NOW,
		expiresAt: LATER,
	};

	it("replaces the browser's row with the new code and audits each project still open", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1"), request("r2", { status: "withdrawn" })],
			audio_client_signin_codes: [
				code(OWN, { attempts: 3, used_at: EARLIER }),
				code(THEIRS),
			],
		});

		await world.ok(
			writeIssue({
				...issued,
				issue: {
					auditRequestIds: ["r1", "r2", "gone"],
					liveOthersBelow: LIVE_CODES_PER_ADDRESS,
				},
			}),
		);

		expect(codes(world)).toEqual([
			{
				nonce_hash: OWN,
				email: ADDRESS,
				code_hash: "new-code",
				attempts: 0,
				used_at: null,
				session_token_hash: null,
				expires_at: LATER,
			},
			expect.objectContaining({ nonce_hash: THEIRS }),
		]);
		expect(audit(world).filter((row) => row.action === "code-issued")).toEqual([
			{ request_id: "r1", action: "code-issued", occurred_at: NOW },
			{ request_id: "r2", action: "code-issued", occurred_at: NOW },
		]);
	});

	it("writes nothing when the rule refused, though every statement runs", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN)],
		});
		await world.ok(writeIssue({ ...issued, issue: null }));

		expect(codes(world)).toEqual([
			expect.objectContaining({ nonce_hash: OWN, code_hash: `code-${OWN}` }),
		]);
		expect(audit(world)).toEqual([]);
		expect(world.batches).toHaveLength(1);
		expect(world.batches[0]).toHaveLength(4);
	});

	it("is GuardRefused and writes nothing when no project is open any more (C1)", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1", { status: "withdrawn" })],
		});

		expect(
			await world.failed(
				writeIssue({
					...issued,
					issue: { auditRequestIds: ["r1"], liveOthersBelow: 6 },
				}),
			),
		).toBeInstanceOf(GuardRefused);
		expect(codes(world)).toEqual([]);
		expect(audit(world)).toEqual([]);
	});

	it("is GuardRefused when the address's other live codes reached the cap (C2), counting only unused, unexpired codes of other browsers", async () => {
		const world = signinWorld();
		const others = ["1", "2", "3", "4", "5"].map((digit) => digit.repeat(64));

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [
				...others.map((other) => code(other)),
				code(OWN),
				code("6".repeat(64), { used_at: EARLIER }),
				code("7".repeat(64), { expires_at: NOW }),
				code("8".repeat(64), { email: OTHER }),
			],
		});

		const write = {
			...issued,
			issue: { auditRequestIds: ["r1"], liveOthersBelow: 6 },
		};

		// Five others: under the cap.
		await world.ok(writeIssue(write));

		world.seed({ audio_client_signin_codes: [code("9".repeat(64))] });

		expect(await world.failed(writeIssue(write))).toBeInstanceOf(GuardRefused);
	});
});

describe("the discard", () => {
	const key = { address: ADDRESS, nonceHash: OWN, codeHash: `code-${OWN}` };

	it("reads the code's used_at and the address's projects", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN, { used_at: EARLIER })],
		});

		expect(await world.ok(readDiscardFacts(key))).toEqual({
			code: { usedAt: EARLIER },
			projects: [{ requestId: "r1", withdrawn: false }],
		});
		expect(
			await world.ok(readDiscardFacts({ ...key, codeHash: "another" })),
		).toEqual({
			code: null,
			projects: [{ requestId: "r1", withdrawn: false }],
		});
	});

	it("deletes the unused code and audits each project still open", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN), code(THEIRS)],
		});
		await world.ok(
			writeDiscard({
				...key,
				at: NOW,
				discard: { auditRequestIds: ["r1", "gone"] },
			}),
		);

		expect(codes(world).map((row) => row.nonce_hash)).toEqual([THEIRS]);
		expect(audit(world)).toEqual([
			{ request_id: "r1", action: "code-delivery-failed", occurred_at: NOW },
		]);
	});

	it("is GuardRefused and writes nothing when the code was used or replaced since it was read (C8)", async () => {
		for (const stored of [
			code(OWN, { used_at: EARLIER }),
			code(OWN, { code_hash: "replaced" }),
		]) {
			const world = signinWorld();

			world.seed({
				owner_requests: [request("r1")],
				audio_client_signin_codes: [stored],
			});

			expect(
				await world.failed(
					writeDiscard({
						...key,
						at: NOW,
						discard: { auditRequestIds: ["r1"] },
					}),
				),
			).toBeInstanceOf(GuardRefused);
			expect(codes(world)).toHaveLength(1);
			expect(audit(world)).toEqual([]);
		}
	});
});

describe("the entry", () => {
	const key = { address: ADDRESS, nonceHash: OWN };

	const entered = {
		...key,
		readHash: `code-${OWN}`,
		at: NOW,
		tokenHash: TOKEN,
		sessionExpiresAt: SESSION_ENDS,
	};

	it("reads the browser's own row for the address and the address's projects", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [
				code(OWN, { attempts: 2 }),
				code(THEIRS),
				code(OWN, { email: OTHER }),
			],
		});

		expect(await world.ok(readEntryFacts(key))).toEqual({
			code: {
				attempts: 2,
				usedAt: null,
				expiresAt: LATER,
				codeHash: `code-${OWN}`,
			},
			projects: [{ requestId: "r1", withdrawn: false }],
		});
		expect(
			(await world.ok(readEntryFacts({ ...key, nonceHash: "c".repeat(64) })))
				.code,
		).toBeNull();
	});

	it("accepts a right code: counts the attempt, marks it used, makes the session and audits it", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN)],
		});

		expect(
			await world.ok(
				writeEntry({
					...entered,
					entry: { accept: true, auditRequestIds: ["r1"] },
				}),
			),
		).toEqual({ accepted: true });
		expect(codes(world)).toEqual([
			expect.objectContaining({
				attempts: 1,
				used_at: NOW,
				session_token_hash: TOKEN,
			}),
		]);
		expect(sessions(world)).toEqual([
			{
				token_hash: TOKEN,
				email: ADDRESS,
				created_at: NOW,
				expires_at: SESSION_ENDS,
				last_seen_at: NOW,
				revoked_at: null,
			},
		]);
		expect(audit(world)).toEqual([
			{ request_id: "r1", action: "signed-in", occurred_at: NOW },
		]);
	});

	it("counts a refused attempt and makes no session", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN)],
		});

		expect(
			await world.ok(
				writeEntry({
					...entered,
					entry: { accept: false, auditRequestIds: ["r1"] },
				}),
			),
		).toEqual({ accepted: false });
		expect(codes(world)).toEqual([
			expect.objectContaining({ attempts: 1, used_at: null }),
		]);
		expect(sessions(world)).toEqual([]);
		expect(audit(world)).toEqual([]);
	});

	it("changes nothing when the machine refused, though every statement runs", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1")],
			audio_client_signin_codes: [code(OWN)],
		});

		expect(await world.ok(writeEntry({ ...entered, entry: null }))).toEqual({
			accepted: false,
		});
		expect(codes(world)).toEqual([
			expect.objectContaining({ attempts: 0, used_at: null }),
		]);
		expect(world.batches).toEqual([
			[
				expect.any(String),
				expect.any(String),
				expect.any(String),
				expect.any(String),
			],
		]);
	});

	it("accepts nothing when the guards no longer hold at write time (C4, C5)", async () => {
		const cases: [string, ReturnType<typeof code>, string?][] = [
			[
				"the attempts reached the limit",
				code(OWN, { attempts: ATTEMPTS_PER_CODE }),
			],
			["the code expired", code(OWN, { expires_at: NOW })],
			["the code was used", code(OWN, { used_at: EARLIER })],
			["the row holds another code", code(OWN, { code_hash: "replaced" })],
		];

		for (const [name, stored] of cases) {
			const world = signinWorld();

			world.seed({
				owner_requests: [request("r1")],
				audio_client_signin_codes: [stored],
			});

			expect(
				await world.ok(
					writeEntry({
						...entered,
						entry: { accept: true, auditRequestIds: ["r1"] },
					}),
				),
				name,
			).toEqual({ accepted: false });
			expect(sessions(world), name).toEqual([]);
			expect(audit(world), name).toEqual([]);
		}
	});

	it("counts the attempt but accepts nothing when no project is open at write time (C5 with C1)", async () => {
		const world = signinWorld();

		world.seed({
			owner_requests: [request("r1", { status: "withdrawn" })],
			audio_client_signin_codes: [code(OWN)],
		});

		expect(
			await world.ok(
				writeEntry({
					...entered,
					entry: { accept: true, auditRequestIds: ["r1"] },
				}),
			),
		).toEqual({ accepted: false });
		expect(codes(world)).toEqual([
			expect.objectContaining({ attempts: 1, used_at: null }),
		]);
		expect(sessions(world)).toEqual([]);
	});
});

describe("the allowance", () => {
	const at = (time: string) => allowanceTimes(new Date(time));

	it("counts each use of a key in its window, and other keys apart", async () => {
		const world = signinWorld();

		expect(await world.ok(countAllowance("k1", at(NOW)))).toEqual({
			uses: 1,
			window_start: NOW,
		});
		// A later use in the same window answers the window's start, not its own time.
		expect(
			await world.ok(countAllowance("k1", at("2026-11-13T12:01:00.000Z"))),
		).toEqual({ uses: 2, window_start: NOW });
		expect(await world.ok(countAllowance("k2", at(NOW)))).toEqual({
			uses: 1,
			window_start: NOW,
		});
		expect(
			world.all("SELECT key,window_start,uses FROM audio_client_allowances"),
		).toEqual([
			{ key: "k1", window_start: NOW, uses: 2 },
			{ key: "k2", window_start: NOW, uses: 1 },
		]);
	});

	/** A database whose counting batch answers `counted` as the upsert's rows, after the prune's empty result. */
	const counting = (
		counted: readonly { uses: null; window_start: string }[],
	) => {
		const statement = double<D1PreparedStatement>({});
		statement.bind = () => statement;

		return double<D1Database>({
			prepare: () => statement,
			batch: async <T>() => [
				partial<D1Result<T>>({ results: [] }),
				partial<D1Result<T>>({
					// SAFETY: T is the row type the store asks for ({ uses, window_start }); these rows are that shape with no count.
					results: [...counted] as T[],
				}),
			],
		});
	};

	it("answers no count when the counted row comes back without one, so the rule refuses it", async () => {
		expect(
			await Effect.runPromise(
				countAllowance("k1", at(NOW)).pipe(
					Effect.provideService(
						MusicDb,
						counting([{ uses: null, window_start: NOW }]),
					),
				),
			),
		).toEqual({ uses: null, window_start: NOW });
	});

	it("answers no count and no window when no row comes back", async () => {
		expect(
			await Effect.runPromise(
				countAllowance("k1", at(NOW)).pipe(
					Effect.provideService(MusicDb, counting([])),
				),
			),
		).toEqual({ uses: null, window_start: null });
	});

	it("prunes a window exactly five minutes old, and keeps one a millisecond younger", async () => {
		const world = signinWorld();

		await world.ok(countAllowance("k1", at(NOW)));

		expect(
			await world.ok(countAllowance("k1", at("2026-11-13T12:04:59.999Z"))),
		).toEqual({ uses: 2, window_start: NOW });
		expect(
			await world.ok(countAllowance("k1", at("2026-11-13T12:05:00.000Z"))),
		).toEqual({ uses: 1, window_start: "2026-11-13T12:05:00.000Z" });
	});
});

describe("sign-out", () => {
	it("revokes the session once, and keeps the first time on a second sign-out (C9)", async () => {
		const world = signinWorld();

		world.seed({
			audio_client_sessions: [
				{
					token_hash: TOKEN,
					email: ADDRESS,
					created_at: EARLIER,
					expires_at: SESSION_ENDS,
					last_seen_at: EARLIER,
				},
			],
		});

		await world.ok(revokeSession(TOKEN, NOW));
		await world.ok(revokeSession(TOKEN, LATER));
		await world.ok(revokeSession("unknown", NOW));

		expect(sessions(world)).toEqual([
			expect.objectContaining({ token_hash: TOKEN, revoked_at: NOW }),
		]);
	});
});

describe("failures", () => {
	it("is StudioSigninStoreFailed, carrying what the database raised, for a rejected read, batch or statement", async () => {
		const runs = [
			readIssueFacts(ADDRESS),
			sweepExpired({ address: ADDRESS, at: NOW, sweep: { expired: [] } }),
			writeIssue({
				address: ADDRESS,
				nonceHash: OWN,
				codeHash: "c",
				issuedAt: NOW,
				expiresAt: LATER,
				issue: null,
			}),
			readDiscardFacts({ address: ADDRESS, nonceHash: OWN, codeHash: "c" }),
			writeDiscard({
				address: ADDRESS,
				nonceHash: OWN,
				codeHash: "c",
				at: NOW,
				discard: { auditRequestIds: [] },
			}),
			readEntryFacts({ address: ADDRESS, nonceHash: OWN }),
			writeEntry({
				address: ADDRESS,
				nonceHash: OWN,
				readHash: "",
				at: NOW,
				tokenHash: TOKEN,
				sessionExpiresAt: SESSION_ENDS,
				entry: null,
			}),
			countAllowance("k", allowanceTimes(new Date(NOW))),
			revokeSession(TOKEN, NOW),
		];

		for (const effect of runs) {
			const failure = await signinWorld(/audio_client/).failed(effect);

			expect(failure).toBeInstanceOf(StudioSigninStoreFailed);
			expect(
				failure instanceof StudioSigninStoreFailed && failure.failure,
			).toEqual(new Error("d1 down"));
		}
	});

	it("is StudioSigninStoreFailed, not GuardRefused, when a guarded batch fails for another reason", async () => {
		const world = signinWorld();

		// The guard holds (the unused code is there), and the audit insert after it fails.
		world.seed({ audio_client_signin_codes: [code(OWN, { code_hash: "c" })] });
		world.sql.exec("DROP TABLE audio_client_access_audit");

		expect(
			await world.failed(
				writeDiscard({
					address: ADDRESS,
					nonceHash: OWN,
					codeHash: "c",
					at: NOW,
					discard: { auditRequestIds: [] },
				}),
			),
		).toBeInstanceOf(StudioSigninStoreFailed);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The store's SQL against the golden corpora of the three routes.

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly { readonly sql: string }[];
};

/** Every recorded batch (its statements' SQL, in order, as JSON) and every statement run alone, in the three corpora. */
function recorded() {
	const batches = new Set<string>();
	const singles = new Set<string>();

	for (const corpus of ["studio-code", "studio-session", "studio-sign-out"]) {
		// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases, each with its list of effects.
		const cases = JSON.parse(
			gunzipSync(
				readFileSync(
					new URL(`../golden/fixtures/${corpus}.json.gz`, import.meta.url),
				),
			).toString("utf8"),
		) as { effects: RecordedEffect[] }[];

		for (const recordedCase of cases)
			for (const effect of recordedCase.effects) {
				if (effect.kind === "d1-batch" && effect.statements)
					batches.add(
						JSON.stringify(effect.statements.map((statement) => statement.sql)),
					);

				if (effect.kind === "d1" && effect.sql !== undefined)
					singles.add(effect.sql);
			}
	}

	return { batches, singles };
}

/**
 * Runs every sign-in route function once, each in a world of its own, and gives the batches and statements they ran.
 */
async function tour() {
	const runs = [
		readIssueFacts(ADDRESS),
		sweepExpired({ address: ADDRESS, at: NOW, sweep: { expired: [] } }),
		writeIssue({
			address: ADDRESS,
			nonceHash: OWN,
			codeHash: "c",
			issuedAt: NOW,
			expiresAt: LATER,
			issue: null,
		}),
		readDiscardFacts({ address: ADDRESS, nonceHash: OWN, codeHash: "c" }),
		writeDiscard({
			address: ADDRESS,
			nonceHash: OWN,
			codeHash: "c",
			at: NOW,
			discard: { auditRequestIds: [] },
		}),
		readEntryFacts({ address: ADDRESS, nonceHash: OWN }),
		writeEntry({
			address: ADDRESS,
			nonceHash: OWN,
			readHash: "",
			at: NOW,
			tokenHash: TOKEN,
			sessionExpiresAt: SESSION_ENDS,
			entry: null,
		}),
		countAllowance("k", allowanceTimes(new Date(NOW))),
	];

	const batches = new Set<string>();

	for (const effect of runs) {
		const world = signinWorld();

		world.seed({ audio_client_signin_codes: [code(OWN, { code_hash: "c" })] });
		await world.ok(Effect.ignore(effect));

		for (const batch of world.batches) batches.add(JSON.stringify(batch));
	}

	const alone = signinWorld();

	await alone.ok(revokeSession(TOKEN, NOW));

	return { batches, singles: new Set(alone.prepared) };
}

describe("the store's SQL against the golden corpora", () => {
	it("runs every batch the corpora recorded, and only those, with the statements in the same order", async () => {
		const ran = await tour();
		const corpora = recorded();

		expect(ran.batches.size).toBe(8);
		expect([...ran.batches].sort()).toEqual([...corpora.batches].sort());
	});

	it("runs sign-out's one statement as the corpus recorded it", async () => {
		const ran = await tour();

		expect([...ran.singles]).toEqual([...recorded().singles]);
	});
});
