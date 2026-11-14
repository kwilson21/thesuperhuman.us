import type { JsonValue } from "../helpers/json";
import { hashValue } from "~/lib/audio-client-access";
import { POST } from "~/pages/api/studio/session";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type Step,
} from "./harness";
import {
	allowanceRow,
	audioClient,
	BROWSER,
	codeRow,
	FIRST_SIGN_IN_TOKEN,
	GRACE,
	mergeSeeds,
	OTHER,
	PENDING,
	sessionRow,
	softwareClient,
	sql,
	stageSql,
	T1,
} from "./areas/studio-access";

// The golden corpus for POST /api/studio/session: the client sends the email and the eight-digit code, and on success
// gets a studio_session cookie (14 days, HttpOnly, SameSite=Lax, Secure on https). Every attempt is charged to the code
// before it is compared, so five wrong guesses lock a code. The database holds only hashes. Cases start from seeded
// code rows whose code the case knows; the real code-then-session sequences are in studio-code.test.ts.
//
// Every response branch of the handler, musicRequest, takeStudioAllowance and completeClientCode
// (src/lib/audio-client-access.ts), and its cases:
//
//   handler gates
//   404 text "Not found"                  portal flag unset, "false", "TRUE"; flag read before any binding
//   503 "temporarily unavailable"         no MUSIC_DB, no code key, a code key under 32 characters (keyedHash throws in the
//                                         try, so the catch answers). The Turnstile secret and the Resend key are not needed
//   musicRequest                          403 no Origin, another site, http, other port; 415 text/plain and form body; 400
//                                         Missing request; 413 at 4097 bytes (4096 accepted); 400 Invalid JSON, empty body;
//                                         a charset on the content type is accepted
//   400 "Check the email and ..."         null, array, no email, no code, code not text, empty, 7 digits, 9 digits, letters,
//                                         a space in the middle (as the email prints it), spaces around, a trailing newline,
//                                         non-ASCII digits, an invalid email, an email over 320
//   no pending cookie                     401 with the same sentence before anything is read, charged or counted: no cookie,
//                                         a cookie that names no code, is not 64 lower-case hex digits or has one digit
//                                         changed, thirty guesses in a row without it; another browser's code does not open
//                                         this browser's code, and a stranger's wrong guesses on their own code leave it alone
//   takeStudioAllowance
//   429 "Too many attempts"               session-ip at 20 uses (the requester allowance is then not taken),
//                                         session-requester at 10 (one browser's own count; the ip allowance was spent); 19 and 9 pass; stale windows pruned; sequence of 11
//                                         tries, where the eleventh is refused even with the right code
//   completeClientCode
//   401 "invalid or expired"              no code row, wrong code, wrong code at the fifth attempt, the right code after five
//                                         attempts, expired code (the instant of expiry is expired, one ms before is not),
//                                         used code, another email's code, the right code after the project was revoked or the
//                                         request withdrawn, a request resolved before acceptance (a trigger revokes the
//                                         project), software revoked or content deleted, a lost race on the code row,
//                                         a lost race on the attempts, a lost race on the project
//   200 {ok:true} + cookie                audio project, software project, both (two audit rows), resolved request, an email
//                                         written in capitals, a client who already has a session, the right code on the fifth
//                                         attempt, a withdrawn request next to an active one (audit row for both)
//   503 catch                             each batch failing, a session insert that collides (batch rolled back, code stays
//                                         unused)
//   who is asking                         the owner and a client who already has a cookie are treated as visitors
//   sequences                             sign in twice with one code, with two codes (two sessions), two clients

const URL_PATH = "/api/studio/session";
const IP = "203.0.113.9";
const GOOD = "12345678";
const SECOND_PENDING = "cd".repeat(32);

// The subject of the per-requester allowance: the address and the hash of the browser's pending value.
const REQUESTER = `${GRACE}:${await hashValue(PENDING)}`;

const tables = [
	"audio_client_signin_codes",
	"audio_client_sessions",
	"audio_client_access_audit",
	"audio_client_allowances",
];

const attempt = (
	body: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: asVisitor({ ip: IP }),
	path: URL_PATH,
	json: body,
	headers: BROWSER,
	dump: { music: tables },
	...extra,
});

