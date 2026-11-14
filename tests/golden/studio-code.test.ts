import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/studio/code";
import { POST as session } from "~/pages/api/studio/session";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type FetchAnswer,
	type Step,
} from "./harness";
import {
	allowanceRow,
	audioClient,
	BROWSER,
	browser,
	browserAt,
	codeRow,
	GRACE,
	mergeSeeds,
	OTHER,
	SAME_ORIGIN,
	sessionRow,
	softwareClient,
	sql,
	T1,
} from "./areas/studio-access";

// The golden corpus for POST /api/studio/code: a client asks for an emailed eight-digit sign-in code. The answer is the
// same sentence whether or not the email has a project (so a visitor cannot learn who is a client), and the difference
// is only in what the database and Resend see. Cross-route sequences go on into POST /api/studio/session.
//
// Every response branch of the handler, musicRequest (src/lib/music-request.ts), takeStudioAllowance, issueClientCode,
// discardUndeliveredCode (src/lib/audio-client-access.ts), verifyTurnstile and sendAudioMessage, and its cases:
//
//   handler gates
//   404 text "Not found"                  portal flag unset, "false", "TRUE" (case matters); the flag is read before any binding
//   503 "temporarily unavailable"         no MUSIC_DB, no Turnstile secret, no code key, no Resend key, no from address, a
//                                         secret that is the empty string, a code key under 32 characters (keyedHash throws
//                                         inside the try, so it is the catch-all 503, with no statement run)
//   musicRequest
//   403 Forbidden                         no Origin, another site, http scheme, other port
//   415 JSON required                     text/plain, urlencoded form, no content type
//   400 Missing request                   JSON content type and no body at all
//   413 Request too large                 4097 bytes (4096 is accepted)
//   400 Invalid JSON                      bad JSON, empty body
//   schema and email
//   400 "Enter your email and ..."        null, array, missing email, email not text, email over 320, no token, empty token,
//                                         token not text, token over 2048 (2048 accepted)
//   400 "Enter a valid email address."    not an email, empty, spaces, an over-long local part, markup and unicode characters
//   normalising                           upper case and spaces trimmed and lowered; plus-address is a different email
//   client address                        cf-connecting-ip, none (0.0.0.0 shared bucket), IPv6
//   takeStudioAllowance (code-ip, 10 / 5 min; code-email, 3 / 5 min)
//   429 "Please wait ..."                 ip at 10 uses, email at 3 uses (after Turnstile ran); 9 and 2 uses pass; stale windows
//                                         are pruned (exactly five minutes old is pruned, one ms younger is kept); sequences
//                                         of 4 requests for one email and 11 for one address
//   verifyTurnstile
//   403 "complete the security check"     success false, HTTP 500, network down, answer not JSON, success as the string "true",
//                                         an object with no success; the ip allowance is already spent, the email one is not
//   issueClientCode
//   200 generic, no mail                  unknown email, request with no project (purchase kind), withdrawn request, revoked
//                                         audio project, revoked software project, software content deleted, the address
//                                         already has six live codes, project revoked between the allowance and the issue
//   200 generic, mail                     audio project, software project, resolved request (a request resolved before
//                                         acceptance has its project revoked by a trigger: no code), two projects (two audit rows), a
//                                         withdrawn request next to an active one (audit row for both: no withdrawn filter in
//                                         the audit insert), the same browser's earlier code replaced (at once or later), a used
//                                         code and an expired code left or swept, another browser's code kept (a lost race
//                                         with another request, a live code seeded for another browser), five live codes (the
//                                         sixth is issued)
//   cookie                                every answer that reaches the issue sets __Host-studio_pending to a fresh random value,
//                                         whether or not a code was issued; a code is bound to that value (it is read back
//                                         by the sign-in steps through the cookie jar)
//   mail outcomes (background)            200 sent; 4xx and 429 discard the code (audit "code-delivery-failed", row deleted);
//                                         5xx, network down keep it; the discard batch failing is swallowed (console.error,
//                                         which a corpus does not capture); SITE_ORIGIN unset and custom
//   503 catch                             each batch failing (first allowance, second allowance, issue), no ctx (the code is
//                                         stored, no mail is sent, the visitor gets 503)
//   who is asking                         owner and a signed-in client are treated as visitors
//   sequences into POST /api/studio/session

