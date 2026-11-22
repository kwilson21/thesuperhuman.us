import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newPendingNonce } from "../../src/lib/audio-client-access";
import { hashValue } from "../../src/lib/client-portal";
import {
	AgreementAllowance,
	liveAgreementAllowance,
} from "../../src/server/agreement-services";
import {
	type CodeRequest,
	requestCode,
} from "../../src/server/flows/signin-code";
import { signIn } from "../../src/server/flows/signin-session";
import { signOut } from "../../src/server/flows/signin-sign-out";
import {
	liveBackground,
	Mail,
	MailRefused,
	MailUncertain,
	MusicDb,
	Turnstile,
} from "../../src/server/services";
import { liveSigninKeys } from "../../src/server/signin-services";
import { boundStatement } from "../helpers/d1";
import { double } from "../helpers/doubles";
import { musicWorld } from "../helpers/music-world";

// The studio sign-in flows as stories (docs/plans/2026-11-studio-signin-conversion.md, section 3), on the real schema: the
// order of the clock readings and the batches, a guard that no longer holds at the issue's write, a refused email and a
// discard that fails, the token every entry makes, and a code key too short to use. The captcha, the mail and the clock
// are doubles, and every batch and clock reading is written to one log, in order.

const SECRET = "k".repeat(40);
const ADDRESS = "grace@example.test";
const T = new Date("2026-11-13T12:00:00.000Z");
const PENDING = "a".repeat(64);

type Log = string[];

/** A short name for a batch: its first statement's opening words. */
const batchName = (items: D1PreparedStatement[]) =>
	boundStatement(items[0]).query.trim().split(/\s+/).slice(0, 3).join(" ");

/** The world's database, writing each batch to `log` before it runs. */
const logged = (db: D1Database, log: Log) =>
	double<D1Database>({
		prepare: (query: string) => db.prepare(query),
		batch: <T>(items: D1PreparedStatement[]) => {
			log.push(`batch ${batchName(items)}`);

			return db.batch<T>(items);
		},
	});

const seedProject = (world: ReturnType<typeof musicWorld>, id = "r1") => {
	world.sql
		.prepare(
			"INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES(?,'service',?,'A song','new',?,?)",
		)
		.run(id, ADDRESS, T.toISOString(), T.toISOString());
};

type Mailed = "sent" | "refused" | "uncertain";

const services = (
	db: D1Database,
	log: Log,
	options: { mail?: Mailed; codeKey?: string } = {},
) =>
	Context.make(MusicDb, db).pipe(
		Context.merge(liveSigninKeys(options.codeKey ?? SECRET)),
		Context.merge(liveBackground(undefined)),
		Context.add(Turnstile, { verify: () => Effect.void }),
		Context.add(Mail, {
			send: (message) =>
				Effect.suspend(() => {
					log.push(`mail ${message.to.join(",")}`);

					switch (options.mail ?? "sent") {
						case "sent":
							return Effect.void;
						case "refused":
							return Effect.fail(new MailRefused());
						case "uncertain":
							return Effect.fail(new MailUncertain());
					}
				}),
		}),
	);

const clock = (log: Log) => () => {
	log.push("clock");

	return T;
};

/** A code request in `log`'s world: the outcome's tag, or the cookie value and how the issue ended. */
const ask = (
	db: D1Database,
	log: Log,
	options: { mail?: Mailed; codeKey?: string; pending?: string | null } = {},
) => {
	const request: CodeRequest = {
		address: ADDRESS,
		turnstileToken: "token",
		ip: "203.0.113.7",
		pending: options.pending === undefined ? PENDING : options.pending,
		from: "studio@example.test",
		now: clock(log),
		newCode: () => "12345678",
		newNonce: newPendingNonce,
	};

	return Effect.runPromise(
		requestCode(request).pipe(
			Effect.match({
				onFailure: (failure) => ({ failed: failure._tag }),
				onSuccess: (answer) => answer,
			}),
			Effect.provideContext(services(db, log, options)),
		),
	);
};

