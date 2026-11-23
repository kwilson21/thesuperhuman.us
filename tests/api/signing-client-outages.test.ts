import { describe, expect, it } from "vitest";
import { POST as LINK } from "~/pages/api/offer/[token]/link";
import { POST as DRAFT } from "~/pages/api/offer/[token]/draft";
import {
	GET as REVIEW_GET,
	POST as REVIEW,
} from "~/pages/api/offer/[token]/review";
import { POST as SIGN } from "~/pages/api/offer/[token]/sign";
import { isObject, isText } from "~/lib/type-guards";
import {
	asVisitor,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
	type Step,
} from "../golden/harness";
import type { Recorded } from "../golden/harness/plain";
import * as access from "../golden/areas/agreement-access";
import * as signing from "../golden/areas/signing";

// How the four client routes of website signing answer a failure on the site's side, after the behaviour fixes of
// docs/plans/2026-11-signing-conversion.md, section 5 (B1, B2, B5's draft and link cases, B6), on the owner's decisions of
// 2026-11-14 (an unexpected store failure answers 500 with the route's fixed sentence, never the error's text, logged once)
// and 2026-11-23 (Q2's sentences; Q3, success with the receipt). A refusal (a guard that raised, a lost race, a sentence the
// code wrote) keeps its answer and logs nothing. Each case runs on the golden harness: the real schema on SQLite, the
// statements a failure names made to throw.

const DOWN = "D1_ERROR: private details for grace@example.test";

const LINK_FAILED = "Agreement sign-in is temporarily unavailable.";
const DRAFT_FAILED = "Your details could not be saved. Try again in a moment.";
const REVIEW_FAILED = "The agreement could not be reviewed.";
const SIGN_FAILED = "Your signature could not be saved. Try again in a moment.";

const SIGN_CHANGED =
	"The reviewed agreement changed. Reload and review it again.";

const SIGNING_SETTING = /FROM software_signing_settings/;

const OFFER_LOOKUP =
	/FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id\s+JOIN owner_requests/;

const SESSION_LOOKUP = /SELECT \* FROM software_agreement_sessions/;

const AGREEMENTS_READ =
	/FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/;

const LINK_INSERT = /INSERT INTO software_agreement_links/;

const DRAFT_INSERT = /INSERT INTO software_agreement_drafts/;

const SIGNATURE_INSERT = /INSERT INTO software_agreement_signatures/;

/** What a step answered, and what the case logged. */
type Seen = {
	readonly status: number | "rejected";
	readonly body: string;
	readonly logs: readonly string[];
};

const isTable = (
	value: Recorded | undefined,
): value is { [key: string]: Recorded } =>
	isObject(value) && !Array.isArray(value);

/** The rows of a music table that a step dumped. */
function dumped(record: CaseRecord, table: string, step = 0): Recorded[] {
	const state = record.steps[step]?.state ?? undefined;
	const music = isTable(state) ? state.music : undefined;
	const rows = isTable(music) ? music[table] : undefined;

	return Array.isArray(rows) ? rows : [];
}

/** Every console line the case wrote, each joined into one line. */
const logsOf = (record: CaseRecord) =>
	record.effects.flatMap((effect) =>
		effect.kind === "console" ? [effect.args.map(String).join(" ")] : [],
	);

function seen(record: CaseRecord, step = 0): Seen {
	const answer = record.steps[step].answer;

	return {
		status: answer.outcome === "response" ? answer.status : "rejected",
		body:
			answer.outcome === "response" && isText(answer.body) ? answer.body : "",
		logs: logsOf(record),
	};
}

const run = async (handler: Handler, c: Omit<Case, "name">) =>
	runCase(handler, { name: "signing client outage", ...c });

const failing = (on: RegExp, nth = 1) => ({
	failures: [{ on, nth, message: DOWN }],
});

const json = (error: string) => JSON.stringify({ ok: false, error });

/** The one line a fault logs: the route's label and the error's name and message, the address in it redacted. */
const logged = (label: string) => [
	`${label} failed unexpectedly: Error D1_ERROR: private details for [email]`,
];