const login = (code: string = GOOD, extra: Partial<Step> = {}) =>
	attempt({ email: GRACE, code }, extra);

const client = audioClient("r1", GRACE);
const code = (over = {}) => codeRow(GRACE, GOOD, over);

const seeded = async (...more: Seed[]): Promise<{ seed: Seed }> => ({
	seed: mergeSeeds(
		client,
		{ audio_client_signin_codes: [await code()] },
		...more,
	),
});

const open = async (
	name: string,
	extra: Partial<Case> = {},
	...more: Seed[]
): Promise<Case> => ({
	name,
	music: await seeded(...more),
	steps: [login()],
	...extra,
});

const padded = (bytes: number) => {
	const base = { email: GRACE, code: GOOD, pad: "" };
	const used = JSON.stringify(base).length;

	return { ...base, pad: "x".repeat(bytes - used) };
};

const wrongTries = (count: number): Step[] =>
	Array.from({ length: count }, () => login("00000000"));

const revoke =
	"UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'";

const cases: Case[] = [
	// gates
	await open("portal flag unset", { omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] }),
	await open("portal flag false", {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	await open("portal flag TRUE in capitals", {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" },
	}),
	await open("portal flag off wins over a missing database", {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
		music: { missing: true },
	}),
	await open("no database binding", { music: { missing: true } }),
	await open("no code key", { omit: ["AUDIO_CLIENT_CODE_KEY"] }),
	await open("a code key under 32 characters", {
		env: { AUDIO_CLIENT_CODE_KEY: "short-key-of-31-characters-xxx" },
	}),
	await open("no Turnstile secret and no Resend key are needed", {
		omit: ["TURNSTILE_SECRET_KEY", "RESEND_API_KEY"],
	}),
	// musicRequest
	await open("no Origin header", { steps: [login(GOOD, { headers: {} })] }),
	await open("an Origin from another site", {
		steps: [login(GOOD, { headers: { origin: "https://evil.example" } })],
	}),
	await open("an Origin with the http scheme", {
		steps: [login(GOOD, { headers: { origin: "http://thesuperhuman.us" } })],
	}),
	await open("a body sent as text/plain", {
		steps: [
			attempt(undefined, {
				body: JSON.stringify({ email: GRACE, code: GOOD }),
			}),
		],
	}),
	await open("an urlencoded form body", {
		steps: [
			attempt(undefined, {
				body: `email=${encodeURIComponent(GRACE)}&code=${GOOD}`,
				headers: {
					...BROWSER,
					"content-type": "application/x-www-form-urlencoded",
				},
			}),
		],
	}),
	await open("JSON content type and no body", {
		steps: [
			attempt(undefined, {
				headers: { ...BROWSER, "content-type": "application/json" },
			}),
		],
	}),
	await open("JSON content type with a charset is accepted", {
		steps: [
			login(GOOD, {
				headers: {
					...BROWSER,
					"content-type": "application/json; charset=utf-8",
				},
			}),
		],
	}),
	await open("a body of exactly 4096 bytes", {
		steps: [attempt(padded(4096))],
	}),
	await open("a body of 4097 bytes", { steps: [attempt(padded(4097))] }),
	await open("bad JSON", {
		steps: [
			attempt(undefined, {
				body: "{not json",
				headers: { ...BROWSER, "content-type": "application/json" },
			}),
		],
	}),
	await open("an empty body with a JSON content type", {
		steps: [
			attempt(undefined, {
				body: "",
				headers: { ...BROWSER, "content-type": "application/json" },
			}),
		],
	}),
	// schema
	await open("a null body", { steps: [attempt(null)] }),
	await open("an array body", { steps: [attempt([GRACE, GOOD])] }),
	await open("no email", { steps: [attempt({ code: GOOD })] }),
	await open("no code", { steps: [attempt({ email: GRACE })] }),
	await open("a code that is a number", {
		steps: [attempt({ email: GRACE, code: 12_345_678 })],
	}),
	await open("an empty code", { steps: [login("")] }),
	await open("a code of seven digits", { steps: [login("1234567")] }),
	await open("a code of nine digits", { steps: [login("123456789")] }),
	await open("a code of letters", { steps: [login("abcdefgh")] }),
	await open("a code written with a space as the email prints it", {
		steps: [login("1234 5678")],
	}),
	await open("a code with spaces around it", { steps: [login(" 12345678 ")] }),
	await open("a code with a trailing newline", {
		steps: [login("12345678\n")],
	}),
	await open("a code in non-ASCII digits", { steps: [login("١٢٣٤٥٦٧٨")] }),
	await open("an email that is not an address", {
		steps: [attempt({ email: "nope", code: GOOD })],
	}),
	await open("an email of 321 characters", {
		steps: [attempt({ email: `${"a".repeat(308)}@example.test`, code: GOOD })],
	}),
	await open("an email with markup characters", {
		steps: [attempt({ email: "<b>grace</b>@example.test", code: GOOD })],
	}),
	// allowances
	await open(
		"the address is at 20 uses so the 21st is refused before the email is counted",
		{},
		{ audio_client_allowances: [await allowanceRow("session-ip", IP, 20)] },
	),
	await open(
		"the address is at 19 uses so the 20th passes",
		{},
		{ audio_client_allowances: [await allowanceRow("session-ip", IP, 19)] },
	),
	await open(
		"the email is at 10 uses so the 11th is refused after the address was counted",
		{},
		{
			audio_client_allowances: [
				await allowanceRow("session-requester", REQUESTER, 10),
			],
		},
	),
	await open(
		"the email is at 9 uses so the 10th passes",
		{},
		{
			audio_client_allowances: [
				await allowanceRow("session-requester", REQUESTER, 9),
			],
		},
	),
	await open(
		"an allowance window exactly five minutes old is pruned",
		{},
		{
			audio_client_allowances: [
				await allowanceRow(
					"session-requester",
					REQUESTER,
					10,
					"2026-11-13T11:55:00.000Z",
				),
			],
		},
	),
	await open(
		"a code allowance does not count as a session allowance",
		{},
		{
			audio_client_allowances: [
				await allowanceRow("code-ip", IP, 20),
				await allowanceRow("code-email", GRACE, 10),
			],
		},
	),
	await open("ten wrong tries and the eleventh with the right code", {
		steps: [...wrongTries(10), login()],
	}),
	await open("six wrong tries are all answered 401", {
		steps: wrongTries(6),
	}),
	// the code
	await open("no code row for the email", {
		music: { seed: client },
	}),
	await open("a wrong code", { steps: [login("00000000")] }),
	await open("a wrong code at the fifth attempt", {
		setup: sql("UPDATE audio_client_signin_codes SET attempts=4"),
		steps: [login("00000000")],
	}),
	await open("the right code after five attempts", {
		setup: sql("UPDATE audio_client_signin_codes SET attempts=5"),
	}),
	await open("the right code at the fifth attempt", {
		setup: sql("UPDATE audio_client_signin_codes SET attempts=4"),
	}),
	await open("four wrong tries then the right code", {
		steps: [...wrongTries(4), login()],
	}),
	await open("five wrong tries then the right code", {
		steps: [...wrongTries(5), login()],
	}),
	await open("a code that expires at this instant", {
		setup: sql(
			"UPDATE audio_client_signin_codes SET expires_at='2026-11-13T12:00:00.000Z'",
		),
	}),
	await open("a code that expires one millisecond from now", {
		setup: sql(
			"UPDATE audio_client_signin_codes SET expires_at='2026-11-13T12:00:00.001Z'",
		),
	}),
	await open("a code used already", {
		setup: sql(
			`UPDATE audio_client_signin_codes SET used_at='2026-11-13T11:56:00.000Z',session_token_hash='${T1.hash}'`,
		),
	}),
	await open("a code issued for another email", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [await codeRow(OTHER, GOOD)],
			}),
		},
	}),
	await open("the right code for a different email than the one sent", {
		steps: [attempt({ email: OTHER, code: GOOD })],
	}),
	// the project
	await open("the project is revoked after the code was issued", {
		setup: sql(revoke),
	}),
	await open("the request is withdrawn after the code was issued", {
		setup: sql("UPDATE owner_requests SET status='withdrawn'"),
	}),
	await open("a request resolved before acceptance closes its project", {
		setup: sql("UPDATE owner_requests SET status='resolved'"),
	}),
	await open("a request resolved after acceptance can sign in", {
		setup: sql(
			stageSql("in_progress"),
			"UPDATE owner_requests SET status='resolved'",
		),
	}),
	await open("a software project can sign in", {
		music: {
			seed: mergeSeeds(softwareClient("s1", GRACE), {
				audio_client_signin_codes: [await code()],
			}),
		},
	}),
	await open("a revoked software project cannot sign in", {
		music: {
			seed: mergeSeeds(
				softwareClient("s1", GRACE, {
					project: { revoked_at: "2026-11-13T11:30:00.000Z" },
				}),
				{ audio_client_signin_codes: [await code()] },
			),
		},
	}),
	await open("a software project with content deleted cannot sign in", {
		music: {
			seed: mergeSeeds(
				softwareClient("s1", GRACE, {
					project: { content_deleted_at: "2026-11-13T11:30:00.000Z" },
				}),
				{ audio_client_signin_codes: [await code()] },
			),
		},
	}),
	await open(
		"an audio and a software project give two audit rows",
		{},
		softwareClient("s1", GRACE),
	),
	await open(
		"a withdrawn request next to an active one gets a signed-in audit row too",
		{},
		audioClient("r0", GRACE, { status: "withdrawn" }),
	),
	await open("an email in capitals is normalised", {
		steps: [attempt({ email: "  GRACE@Example.TEST ", code: GOOD })],
	}),
	await open(
		"a client who already has a session gets a second one",
		{},
		{ audio_client_sessions: [sessionRow(T1, GRACE)] },
	),
	// races
	await open("another sign-in uses the code first", {
		interleave: [
			{
				on: /UPDATE audio_client_signin_codes SET attempts/,
				label: "another request signed in with the code",
				run: (sqlite) =>
					sqlite.exec(
						`UPDATE audio_client_signin_codes SET used_at='2026-11-13T11:59:59.000Z',session_token_hash='${T1.hash}'`,
					),
			},
		],
	}),
	await open("other guesses spend the attempts first", {
		interleave: [
			{
				on: /UPDATE audio_client_signin_codes SET attempts/,
				label: "someone else made five wrong guesses",
				run: (sqlite) =>
					sqlite.exec("UPDATE audio_client_signin_codes SET attempts=5"),
			},
		],
	}),
	await open("the project is revoked during the sign-in", {
		interleave: [
			{
				on: /UPDATE audio_client_signin_codes SET attempts/,
				label: "the owner revoked the project",
				run: (sqlite) => sqlite.exec(revoke),
			},
		],
	}),
	await open("the code is replaced during the sign-in", {
		interleave: [
			{
				on: /UPDATE audio_client_signin_codes SET attempts/,
				label: "a new code replaced this one",
				run: (sqlite) =>
					sqlite.exec(
						"UPDATE audio_client_signin_codes SET code_hash='replaced',attempts=0",
					),
			},
		],
	}),
	// success and what comes after
	await open("sign in twice with one code", { steps: [login(), login()] }),
	await open("two codes in turn give two sessions", {
		steps: [
			login(),
			login("87654321", {
				advanceMs: 60_000,
				headers: { ...BROWSER, cookie: `studio_pending=${SECOND_PENDING}` },
				before: {
					label: "a second code is issued to another browser",
					run: async (world) => {
						world.music.exec("DELETE FROM audio_client_signin_codes");

						const row = await codeRow(
							GRACE,
							"87654321",
							{
								created_at: "2026-11-13T12:00:30.000Z",
								expires_at: "2026-11-13T12:10:30.000Z",
							},
							SECOND_PENDING,
						);

						world.music
							.prepare(
								"INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at) VALUES(?,?,?,?,?,?)",
							)
							.run(
								String(row.nonce_hash),
								String(row.email),
								String(row.code_hash),
								0,
								String(row.created_at),
								String(row.expires_at),
							);
					},
				},
			}),
		],
	}),
	await open("two clients sign in", {
		music: {
			seed: mergeSeeds(client, audioClient("r2", OTHER), {
				audio_client_signin_codes: [
					await code(),
					await codeRow(OTHER, "55555555", {}, SECOND_PENDING),
				],
			}),
		},
		steps: [
			login(),
			attempt(
				{ email: OTHER, code: "55555555" },
				{
					as: asVisitor({ ip: "198.51.100.8" }),
					headers: { ...BROWSER, cookie: `studio_pending=${SECOND_PENDING}` },
				},
			),
		],
	}),
	await open("a sign-in without a client address uses the shared bucket", {
		steps: [login(GOOD, { as: asVisitor() })],
	}),
	// who is asking
	await open("the owner signs in", { steps: [login(GOOD, { as: asOwner() })] }),
	await open(
		"a client who already has a cookie signs in again",
		{ steps: [login(GOOD, { as: asClientCookie(T1.value) })] },
		{ audio_client_sessions: [sessionRow(T1, GRACE)] },
	),
	// the pending sign-in cookie (a code belongs to the browser that asked for it)
	await open("the right code without the pending cookie", {
		steps: [login(GOOD, { headers: { origin: "https://thesuperhuman.us" } })],
	}),
	await open("the right code with a pending cookie that names no code", {
		steps: [
			login(GOOD, {
				headers: {
					origin: "https://thesuperhuman.us",
					cookie: `studio_pending=${"e".repeat(64)}`,
				},
			}),
		],
	}),
	await open("the right code with a pending cookie that is not well formed", {
		steps: [
			login(GOOD, {
				headers: {
					origin: "https://thesuperhuman.us",
					cookie: "studio_pending=not-a-nonce",
				},
			}),
		],
	}),
	await open("the right code with the pending cookie written in capitals", {
		steps: [
			login(GOOD, {
				headers: {
					origin: "https://thesuperhuman.us",
					cookie: `studio_pending=${PENDING.toUpperCase()}`,
				},
			}),
		],
	}),
	await open("the right code with one digit of the pending cookie changed", {
		steps: [
			login(GOOD, {
				headers: {
					origin: "https://thesuperhuman.us",
					cookie: `studio_pending=${PENDING.slice(0, 63)}0`,
				},
			}),
		],
	}),
	await open(
		"thirty guesses without the cookie leave the code and allowances alone",
		{
			steps: [
				...Array.from({ length: 30 }, () =>
					login("00000000", {
						headers: { origin: "https://thesuperhuman.us" },
					}),
				),
				login(),
			],
		},
	),
	await open("another browser's code does not open this browser's code", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await code(),
					await codeRow(GRACE, "55555555", {}, SECOND_PENDING),
				],
			}),
		},
		steps: [login("55555555"), login()],
	}),
	await open(
		"a code that looks right in this browser but belongs to another browser's cookie",
		{
			music: {
				seed: mergeSeeds(client, {
					audio_client_signin_codes: [
						await codeRow(GRACE, GOOD, {}, SECOND_PENDING),
					],
				}),
			},
		},
	),
	await open(
		"a stranger's wrong guesses with their own cookie do not touch the client's code",
		{
			music: {
				seed: mergeSeeds(client, {
					audio_client_signin_codes: [
						await code(),
						await codeRow(GRACE, "55555555", {}, SECOND_PENDING),
					],
				}),
			},
			steps: [
				...Array.from({ length: 6 }, () =>
					login("00000000", {
						headers: { ...BROWSER, cookie: `studio_pending=${SECOND_PENDING}` },
					}),
				),
				login(),
			],
		},
	),
	// outages
	await open("the first allowance batch fails", {
		failures: [
			{ on: /DELETE FROM audio_client_allowances/, message: "d1 down" },
		],
	}),
	await open("the email allowance batch fails", {
		failures: [
			{
				on: /DELETE FROM audio_client_allowances/,
				nth: 2,
				message: "d1 down",
			},
		],
	}),
	await open("the sign-in batch fails", {
		failures: [
			{
				on: /UPDATE audio_client_signin_codes SET attempts/,
				message: "d1 down",
			},
		],
	}),
	await open(
		"a session that collides rolls the whole sign-in back",
		{},
		{
			audio_client_sessions: [sessionRow(FIRST_SIGN_IN_TOKEN, OTHER)],
		},
	),
];

defineCorpus("studio-session", POST, cases);
