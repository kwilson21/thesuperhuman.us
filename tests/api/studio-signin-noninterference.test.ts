import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boundStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";
import { POST as requestCode } from "~/pages/api/studio/code";
import { POST as completeCode } from "~/pages/api/studio/session";
import { hashValue } from "~/lib/audio-client-access";
import { revokeProjectAccess } from "~/lib/audio-project-revocation";
import {
	applyStudioRetention,
	previewStudioRetention,
} from "../../scripts/studio-retention.mjs";

// Non-interference of the sign-in codes between addresses, checked by enumeration. A request for one address (the target) must not
// change anything an attacker who controls another address (and its cookie) can observe. For every ordering of the database batches
// of the concurrent requests (and of a completion, a revocation or a retention sweep), the test runs the same scenario once per
// target state (open project, closed, withdrawn, none, full) and asserts that everything the attacker can observe is identical
// across the target states: each answer's status, body and cookie, the emails sent to the attacker's addresses, and whether each
// of the attacker's own codes works afterwards. The three-request sets are large, so `pnpm test` runs a deterministic sample of
// them; set SIGNIN_EXHAUSTIVE=1 for every ordering.

const exhaustive = process.env.SIGNIN_EXHAUSTIVE === "1";
const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);
const SECRET = "a".repeat(32);
const PN = "__Host-studio_pending";
const ORIGIN = "https://thesuperhuman.us";

const ADDR = {
	client: "a@example.com",
	client2: "a2@example.com",
	stranger: "s@example.com",
	stranger2: "s2@example.com",
	open: "open@example.com",
	closed: "closed@example.com",
	withdrawn: "withdrawn@example.com",
	none: "none@example.com",
	full: "full@example.com",
};

const TARGETS = ["open", "closed", "withdrawn", "none", "full"] as const;
type Target = (typeof TARGETS)[number];
const K1 = "1".repeat(64);
const K2 = "2".repeat(64);

let sql: InstanceType<typeof DatabaseSync>;
let db: D1Database;
let mails: { to: string; text: string }[] = [];
let background: Promise<unknown>[] = [];
let ipCounter = 0;

function addProject(id: string, email: string, status = "new") {
	sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('${id}','service','${email}','Song','${status}','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);
}

function fresh() {
	sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);
	for (const [id, email] of [
		["p-client", ADDR.client],
		["p-client2", ADDR.client2],
		["p-open", ADDR.open],
		["p-closed", ADDR.closed],
		["p-full", ADDR.full],
	])
		addProject(id, email);
	addProject("p-withdrawn", ADDR.withdrawn, "withdrawn");
	sql.exec(
		"UPDATE audio_projects SET revoked_at='2026-01-01T00:00:00Z' WHERE request_id='p-closed'",
	);

	for (let index = 0; index < 6; index++)
		sql
			.prepare(
				`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at) VALUES (?,?,?,0,?,?)`,
			)
			.run(
				`full${index}`,
				ADDR.full,
				`c${index}`,
				new Date().toISOString(),
				new Date(Date.now() + 600_000).toISOString(),
			);

	db = sqliteD1(sql);
	mails = [];
	background = [];
	ipCounter = 0;
}

// ---- the scheduler: a script of labels; a step runs only when its label is next ----
let script: string[] = [];
const waiters = new Map<string, () => void>();

function pump() {
	const waiting = waiters.get(script[0]);

	if (waiting) {
		waiters.delete(script[0]);
		waiting();
	}
}

const gate = (label: string) =>
	new Promise<void>((resolve) => {
		waiters.set(label, resolve);
		pump();
	});

function done() {
	script.shift();
	pump();
}

function kindOf(items: D1PreparedStatement[]): string | null {
	const first = boundStatement(items[0]).query;

	if (first.includes("AS requestId") && items.length === 2) return "r";
	if (/^\s*SELECT CASE WHEN \?=0/i.test(first)) return "w";
	if (/^\s*DELETE FROM audio_client_signin_codes/i.test(first)) return "c";
	if (/^\s*SELECT attempts/i.test(first)) return "cr";
	if (/^\s*UPDATE audio_client_signin_codes SET attempts/i.test(first))
		return "cw";

	return null;
}