const codeRows = (world: ReturnType<typeof musicWorld>) =>
	world.sql
		.prepare("SELECT email,used_at FROM audio_client_signin_codes")
		.all();

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a code request", () => {
	it("reads the clock at each allowance and once before the issue's read, then emails an issued code", async () => {
		const world = musicWorld();
		const log: Log = [];

		seedProject(world);

		expect(await ask(logged(world.db, log), log)).toEqual({
			outcome: "issued",
			pending: PENDING,
		});
		expect(log).toEqual([
			"clock",
			"batch DELETE FROM audio_client_allowances",
			"clock",
			"batch DELETE FROM audio_client_allowances",
			"clock",
			"batch SELECT p.request_id AS",
			"batch DELETE FROM audio_client_signin_codes",
			"batch SELECT CASE WHEN",
			`mail ${ADDRESS}`,
		]);
	});

	it("makes the same three batches for an address with no project, emails nothing, and gives a new browser a fresh value", async () => {
		const world = musicWorld();
		const log: Log = [];

		const answer = await ask(logged(world.db, log), log, { pending: null });

		expect(answer).toMatchObject({ outcome: "NoOpenProject" });
		expect("pending" in answer && /^[0-9a-f]{64}$/.test(answer.pending)).toBe(
			true,
		);
		expect(log.filter((entry) => entry.startsWith("batch")).slice(2)).toEqual([
			"batch SELECT p.request_id AS",
			"batch DELETE FROM audio_client_signin_codes",
			"batch SELECT CASE WHEN",
		]);
		expect(log.some((entry) => entry.startsWith("mail"))).toBe(false);
		expect(codeRows(world)).toEqual([]);
	});

	it("answers a guard that no longer holds at the write like a refusal, with the browser's value, and does not retry", async () => {
		const log: Log = [];

		// The project closes between the issue's read and its write: C1 raises.
		const world = musicWorld({
			beforeStatement: [
				/SELECT CASE WHEN \?=0/,
				() =>
					world.sql.exec(
						"UPDATE audio_projects SET revoked_at='2026-11-13T12:00:00.000Z'",
					),
			],
		});

		seedProject(world);

		expect(await ask(logged(world.db, log), log)).toEqual({
			outcome: "GuardRefused",
			pending: PENDING,
		});
		expect(log.filter((entry) => entry === "batch SELECT CASE WHEN")).toEqual([
			"batch SELECT CASE WHEN",
		]);
		expect(log.some((entry) => entry.startsWith("mail"))).toBe(false);
		expect(codeRows(world)).toEqual([]);
	});

	it("discards the code when Resend refuses its email, reading the clock after the email", async () => {
		const world = musicWorld();
		const log: Log = [];

		seedProject(world);

		expect(
			await ask(logged(world.db, log), log, { mail: "refused" }),
		).toMatchObject({ outcome: "issued" });
		expect(log.slice(-4)).toEqual([
			`mail ${ADDRESS}`,
			"clock",
			"batch SELECT used_at AS",
			"batch SELECT CASE WHEN",
		]);
		expect(codeRows(world)).toEqual([]);
		expect(
			world.sql
				.prepare("SELECT action FROM audio_client_access_audit ORDER BY id")
				.all(),
		).toEqual([{ action: "code-issued" }, { action: "code-delivery-failed" }]);
	});

	it("keeps the code when the email's fate is uncertain", async () => {
		const world = musicWorld();
		const log: Log = [];

		seedProject(world);

		await ask(logged(world.db, log), log, { mail: "uncertain" });
		expect(log.at(-1)).toBe(`mail ${ADDRESS}`);
		expect(codeRows(world)).toEqual([{ email: ADDRESS, used_at: null }]);
	});

	it("logs the fixed line when the discard's read fails, and still answers the generic outcome", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});

		const world = musicWorld({
			beforeStatement: [
				/SELECT used_at AS usedAt/,
				() => {
					throw new Error("d1 down");
				},
			],
		});

		seedProject(world);

		expect(await ask(world.db, [], { mail: "refused" })).toMatchObject({
			outcome: "issued",
			pending: PENDING,
		});
		expect(errors.mock.calls).toEqual([
			["Studio code delivery or cleanup failed."],
		]);
		expect(codeRows(world)).toEqual([{ email: ADDRESS, used_at: null }]);
	});

	it("fails at the first keyed hash, before any statement, when the code key is under 32 characters", async () => {
		const world = musicWorld();
		const log: Log = [];

		expect(
			await ask(logged(world.db, log), log, { codeKey: "k".repeat(31) }),
		).toEqual({ failed: "CodeKeyUnusable" });
		expect(log.filter((entry) => entry !== "clock")).toEqual([]);
	});
});