// ---- POST /api/offer/[token]/link ----

const linkStep = (form = false): Step => ({
	as: asVisitor({ ip: access.IP }),
	path: `/api/offer/${access.TOKEN}/link`,
	params: { token: access.TOKEN },
	dump: { music: access.LINK_TABLES },
	...(form
		? {
				body: access.formBody({ "cf-turnstile-response": "tok" }),
				headers: access.formHeaders(),
			}
		: { json: { turnstileToken: "tok" }, headers: access.SAME_ORIGIN }),
});

const linkCase = (
	over: Omit<Case, "name" | "steps"> = {},
	opts: access.Opts = {},
	form = false,
): Omit<Case, "name"> => ({
	...access.agreementWorld({ session: null, ...opts }),
	fetches: access.mail,
	steps: [linkStep(form)],
	...over,
});

describe("POST /api/offer/[token]/link", () => {
	it("answers a failed read 500 with its sentence and logs it once, without the error's text in the answer (B1)", async () => {
		const record = await run(LINK, linkCase(failing(SIGNING_SETTING)));

		expect(seen(record)).toEqual({
			status: 500,
			body: json(LINK_FAILED),
			logs: logged("Agreement link"),
		});
	});

	it("answers a link batch that failed for no guard 500, with nothing stored (B1, the archive link's fix 6)", async () => {
		const record = await run(LINK, linkCase(failing(LINK_INSERT)));

		expect(seen(record)).toEqual({
			status: 500,
			body: json(LINK_FAILED),
			logs: logged("Agreement link"),
		});
		expect(dumped(record, "software_agreement_links")).toEqual([]);
	});

	it("keeps the 429 when a guard of the link batch raised, and logs nothing", async () => {
		const record = await run(
			LINK,
			linkCase(
				{},
				{
					extra: {
						software_agreement_links: [
							{
								id: "link-recent",
								purpose: "agreement",
								offer_id: "o-r1",
								link_hash: "hash-of-the-offer-link",
								recipient_email: access.GRACE,
								token_hash: "token-hash-of-a-recent-agreement-link",
								issued_at: "2026-11-13T11:59:40.000Z",
								expires_at: "2026-11-13T12:59:40.000Z",
								used_at: null,
							},
						],
					},
				},
			),
		);

		expect(seen(record)).toEqual({
			status: 429,
			body: json("Wait at least 30 seconds before requesting another link."),
			logs: [],
		});
	});

	it("answers an offer whose terms are not JSON 500, logging the parser's error without its message (B5)", async () => {
		const record = await run(
			LINK,
			linkCase({}, { offer: { terms_json: "not json" } }),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(LINK_FAILED),
			logs: ["Agreement link failed unexpectedly: SyntaxError "],
		});
	});

	it("keeps the 503 for a code key under 32 characters, before any allowance and with nothing logged", async () => {
		const record = await run(
			LINK,
			linkCase({ env: { AUDIO_CLIENT_CODE_KEY: "k".repeat(31) } }),
		);

		expect(seen(record)).toEqual({
			status: 503,
			body: json(LINK_FAILED),
			logs: [],
		});
		expect(dumped(record, "audio_client_allowances")).toEqual([]);
	});

	it("renders the 500 of a native form post as its page", async () => {
		const record = await run(LINK, linkCase(failing(OFFER_LOOKUP), {}, true));
		const answer = seen(record);

		expect(answer.status).toBe(500);
		expect(answer.body).toContain(LINK_FAILED);
		expect(answer.body).not.toContain("D1_ERROR");
		expect(answer.logs).toEqual(logged("Agreement link"));
	});
});

// ---- POST /api/offer/[token]/draft ----

const drafts = access.wireKit(
	`/api/offer/${access.TOKEN}/draft`,
	access.DRAFT_TABLES,
);

const draftCase = (over: Partial<Case> = {}) => {
	const [one] = drafts.scenario("draft", { wires: ["json"], over });

	return one;
};