function scripted(who: string, gated = true) {
	return double<D1Database>({
		prepare: (query: string) => db.prepare(query),
		batch: async (items: D1PreparedStatement[]) => {
			const kind = kindOf(items);

			if (kind === null || !gated) return db.batch(items);

			await gate(`${who}.${kind}`);

			try {
				return await db.batch(items);
			} finally {
				done();
			}
		},
	});
}

function context(
	path: string,
	body: Record<string, string>,
	cookie: string | undefined,
	database: D1Database,
): APIContext {
	const headers = new Headers({
		origin: ORIGIN,
		"content-type": "application/json",
	});

	if (cookie) headers.set("cookie", `${PN}=${cookie}`);
	headers.set("cf-connecting-ip", `198.51.100.${(ipCounter++ % 250) + 1}`);

	return partial<APIContext>({
		request: new Request(`${ORIGIN}${path}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		locals: {
			runtime: {
				ctx: { waitUntil: (work: Promise<unknown>) => background.push(work) },
				env: {
					AUDIO_CLIENT_PORTAL_ENABLED: "true",
					AUDIO_CLIENT_CODE_KEY: SECRET,
					MUSIC_DB: database,
					TURNSTILE_SECRET_KEY: "t",
					RESEND_API_KEY: "t",
					CONTACT_FROM_EMAIL: "noreply@example.com",
					SITE_ORIGIN: ORIGIN,
				},
			},
		},
	} as unknown as Partial<APIContext>);
}

const ask = (
	who: string,
	email: string,
	cookie: string | undefined,
	gated = true,
) =>
	requestCode(
		context(
			"/api/studio/code",
			{ email, turnstileToken: "ok" },
			cookie,
			scripted(who, gated),
		),
	);

const enter = (
	who: string,
	email: string,
	code: string,
	cookie: string | undefined,
	gated = true,
) =>
	completeCode(
		context(
			"/api/studio/session",
			{ email, code },
			cookie,
			scripted(who, gated),
		),
	);

const flush = async () => {
	while (background.length) await Promise.all(background.splice(0));
};

const codeIn = (mail: { text: string }) =>
	/(\d{4}) (\d{4})/.exec(mail.text)!.slice(1, 3).join("");
const resetAllowances = () => sql.exec("DELETE FROM audio_client_allowances");

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { body?: string }) => {
			if (String(url).includes("resend")) {
				const payload = JSON.parse(String(init?.body));

				mails.push({ to: payload.to[0], text: payload.text });

				return { ok: true, status: 200, json: async () => ({ id: "em" }) };
			}

			return { ok: true, status: 200, json: async () => ({ success: true }) };
		}),
	);
}

/** Every interleaving of the lists, each list kept in its own order. */
function merges(lists: string[][]): string[][] {
	const out: string[][] = [];
	const index = lists.map(() => 0);
	const current: string[] = [];

	const walk = () => {
		let any = false;

		for (let list = 0; list < lists.length; list++)
			if (index[list] < lists[list].length) {
				any = true;
				current.push(lists[list][index[list]++]);
				walk();
				index[list]--;
				current.pop();
			}

		if (!any) out.push([...current]);
	};

	walk();

	return out;
}

async function withSchedule<T>(
	schedule: string[],
	work: () => Promise<T>,
): Promise<T | "HANG"> {
	script = [...schedule];
	waiters.clear();

	let timer: ReturnType<typeof setTimeout> | undefined;

	const result = await Promise.race([
		work(),
		new Promise<"HANG">((resolve) => {
			timer = setTimeout(() => resolve("HANG"), 3000);
		}),
	]);

	clearTimeout(timer);

	return script.length ? "HANG" : result;
}

type Actor = {
	steps: string[];
	start: (target: string) => Promise<Response | void>;
};

const request = (
	id: string,
	address: (target: string) => string,
	cookie: string,
): Actor => ({
	steps: [`${id}.r`, `${id}.c`, `${id}.w`],
	start: (target) => ask(id, address(target), cookie),
});

const atomic = (
	id: string,
	work: (target: string) => Promise<void>,
): Actor => ({
	steps: [`${id}.x`],
	start: async (target) => {
		await gate(`${id}.x`);

		try {
			await work(target);
		} finally {
			done();
		}
	},
});

/** Everything an attacker who controls the given (cookie, address) pairs can see after a run. */
async function observe(
	responses: (Response | void)[],
	pairs: [string, string][],
	sent: string[],
) {
	const seen: string[] = [];

	for (const response of responses)
		if (response instanceof Response) {
			const cookies = response.headers
				.getSetCookie()
				.map((value) =>
					value.replace(/studio_session=[^;]*/, "studio_session=<S>"),
				)
				.map((value) => {
					const found = value.match(/=([0-9a-f]{64})/)?.[1];

					return found
						? value.replace(found, sent.includes(found) ? "<sent>" : "<new>")
						: value;
				});

			seen.push(
				`${response.status} ${await response.text()} ${cookies.join("|")}`,
			);
		}

	const addresses = [...new Set(pairs.map(([, address]) => address))];

	seen.push(
		`mails=${addresses.map((address) => mails.filter((mail) => mail.to === address).length).join(",")}`,
	);

	for (const [cookie, address] of pairs) {
		const own = mails.filter((mail) => mail.to === address);

		for (let index = own.length - 1; index >= 0; index--) {
			resetAllowances();
			seen.push(
				`${address}#${index}=${(await enter("probe", address, codeIn(own[index]), cookie, false)).status}`,
			);
		}
	}

	return seen.join(" ; ");
}