const URL_PATH = "/api/studio/code";
const IP = "203.0.113.9";
const FIRST = "84835301";

// The second code the harness hands out (the pending value drawn before it moves the random sequence on from the old 41233920).
const SECOND = "07085773";

const tables = [
	"audio_client_signin_codes",
	"audio_client_sessions",
	"audio_client_access_audit",
	"audio_client_allowances",
];

const ask = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step => ({
	as: asVisitor({ ip: IP }),
	path: URL_PATH,
	json: body,
	headers: browser,
	dump: { music: tables },
	...extra,
});

const form = (extra: Partial<Step> = {}) =>
	ask({ email: GRACE, turnstileToken: "tok" }, extra);

const ok = byHost({
	turnstile: json(200, { success: true }),
	resend: json(200, { id: "em_1" }),
});

const client = audioClient("r1", GRACE);

const open = (name: string, extra: Partial<Case> = {}): Case => ({
	name,
	music: { seed: client },
	fetches: ok,
	steps: [form()],
	...extra,
});

const withResend = (answer: FetchAnswer) =>
	byHost({ turnstile: json(200, { success: true }), resend: answer });

const withTurnstile = (answer: FetchAnswer) =>
	byHost({ turnstile: answer, resend: json(200, { id: "em_1" }) });

const signIn = (code: string, extra: Partial<Step> = {}): Step => ({
	as: asVisitor({ ip: IP }),
	handler: session,
	path: "/api/studio/session",
	json: { email: GRACE, code },
	headers: browser,
	dump: { music: tables },
	...extra,
});

// A body padded to an exact byte length with a field the schema drops.
const padded = (bytes: number) => {
	const base = { email: GRACE, turnstileToken: "tok", pad: "" };
	const used = JSON.stringify(base).length;

	return { ...base, pad: "x".repeat(bytes - used) };
};

const sameEmail = (count: number): Step[] =>
	Array.from({ length: count }, () => form({ advanceMs: 31_000 }));

const manyAddresses = (count: number): Step[] =>
	Array.from({ length: count }, (_, index) =>
		ask(
			{ email: `person${index}@example.test`, turnstileToken: "tok" },
			{ dump: { music: ["audio_client_allowances"] } },
		),
	);