describe("a code entry", () => {
	const enter = (
		db: D1Database,
		log: Log,
		code: string,
		pending: string | null = PENDING,
	) => {
		let tokens = 0;

		return Effect.runPromise(
			signIn({
				address: ADDRESS,
				code,
				pending,
				ip: "203.0.113.7",
				now: clock(log),
				newToken: () => {
					tokens += 1;

					return `${"0".repeat(36)}${String(tokens).padStart(36, "0")}`;
				},
			}).pipe(
				Effect.match({
					onFailure: (failure) => ({ failed: failure._tag, tokens }),
					onSuccess: (token) => ({ token, tokens }),
				}),
				Effect.provideContext(services(db, log)),
			),
		);
	};

	it("reads and counts nothing without a well-formed pending value", async () => {
		const world = musicWorld();
		const log: Log = [];

		for (const pending of [null, "A".repeat(64), "short"])
			expect(
				await enter(logged(world.db, log), log, "12345678", pending),
			).toEqual({ failed: "NoCodeToTry", tokens: 0 });
		expect(log).toEqual([]);
	});

	it("makes and hashes a token whatever the code's state, and runs the same two batches", async () => {
		const world = musicWorld();
		const log: Log = [];

		seedProject(world);

		// No code yet: the machine refuses ENTER, and the write still runs, bound to match no row.
		expect(await enter(logged(world.db, log), log, "12345678")).toEqual({
			failed: "NoCodeToTry",
			tokens: 1,
		});
		expect(log).toEqual([
			"clock",
			"batch DELETE FROM audio_client_allowances",
			"clock",
			"batch DELETE FROM audio_client_allowances",
			"clock",
			"batch SELECT attempts,used_at AS",
			"batch UPDATE audio_client_signin_codes SET",
		]);

		await ask(world.db, []);

		// A wrong code: counted, not accepted.
		expect(await enter(world.db, [], "87654321")).toEqual({
			failed: "CodeNotAccepted",
			tokens: 1,
		});

		// The right one.
		expect(await enter(world.db, [], "12345678")).toEqual({
			token: `${"0".repeat(36)}${"1".padStart(36, "0")}`,
			tokens: 1,
		});
		expect(
			world.sql
				.prepare("SELECT attempts,used_at FROM audio_client_signin_codes")
				.all(),
		).toEqual([{ attempts: 2, used_at: T.toISOString() }]);
	});
});

describe("sign-out", () => {
	it("revokes a session once, keeping the first time, and touches nothing for a token that is not well formed", async () => {
		const log: Log = [];

		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_client_sessions/,
				() => log.push("revoke"),
			],
		});

		const token = `${"ab".repeat(18)}${"cd".repeat(18)}`;

		const run = (value: string | null, at: Date) =>
			Effect.runPromise(
				signOut({ token: value, now: () => at }).pipe(
					Effect.provideContext(services(world.db, log)),
				),
			);

		world.sql
			.prepare(
				"INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)",
			)
			.run(
				await hashValue(token),
				ADDRESS,
				T.toISOString(),
				"2026-11-27T12:00:00.000Z",
				T.toISOString(),
			);

		await run(null, T);
		await run("x".repeat(72), T);
		expect(log).toEqual([]);

		await run(token, T);
		await run(token, new Date(T.getTime() + 60_000));
		expect(log).toEqual(["revoke", "revoke"]);
		expect(
			world.sql.prepare("SELECT revoked_at FROM audio_client_sessions").all(),
		).toEqual([{ revoked_at: T.toISOString() }]);
	});
});

describe("the agreement link's allowance", () => {
	it("counts with the sign-in allowance's statements and refuses past the limit", async () => {
		const world = musicWorld();
		const log: Log = [];

		const allowance = Context.get(
			liveAgreementAllowance(logged(world.db, log), SECRET),
			AgreementAllowance,
		);

		const reserve = () =>
			Effect.runPromise(allowance.reserve("archive-ip", "203.0.113.7", 2));

		expect([await reserve(), await reserve(), await reserve()]).toEqual([
			true,
			true,
			false,
		]);
		expect(log).toEqual(
			Array.from(
				{ length: 3 },
				() => "batch DELETE FROM audio_client_allowances",
			),
		);
		expect(
			world.sql.prepare("SELECT uses FROM audio_client_allowances").all(),
		).toEqual([{ uses: 3 }]);
	});
});