type Scenario = {
	setup?: (target: string) => Promise<void>;
	actors: Actor[];
	pairs: [string, string][];
	sent: string[];
	targets?: readonly Target[];
};

/** Runs every ordering of the actors' steps once per target state, and counts the orderings an attacker could tell apart. */
async function explore(scenario: Scenario, sampleEvery = 1) {
	const schedules = merges(scenario.actors.map((actor) => actor.steps)).filter(
		(_, index) => index % sampleEvery === 0,
	);
	let differing = 0;
	const examples: string[] = [];

	for (const schedule of schedules) {
		const seen = new Map<string, string>();

		for (const name of scenario.targets ?? TARGETS) {
			fresh();
			stubFetch();
			await scenario.setup?.(ADDR[name]);
			await flush();
			resetAllowances();

			const result = await withSchedule(schedule, () =>
				Promise.all(scenario.actors.map((actor) => actor.start(ADDR[name]))),
			);

			if (result === "HANG") {
				seen.set(name, "HANG");
				continue;
			}

			await flush();
			seen.set(name, await observe(result, scenario.pairs, scenario.sent));
		}

		if (new Set(seen.values()).size > 1) {
			differing++;

			if (examples.length < 3)
				examples.push(
					`[${schedule.join(" ")}]\n${[...seen].map(([name, value]) => `  ${name}: ${value}`).join("\n")}`,
				);
		}
	}

	return { orderings: schedules.length, differing, examples };
}

const report = (name: string, result: Awaited<ReturnType<typeof explore>>) => {
	console.log(
		`NONINTERFERENCE ${name}: ${result.orderings} orderings, ${result.differing} observable by target${result.examples.length ? `\n${result.examples.join("\n")}` : ""}`,
	);
};

beforeEach(() => {
	vi.unstubAllGlobals();
});

const attackers = [
	{ name: "client", own: ADDR.client, other: ADDR.client2 },
	{ name: "stranger", own: ADDR.stranger, other: ADDR.stranger2 },
] as const;