describe("POST /api/offer/[token]/draft", () => {
	it.each([
		["the offer lookup", OFFER_LOOKUP],
		["the session lookup", SESSION_LOOKUP],
		["the signing setting", SIGNING_SETTING],
	])(
		"answers a failed read (%s) 500 with Q2's sentence, logged once (B2)",
		async (_name, on) => {
			const record = await run(DRAFT, draftCase(failing(on)));

			expect(seen(record)).toEqual({
				status: 500,
				body: json(DRAFT_FAILED),
				logs: logged("Agreement draft"),
			});
		},
	);

	it("answers a draft batch that failed for no guard 500, with nothing saved (B1)", async () => {
		const record = await run(DRAFT, draftCase(failing(DRAFT_INSERT)));

		expect(seen(record)).toEqual({
			status: 500,
			body: json(DRAFT_FAILED),
			logs: logged("Agreement draft"),
		});
		expect(dumped(record, "software_agreement_drafts")).toEqual([]);
	});

	it("keeps the 409 when a guard of the batch raised (the session revoked since the read), and logs nothing", async () => {
		const record = await run(
			DRAFT,
			draftCase({
				interleave: [
					{
						on: DRAFT_INSERT,
						label: "another tab signs out",
						run: (sqlite) =>
							sqlite.exec(
								"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
							),
					},
				],
			}),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(
				"Your details could not be saved. Check the fields and try again.",
			),
			logs: [],
		});
	});

	it("answers a JSON null body 403, as the review route does, with nothing saved (B5)", async () => {
		const record = await run(DRAFT, {
			...access.agreementWorld(),
			steps: [
				{
					as: asVisitor({ ip: access.IP }),
					path: `/api/offer/${access.TOKEN}/draft`,
					params: { token: access.TOKEN },
					json: null,
					headers: { ...access.SAME_ORIGIN, ...access.cookie() },
					dump: { music: access.DRAFT_TABLES },
				},
			],
		});

		expect(seen(record)).toEqual({
			status: 403,
			body: json("Reload and try again."),
			logs: [],
		});
		expect(dumped(record, "software_agreement_drafts")).toEqual([]);
	});
});

// ---- GET and POST /api/offer/[token]/review ----

const reviews = access.wireKit(
	`/api/offer/${access.TOKEN}/review`,
	access.REVIEW_TABLES,
);

describe("/api/offer/[token]/review", () => {
	it.each([
		["the offer lookup", OFFER_LOOKUP],
		["the session lookup", SESSION_LOOKUP],
		["the signing setting", SIGNING_SETTING],
	])(
		"answers a failed read before the details (%s) 500, logged once (B2)",
		async (_name, on) => {
			const [one] = reviews.scenario("review", {
				wires: ["json"],
				over: failing(on),
			});

			expect(seen(await run(REVIEW, one))).toEqual({
				status: 500,
				body: json(REVIEW_FAILED),
				logs: logged("Agreement review"),
			});
		},
	);

	it("renders the 500 of a native form post as its page", async () => {
		const [one] = reviews.scenario("review", {
			wires: ["form values"],
			over: failing(SESSION_LOOKUP),
		});

		const answer = seen(await run(REVIEW, one));

		expect(answer.status).toBe(500);
		expect(answer.body).toContain(REVIEW_FAILED);
		expect(answer.logs).toEqual(logged("Agreement review"));
	});

	it.each([
		["the session lookup", SESSION_LOOKUP],
		["the signing setting", SIGNING_SETTING],
		["the agreements lookup", AGREEMENTS_READ],
	])(
		"answers a download whose read failed (%s) 500, logged once (B2)",
		async (_name, on) => {
			const record = await run(REVIEW_GET, {
				...access.agreementWorld({ agreements: "review" }),
				...failing(on),
				steps: [
					{
						method: "GET",
						as: asVisitor({ ip: access.IP }),
						path: `/api/offer/${access.TOKEN}/review?document=ag-sow`,
						params: { token: access.TOKEN },
						headers: access.cookie(),
					},
				],
			});

			expect(seen(record)).toEqual({
				status: 500,
				body: json(REVIEW_FAILED),
				logs: logged("Agreement review"),
			});
		},
	);
});

// ---- POST /api/offer/[token]/sign ----

