import { POST } from "~/pages/api/studio/sign-out";
import {
	asClient,
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";
import {
	audioClient,
	GRACE,
	mergeSeeds,
	OTHER,
	sessionRow,
	T1,
	T2,
	T3,
	T4,
} from "./areas/studio-access";

// The golden corpus for POST /api/studio/sign-out: the client's session is revoked and the cookie is cleared. The route
// has no Origin check, no body and no audit row; whoever holds the cookie value can end the session.
//
// Every response branch of the handler, revokeClientSession and studioSessionFromRequest (src/lib/audio-client-access.ts),
// and its cases:
//
//   404 text "Not found"                  portal flag unset, "false", "TRUE"; read before the database binding, and with no
//                                         set-cookie header
//   503 {ok:false,localSignedOut:true}    no MUSIC_DB (the cookie is cleared anyway); the revoking statement fails (cookie
//                                         cleared anyway)
//   200 {ok:true} + cleared cookie        no cookie (no statement), another cookie only, a cookie that is not 72 characters of
//                                         hex and dashes, 73 characters, a name with a prefix, spaces around the equals sign,
//                                         an unknown token (UPDATE changes nothing), a live session (revoked), an already
//                                         revoked session (revoked_at kept), an expired session (revoked), a session of a client
//                                         with no active project, an upper-case token (the pattern matches, the hash does not,
//                                         so the session stays live), the cookie among others, two cookies of that name (the
//                                         valid one is found), another client's session untouched, a foreign Origin and a body
//                                         (both ignored), the owner, a signed-in client from the real sign-in, twice in a row
//   cookie                                "studio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure" on https (every
//                                         case but the three below); the same without "; Secure" for a request from
//                                         http://localhost:4321: a live session revoked, no database binding, and the
//                                         revoking statement failing (the cookie is non-Secure on all three answers)

const URL_PATH = "/api/studio/sign-out";

const tables = [
	"audio_client_sessions",
	"audio_client_signin_codes",
	"audio_client_access_audit",
];

const out = (extra: Partial<Step> = {}): Step => ({
	as: asClientCookie(T1.value),
	path: URL_PATH,
	dump: { music: tables },
	...extra,
});

const withCookie = (cookie: string, extra: Partial<Step> = {}) =>
	out({ as: asVisitor(), headers: { cookie }, ...extra });

const live = mergeSeeds(audioClient("r1", GRACE), {
	audio_client_sessions: [sessionRow(T1, GRACE)],
});

const open = (name: string, extra: Partial<Case> = {}): Case => ({
	name,
	music: { seed: live },
	steps: [out()],
	...extra,
});

const THIS = `studio_session=${T1.value}`;

const cases: Case[] = [
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
	open("no database binding and no cookie", {
		music: { missing: true },
		steps: [out({ as: asVisitor() })],
	}),
	open("no cookie", { steps: [out({ as: asVisitor() })] }),
	open("another cookie only", { steps: [withCookie("theme=dark")] }),
	open("a cookie that is too short", {
		steps: [withCookie("studio_session=abc123")],
	}),
	open("a cookie of 73 characters", {
		steps: [withCookie(`${THIS}0`)],
	}),
	open("a cookie with characters that are not hex", {
		steps: [withCookie(`studio_session=${"z".repeat(72)}`)],
	}),
	open("a cookie name with a prefix", {
		steps: [withCookie(`x${THIS}`)],
	}),
	open("spaces around the equals sign", {
		steps: [withCookie(`studio_session = ${T1.value}`)],
	}),
	open("an empty cookie value", {
		steps: [withCookie("studio_session=")],
	}),
	open("an unknown token of the right shape", {
		steps: [withCookie(`studio_session=${T2.value}`)],
	}),
	open("a live session is revoked", {}),
	open("an already revoked session keeps its revoked_at", {
		music: {
			seed: mergeSeeds(audioClient("r1", GRACE), {
				audio_client_sessions: [
					sessionRow(T1, GRACE, { revoked_at: "2026-11-13T11:30:00.000Z" }),
				],
			}),
		},
	}),
	open("an expired session is revoked", {
		music: {
			seed: mergeSeeds(audioClient("r1", GRACE), {
				audio_client_sessions: [
					sessionRow(T1, GRACE, { expires_at: "2026-11-13T11:59:00.000Z" }),
				],
			}),
		},
	}),
	open("a client with no active project can still sign out", {
		music: {
			seed: mergeSeeds(audioClient("r1", GRACE, { status: "withdrawn" }), {
				audio_client_sessions: [sessionRow(T1, GRACE)],
			}),
		},
	}),
	open("an upper-case token matches the pattern but not the hash", {
		music: {
			seed: mergeSeeds(audioClient("r1", GRACE), {
				audio_client_sessions: [sessionRow(T4, GRACE)],
			}),
		},
		steps: [withCookie(`studio_session=${T4.value.toUpperCase()}`)],
	}),
	open("the cookie among others", {
		steps: [withCookie(`theme=dark; ${THIS}; lang=en`)],
	}),
	open("two cookies of that name, the valid one second", {
		steps: [withCookie(`studio_session=${"0".repeat(10)}; ${THIS}`)],
	}),
	open("another client's session is untouched", {
		music: {
			seed: mergeSeeds(audioClient("r1", GRACE), audioClient("r2", OTHER), {
				audio_client_sessions: [
					sessionRow(T1, GRACE),
					sessionRow(T2, OTHER),
					sessionRow(T3, GRACE),
				],
			}),
		},
	}),
	open("a foreign Origin is not checked", {
		steps: [out({ headers: { origin: "https://evil.example" } })],
	}),
	open("a JSON body is ignored", {
		steps: [out({ json: { token: T2.value } })],
	}),
	open("a text body is ignored", {
		steps: [out({ body: "sign me out please" })],
	}),
	open("the owner with a client cookie", {
		steps: [out({ as: asOwner(), headers: { cookie: THIS } })],
	}),
	open("signing out twice", { steps: [out(), out({ advanceMs: 60_000 })] }),
	open("the revoking statement fails", {
		failures: [
			{ on: /UPDATE audio_client_sessions SET revoked_at/, message: "d1 down" },
		],
	}),
	open(
		"a live session is revoked over http on localhost, and the cookie is not Secure",
		{
			steps: [out({ origin: "http://localhost:4321" })],
		},
	),
	open(
		"no database binding over http on localhost clears a non-Secure cookie",
		{
			music: { missing: true },
			steps: [out({ origin: "http://localhost:4321" })],
		},
	),
	open(
		"the revoking statement failing over http on localhost clears a non-Secure cookie",
		{
			steps: [out({ origin: "http://localhost:4321" })],
			failures: [
				{
					on: /UPDATE audio_client_sessions SET revoked_at/,
					message: "d1 down",
				},
			],
		},
	),
	open("a client signed in through the real flow signs out", {
		music: { seed: audioClient("r1", GRACE) },
		steps: [out({ as: asClient(GRACE) })],
	}),
	open("a real sign-in, then signing out twice", {
		music: { seed: audioClient("r1", GRACE) },
		steps: [out({ as: asClient(GRACE) }), out({ as: asClient(GRACE) })],
	}),
];

defineCorpus("studio-sign-out", POST, cases);