describe("a request for one address does not change what an attacker sees of another", () => {
	for (const attacker of attackers) {
		for (const earlier of attacker.name === "client"
			? [false, true]
			: [false]) {
			it(`two requests on one cookie, ${attacker.name} first${earlier ? ", with an earlier code" : ""}`, async () => {
				const result = await explore({
					setup: async () => {
						if (earlier) await ask("setup", attacker.own, K1, false);
					},
					actors: [
						request("A", () => attacker.own, K1),
						request("B", (target) => target, K1),
					],
					pairs: [[K1, attacker.own]],
					sent: [K1],
				});

				report(
					`two requests, one cookie, ${attacker.name}${earlier ? ", earlier code" : ""}`,
					result,
				);
				expect(result.orderings).toBe(20);
				expect(result.differing).toBe(0);
			}, 120_000);
		}

		it(`two requests on two cookies, ${attacker.name}`, async () => {
			const result = await explore({
				setup: async () => {
					await ask("setup", attacker.own, K1, false);
				},
				actors: [
					request("A", () => attacker.own, K1),
					request("B", (target) => target, K2),
				],
				pairs: [[K1, attacker.own]],
				sent: [K1, K2],
			});

			report(`two requests, two cookies, ${attacker.name}`, result);
			expect(result.orderings).toBe(20);
			expect(result.differing).toBe(0);
		}, 120_000);

		it(`three requests on one cookie, ${attacker.name}${exhaustive ? "" : " (a deterministic sample)"}`, async () => {
			const result = await explore(
				{
					actors: [
						request("A", () => attacker.own, K1),
						request("B", (target) => target, K1),
						request("C", () => attacker.other, K1),
					],
					pairs: [
						[K1, attacker.own],
						[K1, attacker.other],
					],
					sent: [K1],
				},
				exhaustive ? 1 : 40,
			);

			report(`three requests, one cookie, ${attacker.name}`, result);
			expect(result.orderings).toBe(exhaustive ? 1680 : 42);
			expect(result.differing).toBe(0);
		}, 1_800_000);

		it(`three requests on two cookies, ${attacker.name}${exhaustive ? "" : " (a deterministic sample)"}`, async () => {
			const result = await explore(
				{
					actors: [
						request("A", () => attacker.own, K1),
						request("B", (target) => target, K2),
						request("C", () => attacker.other, K1),
					],
					pairs: [
						[K1, attacker.own],
						[K1, attacker.other],
					],
					sent: [K1, K2],
				},
				exhaustive ? 1 : 40,
			);

			report(`three requests, two cookies, ${attacker.name}`, result);
			expect(result.differing).toBe(0);
		}, 1_800_000);
	}

	it("a request racing the client's own entry of its code", async () => {
		const result = await explore({
			setup: async () => {
				await ask("setup", ADDR.client, K1, false);
			},
			actors: [
				request("B", (target) => target, K1),
				{
					steps: ["E.cr", "E.cw"],
					start: async () =>
						enter(
							"E",
							ADDR.client,
							codeIn(mails.find((mail) => mail.to === ADDR.client)!),
							K1,
						),
				},
			],
			pairs: [[K1, ADDR.client]],
			sent: [K1],
		});

		report("a request racing the client's entry", result);
		expect(result.differing).toBe(0);
	}, 120_000);

	it("a request racing the revocation of the target's project", async () => {
		const result = await explore({
			setup: async () => {
				await ask("setup", ADDR.client, K1, false);
			},
			actors: [
				request("B", (target) => target, K1),
				atomic("V", async (target) => {
					const id = (
						{ [ADDR.open]: "p-open", [ADDR.full]: "p-full" } as Record<
							string,
							string
						>
					)[target];

					if (id) await revokeProjectAccess(db, id, "owner");
				}),
			],
			pairs: [[K1, ADDR.client]],
			sent: [K1],
		});

		report("a request racing a revocation of the target's project", result);
		expect(result.differing).toBe(0);
	}, 120_000);

	it("a request racing a retention sweep that removes old codes of the target", async () => {
		const result = await explore({
			setup: async (target) => {
				await ask("setup", ADDR.client, K1, false);
				sql
					.prepare(
						`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at) VALUES (?,?,?,0,?,?)`,
					)
					.run(
						"old-row",
						target,
						"old",
						"2020-01-01T00:00:00.000Z",
						"2020-01-01T00:10:00.000Z",
					);
			},
			actors: [
				request("B", (target) => target, K1),
				atomic("T", async () => {
					const database = {
						query: async (query: string) =>
							sql
								.prepare(query)
								.all()
								.map((row: object) => ({ ...row })),
						batch: async (statements: string[]) => {
							sql.exec("BEGIN");

							try {
								const result = statements.map((statement) =>
									sql.prepare(statement).all(),
								);

								sql.exec("COMMIT");

								return result;
							} catch (error) {
								sql.exec("ROLLBACK");
								throw error;
							}
						},
					};

					const storage = {
						accountId: null,
						databaseId: "local-music",
						bucket: "local-audio",
						jurisdiction: null,
					};
					const review = await previewStudioRetention(
						database,
						"Local test data",
						storage,
						new Date(),
					);

					await applyStudioRetention(
						database,
						review,
						"Local test data",
						storage,
						async () => {},
						new Date(),
					);
				}),
			],
			pairs: [[K1, ADDR.client]],
			sent: [K1],
		});

		report("a request racing a retention sweep", result);
		expect(result.differing).toBe(0);
	}, 120_000);
});