const cases: Case[] = [
	// gates
	open("portal flag unset", { omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] }),
	open("portal flag false", { env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } }),
	open("portal flag TRUE in capitals", {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" },
	}),
	open("portal flag off wins over a missing database", {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
		music: { missing: true },
	}),
	open("no database binding", { music: { missing: true } }),
	open("no Turnstile secret", { omit: ["TURNSTILE_SECRET_KEY"] }),
	open("an empty Turnstile secret", { env: { TURNSTILE_SECRET_KEY: "" } }),
	open("no code key", { omit: ["AUDIO_CLIENT_CODE_KEY"] }),
	open("a code key under 32 characters", {
		env: { AUDIO_CLIENT_CODE_KEY: "short-key-of-31-characters-xxx" },
	}),
	open("no Resend key", { omit: ["RESEND_API_KEY"] }),
	open("no from address", { omit: ["CONTACT_FROM_EMAIL"] }),
	// musicRequest
	open("no Origin header", { steps: [form({ headers: {} })] }),
	open("an Origin from another site", {
		steps: [form({ headers: { origin: "https://evil.example" } })],
	}),
	open("an Origin with the http scheme", {
		steps: [form({ headers: { origin: "http://thesuperhuman.us" } })],
	}),
	open("an Origin with another port", {
		steps: [form({ headers: { origin: "https://thesuperhuman.us:8443" } })],
	}),
	open("a text body sent as text/plain", {
		steps: [
			ask(undefined, {
				body: JSON.stringify({ email: GRACE, turnstileToken: "tok" }),
				headers: SAME_ORIGIN,
			}),
		],
	}),
	open("an urlencoded form body", {
		steps: [
			ask(undefined, {
				body: `email=${encodeURIComponent(GRACE)}&turnstileToken=tok`,
				headers: {
					...SAME_ORIGIN,
					"content-type": "application/x-www-form-urlencoded",
				},
			}),
		],
	}),
	open("JSON content type and no body", {
		steps: [
			ask(undefined, {
				headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			}),
		],
	}),
	open("JSON content type with a charset is accepted", {
		steps: [
			form({
				headers: {
					...SAME_ORIGIN,
					"content-type": "application/json; charset=utf-8",
				},
			}),
		],
	}),
	open("a body of exactly 4096 bytes", { steps: [ask(padded(4096))] }),
	open("a body of 4097 bytes", { steps: [ask(padded(4097))] }),
	open("bad JSON", {
		steps: [
			ask(undefined, {
				body: "{not json",
				headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			}),
		],
	}),
	open("an empty body with a JSON content type", {
		steps: [
			ask(undefined, {
				body: "",
				headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			}),
		],
	}),
	// schema
	open("a null body", { steps: [ask(null)] }),
	open("an array body", { steps: [ask([GRACE, "tok"])] }),
	open("no email", { steps: [ask({ turnstileToken: "tok" })] }),
	open("an email that is not text", {
		steps: [ask({ email: 5, turnstileToken: "tok" })],
	}),
	open("an email of 321 characters", {
		steps: [
			ask({ email: `${"a".repeat(308)}@example.test`, turnstileToken: "tok" }),
		],
	}),
	open("no Turnstile token", { steps: [ask({ email: GRACE })] }),
	open("an empty Turnstile token", {
		steps: [ask({ email: GRACE, turnstileToken: "" })],
	}),
	open("a Turnstile token that is not text", {
		steps: [ask({ email: GRACE, turnstileToken: 12 })],
	}),
	open("a Turnstile token of 2049 characters", {
		steps: [ask({ email: GRACE, turnstileToken: "t".repeat(2049) })],
	}),
	open("a Turnstile token of 2048 characters", {
		steps: [ask({ email: GRACE, turnstileToken: "t".repeat(2048) })],
	}),
	open("an email that is not an address", {
		steps: [ask({ email: "not-an-email", turnstileToken: "tok" })],
	}),
	open("an empty email", {
		steps: [ask({ email: "", turnstileToken: "tok" })],
	}),
	open("an email of spaces", {
		steps: [ask({ email: "   ", turnstileToken: "tok" })],
	}),
	open("an email with a local part over 64 characters", {
		steps: [
			ask({ email: `${"a".repeat(80)}@example.test`, turnstileToken: "tok" }),
		],
	}),
	open("an email with markup characters", {
		steps: [ask({ email: "<b>grace</b>@example.test", turnstileToken: "tok" })],
	}),
	open("an email with an ampersand and a quote in the local part", {
		steps: [ask({ email: "o'brien&co@example.test", turnstileToken: "tok" })],
	}),
	open("an email with unicode characters", {
		steps: [ask({ email: "grâce@example.test", turnstileToken: "tok" })],
	}),
	// normalising and address
	open("an email in capitals with spaces is normalised", {
		steps: [ask({ email: "  GRACE@Example.TEST  ", turnstileToken: "tok" })],
	}),
	open("a plus address is a different email", {
		steps: [ask({ email: "grace+studio@example.test", turnstileToken: "tok" })],
	}),
	open("no client address uses the shared 0.0.0.0 bucket", {
		steps: [form({ as: asVisitor() })],
	}),
	open("an IPv6 client address", {
		steps: [form({ as: asVisitor({ ip: "2001:db8::7" }) })],
	}),
	open("an x-forwarded-for header is ignored", {
		steps: [
			form({
				as: asVisitor({ headers: { "x-forwarded-for": "198.51.100.1" } }),
			}),
		],
	}),
	// allowances
	open("the address is at ten uses so the eleventh is refused", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [await allowanceRow("code-ip", IP, 10)],
			}),
		},
	}),
	open("the address is at nine uses so the tenth passes", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [await allowanceRow("code-ip", IP, 9)],
			}),
		},
	}),
	open("an address window exactly five minutes old is pruned", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [
					await allowanceRow("code-ip", IP, 10, "2026-11-13T11:55:00.000Z"),
				],
			}),
		},
	}),
	open("an address window one millisecond younger than five minutes is kept", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [
					await allowanceRow("code-ip", IP, 10, "2026-11-13T11:55:00.001Z"),
				],
			}),
		},
	}),
	open("the email is at three uses so the fourth is refused after Turnstile", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [await allowanceRow("code-email", GRACE, 3)],
			}),
		},
	}),
	open("the email is at two uses so the third passes", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [await allowanceRow("code-email", GRACE, 2)],
			}),
		},
	}),
	open("another address's allowance does not count", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_allowances: [
					await allowanceRow("code-ip", "198.51.100.4", 10),
					await allowanceRow("session-ip", IP, 20),
				],
			}),
		},
	}),
	open("four requests for one email: the fourth is refused", {
		steps: sameEmail(4),
	}),
	open("eleven requests from one address for eleven emails", {
		music: { seed: {} },
		steps: manyAddresses(11),
	}),
	// Turnstile
	open("Turnstile says success false", {
		fetches: withTurnstile(json(200, { success: false })),
	}),
	open("Turnstile answers HTTP 500", {
		fetches: withTurnstile(json(500, { success: true })),
	}),
	open("Turnstile is unreachable", {
		fetches: byHost({
			turnstile: networkDown(),
			resend: json(200, { id: "em_1" }),
		}),
	}),
	open("Turnstile answers text that is not JSON", {
		fetches: withTurnstile(text(200, "<html>oops</html>")),
	}),
	open("Turnstile says success as the string true", {
		fetches: withTurnstile(json(200, { success: "true" })),
	}),
	open("Turnstile answers an object with no success", {
		fetches: withTurnstile(json(200, {})),
	}),
	// who has a project
	open("an unknown email", { music: { seed: {} } }),
	open("a request with no studio project", {
		music: {
			seed: audioClient("r1", GRACE, { kind: "purchase" }),
		},
	}),
	open("a withdrawn request", {
		music: { seed: audioClient("r1", GRACE, { status: "withdrawn" }) },
	}),
	open("a request seeded as resolved still gets a code", {
		music: { seed: audioClient("r1", GRACE, { status: "resolved" }) },
	}),
	open("a request resolved before acceptance has its project revoked", {
		music: { seed: client },
		setup: sql("UPDATE owner_requests SET status='resolved'"),
	}),
	open("a request resolved after acceptance still gets a code", {
		music: { seed: client },
		setup: sql(
			"UPDATE audio_projects SET stage='in_progress' WHERE request_id='r1'",
			"UPDATE owner_requests SET status='resolved'",
		),
	}),
	open("a revoked audio project", {
		music: { seed: client },
		setup: sql(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
		),
	}),
	open("an audio project with content deleted but not revoked", {
		music: { seed: client },
		setup: sql(
			"UPDATE audio_projects SET content_deleted_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
		),
	}),
	open("a software project", {
		music: { seed: softwareClient("s1", GRACE) },
	}),
	open("a revoked software project", {
		music: {
			seed: softwareClient("s1", GRACE, {
				project: { revoked_at: "2026-11-13T11:30:00.000Z" },
			}),
		},
	}),
	open("a software project with content deleted", {
		music: {
			seed: softwareClient("s1", GRACE, {
				project: { content_deleted_at: "2026-11-13T11:30:00.000Z" },
			}),
		},
	}),
	open("an audio and a software project for one email", {
		music: {
			seed: mergeSeeds(client, softwareClient("s1", GRACE)),
		},
	}),
	open("a withdrawn request next to an active one", {
		music: {
			seed: mergeSeeds(
				audioClient("r0", GRACE, { status: "withdrawn" }),
				client,
			),
		},
	}),
	open("another client's email has no code", {
		music: { seed: audioClient("r1", OTHER) },
	}),
	// an existing code
	open("a code issued 10 seconds ago to this browser is replaced", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await codeRow(GRACE, "11111111", {
						created_at: "2026-11-13T11:59:50.000Z",
						expires_at: "2026-11-13T12:09:50.000Z",
					}),
				],
			}),
		},
		steps: [form({ headers: BROWSER })],
	}),
	open("a code issued exactly 30 seconds ago is replaced", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await codeRow(GRACE, "11111111", {
						created_at: "2026-11-13T11:59:30.000Z",
						expires_at: "2026-11-13T12:09:30.000Z",
						attempts: 4,
					}),
				],
			}),
		},
		steps: [form({ headers: BROWSER })],
	}),
	open("a used code issued 5 seconds ago is replaced at once", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await codeRow(GRACE, "11111111", {
						created_at: "2026-11-13T11:59:55.000Z",
						expires_at: "2026-11-13T12:09:55.000Z",
						used_at: "2026-11-13T11:59:58.000Z",
						session_token_hash: T1.hash,
					}),
				],
			}),
		},
		steps: [form({ headers: BROWSER })],
	}),
	open("an expired code issued 5 seconds ago is replaced", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await codeRow(GRACE, "11111111", {
						created_at: "2026-11-13T11:59:55.000Z",
						expires_at: "2026-11-13T12:00:00.000Z",
					}),
				],
			}),
		},
		steps: [form({ headers: BROWSER })],
	}),
	open("another browser asks while a code issued 10 seconds ago is live", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: [
					await codeRow(GRACE, "11111111", {
						created_at: "2026-11-13T11:59:50.000Z",
						expires_at: "2026-11-13T12:09:50.000Z",
					}),
				],
			}),
		},
	}),
	open("another browser asks and the first browser's code still works", {
		steps: [
			form(),
			form({ headers: SAME_ORIGIN, advanceMs: 1000 }),
			signIn(FIRST, { headers: browserAt(0) }),
		],
	}),
	open("another browser asks and its own code works in its own browser", {
		steps: [
			form(),
			form({ headers: SAME_ORIGIN, advanceMs: 1000 }),
			signIn(SECOND, { headers: browserAt(1) }),
		],
	}),
	open("a stranger's guesses cannot use up the client's code", {
		steps: [
			form(),
			...Array.from({ length: 12 }, () =>
				signIn("00000000", { headers: SAME_ORIGIN }),
			),
			signIn(FIRST),
		],
	}),
	open("the right code typed in a browser that did not ask for it", {
		steps: [form(), signIn(FIRST, { headers: SAME_ORIGIN })],
	}),
	open(
		"the address already has six live codes: the seventh is refused with the usual answer",
		{
			music: {
				seed: mergeSeeds(client, {
					audio_client_signin_codes: await Promise.all(
						Array.from({ length: 6 }, (_, index) =>
							codeRow(
								GRACE,
								`1111111${index}`,
								{
									created_at: "2026-11-13T11:59:00.000Z",
									expires_at: "2026-11-13T12:09:00.000Z",
								},
								`${index}`.repeat(64),
							),
						),
					),
				}),
			},
		},
	),
	open("five live codes for the address: the sixth is issued", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_signin_codes: await Promise.all(
					Array.from({ length: 5 }, (_, index) =>
						codeRow(
							GRACE,
							`1111111${index}`,
							{
								created_at: "2026-11-13T11:59:00.000Z",
								expires_at: "2026-11-13T12:09:00.000Z",
							},
							`${index}`.repeat(64),
						),
					),
				),
			}),
		},
	}),
	open(
		"expired codes of the address are swept by its next request, and those of another address stay for retention",
		{
			music: {
				seed: mergeSeeds(client, {
					audio_client_signin_codes: [
						await codeRow(
							OTHER,
							"11111111",
							{
								created_at: "2026-11-13T11:40:00.000Z",
								expires_at: "2026-11-13T11:50:00.000Z",
							},
							"7".repeat(64),
						),
						await codeRow(
							GRACE,
							"22222222",
							{
								created_at: "2026-11-13T11:40:00.000Z",
								expires_at: "2026-11-13T11:50:00.000Z",
							},
							"8".repeat(64),
						),
					],
				}),
			},
		},
	),
	open("two requests 10 seconds apart: the second replaces the first", {
		steps: [form(), form({ advanceMs: 10_000 })],
	}),
	open("two requests 31 seconds apart: the second replaces the first", {
		steps: [form(), form({ advanceMs: 31_000 })],
	}),
	// mail outcomes
	open("Resend refuses the email (422): the code is discarded", {
		fetches: withResend(json(422, { message: "invalid" })),
	}),
	open("Resend refuses the key (403): the code is discarded", {
		fetches: withResend(json(403, { message: "forbidden" })),
	}),
	open("Resend rate limits (429): the code is discarded", {
		fetches: withResend(json(429, { message: "slow down" })),
	}),
	open("Resend fails (500): the code is kept", {
		fetches: withResend(json(500, { message: "oops" })),
	}),
	open("Resend is unavailable (503): the code is kept", {
		fetches: withResend(json(503, { message: "later" })),
	}),
	open("Resend is unreachable: the code is kept", {
		fetches: byHost({
			turnstile: json(200, { success: true }),
			resend: networkDown(),
		}),
	}),
	open("Resend answers 200 with an empty body", {
		fetches: withResend(text(200, "")),
	}),
	open("the discard batch fails and is swallowed", {
		fetches: withResend(json(422, { message: "invalid" })),
		failures: [
			{
				on: /DELETE FROM audio_client_signin_codes WHERE email=\? AND nonce_hash=\? AND code_hash=\?/,
				message: "d1 down",
			},
		],
	}),
	open("no ctx: the code is stored, nothing is sent, the visitor gets 503", {
		noContext: true,
	}),
	open("SITE_ORIGIN is unset", { omit: ["SITE_ORIGIN"] }),
	open("SITE_ORIGIN is another site", {
		env: { SITE_ORIGIN: "https://studio.example.test" },
	}),
	open("the mail goes to the normalised address", {
		steps: [ask({ email: " GRACE@example.test ", turnstileToken: "a+b&c=d" })],
	}),
	// races
	open("another browser asks at the same moment: both codes stay", {
		interleave: [
			{
				on: /INSERT INTO audio_client_signin_codes/,
				label: "another browser asked for a code a second ago",
				run: (sqlite) =>
					sqlite.exec(
						`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at) VALUES('other-browser','${GRACE}','other','0','2026-11-13T11:59:59.000Z','2026-11-13T12:09:59.000Z')`,
					),
			},
		],
	}),
	open("the project is revoked between the allowances and the issue", {
		interleave: [
			{
				on: /INSERT INTO audio_client_signin_codes/,
				label: "the owner revoked the project",
				run: (sqlite) =>
					sqlite.exec(
						"UPDATE audio_projects SET revoked_at='2026-11-13T11:59:59.000Z' WHERE request_id='r1'",
					),
			},
		],
	}),
	// outages
	open("the first allowance batch fails", {
		failures: [
			{ on: /DELETE FROM audio_client_allowances/, message: "d1 down" },
		],
	}),
	open("the second allowance batch fails", {
		failures: [
			{
				on: /DELETE FROM audio_client_allowances/,
				nth: 2,
				message: "d1 down",
			},
		],
	}),
	open("the issue batch fails", {
		failures: [
			{ on: /INSERT INTO audio_client_signin_codes/, message: "d1 down" },
		],
	}),
	// who is asking
	open("the owner asks", { steps: [form({ as: asOwner() })] }),
	open("a signed-in client asks", {
		music: {
			seed: mergeSeeds(client, {
				audio_client_sessions: [sessionRow(T1, GRACE)],
			}),
		},
		steps: [form({ as: asClientCookie(T1.value) })],
	}),
	// sequences into the session route
	open("ask, then sign in with the emailed code", {
		steps: [form(), signIn(FIRST)],
	}),
	open("ask, then sign in with the code written with a space", {
		steps: [form(), signIn("8483 5301")],
	}),
	open("ask, then a wrong code", { steps: [form(), signIn("00000000")] }),
	open("ask, five wrong codes, then the right one", {
		steps: [
			form(),
			...Array.from({ length: 5 }, () => signIn("00000000")),
			signIn(FIRST),
		],
	}),
	open("ask, four wrong codes, then the right one", {
		steps: [
			form(),
			...Array.from({ length: 4 }, () => signIn("00000000")),
			signIn(FIRST),
		],
	}),
	open("ask, sign in, ask again at once, then the old code again", {
		steps: [form(), signIn(FIRST), form({ advanceMs: 1000 }), signIn(FIRST)],
	}),
	open("ask, wait for the code to expire, then sign in", {
		steps: [form(), signIn(FIRST, { advanceMs: 600_000 })],
	}),
	open("ask, wait nine minutes fifty-nine, then sign in", {
		steps: [form(), signIn(FIRST, { advanceMs: 599_999 })],
	}),
	open("ask twice 31 seconds apart: the first code stops working", {
		steps: [form(), form({ advanceMs: 31_000 }), signIn(FIRST)],
	}),
	open("ask twice 31 seconds apart: the second code works", {
		steps: [form(), form({ advanceMs: 31_000 }), signIn(SECOND)],
	}),
	open("ask for another email's code then use it for this email", {
		music: { seed: mergeSeeds(client, audioClient("r2", OTHER)) },
		steps: [ask({ email: OTHER, turnstileToken: "tok" }), signIn(FIRST)],
	}),
];

defineCorpus("studio-code", POST, cases);