const signCase = (
	over: Omit<Case, "name" | "steps"> = {},
	sc: signing.Scene = {},
	steps: Step[] = [signing.signJson(signing.signBody())],
): Omit<Case, "name"> => ({
	...signing.scene(sc),
	fetches: signing.resendOk,
	steps,
	...over,
});

describe("POST /api/offer/[token]/sign", () => {
	it.each([
		["the offer lookup", OFFER_LOOKUP],
		["the session lookup", SESSION_LOOKUP],
		["the signing setting", SIGNING_SETTING],
		["the first read of the agreements", AGREEMENTS_READ],
		["the draft lookup", /SELECT values_json FROM software_agreement_drafts/],
	])(
		"answers a failed read (%s) 500 with Q2's sentence, logged once (B1, B2)",
		async (_name, on) => {
			const record = await run(SIGN, signCase(failing(on)));

			expect(seen(record)).toEqual({
				status: 500,
				body: json(SIGN_FAILED),
				logs: logged("Agreement signing"),
			});
		},
	);

	it("answers a signing batch that failed for no guard 500, with no signature saved (B1)", async () => {
		const record = await run(SIGN, signCase(failing(SIGNATURE_INSERT)));

		expect(seen(record)).toEqual({
			status: 500,
			body: json(SIGN_FAILED),
			logs: logged("Agreement signing"),
		});
		expect(dumped(record, "software_agreement_signatures")).toEqual([]);
	});

	it("renders the 500 of a native form post as its page", async () => {
		const record = await run(
			SIGN,
			signCase(failing(SIGNATURE_INSERT), {}, [
				signing.signForm(signing.formFields(signing.signBody())),
			]),
		);

		const answer = seen(record);

		expect(answer.status).toBe(500);
		expect(answer.body).toContain(SIGN_FAILED);
		expect(answer.body).not.toContain("D1_ERROR");
		expect(answer.logs).toEqual(logged("Agreement signing"));
	});

	it.each([
		[
			"a guard (the session revoked since the read)",
			"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T10:00:00.000Z'",
		],
		[
			"a foreign key (the documents deleted since the read)",
			"DELETE FROM software_agreements",
		],
		[
			"a unique index (a signature row saved since the read)",
			`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES('s-x','${signing.MSA_ID}','client','x','x','x','v','t','t','h','e','t','m','i','[]','r','','')`,
		],
	])(
		"keeps the 409 when the batch is refused by %s, and logs nothing",
		async (_name, sql) => {
			const record = await run(
				SIGN,
				signCase({
					interleave: [
						{
							on: SIGNATURE_INSERT,
							label: "another request",
							run: (s) => s.exec(sql),
						},
					],
				}),
			);

			expect(seen(record)).toEqual({
				status: 409,
				body: json(SIGN_CHANGED),
				logs: [],
			});
		},
	);

	it("keeps the 409 for stored values it cannot read, and logs nothing", async () => {
		const values = JSON.stringify({ client: signing.CLIENT });

		const record = await run(
			SIGN,
			signCase(
				{},
				{
					msa: signing.doc("review", { row: { values_json: values } }),
					sow: signing.doc("review", { row: { values_json: values } }),
				},
			),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(SIGN_CHANGED),
			logs: [],
		});
	});

	it("answers 200 with the receipt when the read after the signatures fails, with the notices left for the owner (B6, Q3)", async () => {
		const record = await run(SIGN, signCase(failing(AGREEMENTS_READ, 2)));
		const answer = seen(record);

		expect(answer.status).toBe(200);
		expect(JSON.parse(answer.body)).toEqual({
			ok: true,
			receipt_id: expect.any(String),
		});
		expect(answer.logs).toEqual([]);
		expect(dumped(record, "software_agreement_signatures")).toHaveLength(2);
		expect(
			dumped(record, "software_agreement_notifications").map((row) =>
				isTable(row) ? row.status : null,
			),
		).toEqual(["pending", "pending"]);
		expect(
			record.effects.filter(
				(effect) => effect.kind === "fetch" && effect.host === "resend",
			),
		).toEqual([]);
	});
});