describe("regression checks from earlier rounds", () => {
	it("leaves exactly six live codes when twenty browsers ask for one address at once", async () => {
		fresh();
		stubFetch();

		// Five live codes are there already; the email allowance lets a few of the twenty through, and no more than one fits.
		for (let index = 0; index < 5; index++)
			sql
				.prepare(
					`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at) VALUES (?,?,?,0,?,?)`,
				)
				.run(
					`pre${index}`,
					ADDR.open,
					`c${index}`,
					new Date().toISOString(),
					new Date(Date.now() + 600_000).toISOString(),
				);

		const responses = await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				ask(`b${index}`, ADDR.open, undefined, false),
			),
		);

		await flush();
		expect(
			responses.every((response) => [200, 429].includes(response.status)),
		).toBe(true);
		expect(
			sql
				.prepare(
					"SELECT COUNT(*) AS n FROM audio_client_signin_codes WHERE email=?",
				)
				.get(ADDR.open),
		).toEqual({ n: 6 });
	});

	it("makes no database call for an entry without the pending cookie", async () => {
		fresh();

		const calls: string[] = [];

		const counting = double<D1Database>({
			prepare: (query: string) => {
				calls.push(query);

				return db.prepare(query);
			},
			batch: async (items: D1PreparedStatement[]) => {
				calls.push("batch");

				return db.batch(items);
			},
		});

		const response = await completeCode(
			context(
				"/api/studio/session",
				{ email: ADDR.client, code: "12345678" },
				undefined,
				counting,
			),
		);

		expect(response.status).toBe(401);
		expect(calls).toEqual([]);
	});

	it("counts at most five attempts and signs in once when guesses arrive together", async () => {
		fresh();
		stubFetch();
		await ask("setup", ADDR.client, K1, false);
		await flush();

		const code = codeIn(mails[0]);
		const wrong = code === "00000000" ? "11111111" : "00000000";

		const guesses = await Promise.all(
			Array.from({ length: 8 }, () =>
				enter("g", ADDR.client, wrong, K1, false),
			),
		);

		expect(guesses.map((response) => response.status)).toEqual(
			Array(8).fill(401),
		);
		expect(
			sql
				.prepare("SELECT attempts FROM audio_client_signin_codes WHERE email=?")
				.get(ADDR.client),
		).toEqual({ attempts: 5 });

		await ask("setup2", ADDR.client2, K2, false);
		await flush();

		const right = codeIn(mails.filter((mail) => mail.to === ADDR.client2)[0]);

		const results = await Promise.all([
			enter("a", ADDR.client2, right, K2, false),
			enter("b", ADDR.client2, right, K2, false),
		]);

		expect(results.map((response) => response.status).sort()).toEqual([
			200, 401,
		]);
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_sessions").get(),
		).toEqual({ n: 1 });
	});

	it("fails closed on an unmigrated database", async () => {
		fresh();
		stubFetch();
		sql.exec("DROP TABLE audio_client_signin_codes");

		const response = await ask("x", ADDR.client, K1, false);

		expect(response.status).toBe(503);
		expect(mails).toHaveLength(0);
	});
});
