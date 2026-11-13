import { POST } from "~/pages/api/software-inquiry";
import {
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	text,
	type Case,
	type Dump,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonObject, JsonValue } from "../helpers/json";
import {
	allGood,
	IP,
	ORIGIN,
	outside,
	rawVisit,
	resend,
	visit,
} from "./areas/public";

// The golden corpus for POST /api/software-inquiry: a visitor sends a project brief. The route stores a software
// owner request keyed by the visitor's submission id, emails the visitor a copy of the brief, and tells the owner.
//
// Every response branch and effect path, and the cases that reach them:
//
//   musicRequest (src/lib/music-request.ts)
//   403 / 415 / 400 / 413 / 400        the same five guards as audio-intake: Origin, content type, no body, over 32768
//                                      bytes, text that is not JSON
//   400 { errors }  validateSoftwareInquiry (src/lib/software-inquiry.ts)
//     path                             missing, unknown, not text, each of the four paths valid
//     common fields                    name, email, company, timing (every value, bad value), timingDate (valid date,
//                                      not a date, impossible day, not text, with and without timing=date), timingReason,
//                                      budgetStatus (every value, bad), budgetNote, approver (every value, bad),
//                                      approverRole (kept for "other", cleared otherwise), turnstileToken, submissionId
//     per-path fields                  website (purpose, currentUrl in every message branch, existing, updates),
//                                      webapp (appGoal, firstVersion), workflow (today, audience, firstResult), idea
//                                      (idea, audienceToday, firstVersion, signal); each missing, too long, wrong type
//     line rules                       a newline in every one-line field, control characters in every question field
//     bodies that are not objects      null, array, string, number, empty object (first issue per field wins)
//   503 "Sending is unavailable"       no MUSIC_DB, no Turnstile secret, no RATE_LIMIT
//   429 attempt limit                  ten attempts; a count that is not a number
//   403 Turnstile                      refused, 5xx, network down, unreadable
//   duplicate submission id            same email (any case), different email (409), stored copy status sent, uncertain,
//                                      failed, absent; the lookup throws (alert, 503); a duplicate does not touch the
//                                      request counter
//   429 request limit                  one saved brief per address per window
//   saving                             insert batch throws (counter cleared, alert), another request saved the same id
//                                      first (same email: 200 with the stored brief; different email: 409), the delete
//                                      throws (outer catch), the read-back throws
//   the client copy                    sent, refused 400, 5xx and network down (uncertain), no key, sender or owner
//                                      address (failed), the claim finds nothing (status null), the claim throws, the
//                                      status write throws after the provider started or before it, both throw, the
//                                      status write finds the attempt time changed
//   the owner notice                   sent, refused, 5xx, network down, no key, sender or owner address; waitUntil with a
//                                      context and awaited inline without one
//   200 { ok, brief, clientCopyStatus} every path, summary rules (first sentence, 80 graphemes, whitespace, emoji),
//                                      unicode and markup characters; the largest brief that validation allows
//   sequences                          same id twice, two ids from one address, retry after a storage failure, two
//                                      addresses with one id and different emails, a copy refused and then retried

const PATH = "/api/software-inquiry";
const SID = "5b0c1f3e-8a2d-4c6e-9f10-3d7a2b9e4c11";
const OTHER_SID = "7c2d4f6a-1b3e-4a5c-8d9f-0e1a2b3c4d5e";

const common: JsonObject = {
	name: "Grace Hopper",
	email: "Grace@Example.com",
	company: "Navy Labs",
	timing: "flexible",
	timingDate: "",
	timingReason: "",
	budgetStatus: "",
	budgetNote: "",
	approver: "",
	approverRole: "",
	turnstileToken: "token-1",
	submissionId: SID,
};

const website: JsonObject = {
	...common,
	path: "website",
	purpose: "A site for my bakery. People can order ahead.",
	currentUrl: "https://bakery.example.test",
	existing: "A logo and photos",
	updates: "self",
};

const webapp: JsonObject = {
	...common,
	path: "webapp",
	appGoal: "Track orders for the shop.",
	firstVersion: "Add an order",
};

const workflow: JsonObject = {
	...common,
	path: "workflow",
	today: "We copy rows by hand. It takes an hour.",
	audience: "The operations team",
	firstResult: "One click export",
};

const idea: JsonObject = {
	...common,
	path: "idea",
	idea: "A tool that shows the tides.",
	audienceToday: "Sailors who use a paper chart",
	firstVersion: "Show tide times",
	signal: "Ten people use it weekly",
};

const FINAL: Dump = {
	music: ["owner_requests", "owner_request_audit"],
	kv: ["RATE_LIMIT"],
};

const send = (body: JsonValue | undefined, over: Partial<Step> = {}): Step =>
	visit(PATH, body, over);

const single = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	steps: [send(body, over)],
	fetches: allGood,
	final: FINAL,
	...extra,
});

const withBody = (
	name: string,
	base: JsonObject,
	change: JsonObject,
	extra: Partial<Case> = {},
) => single(name, { ...base, ...change }, extra);

const raw = (
	name: string,
	body: string | undefined,
	headers: { [name: string]: string },
): Case => ({
	name,
	steps: [rawVisit(PATH, body, headers)],
	fetches: allGood,
	final: FINAL,
});

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };
const websiteText = JSON.stringify(website);

const fails = (on: RegExp, ...more: RegExp[]) => ({
	failures: [on, ...more].map((pattern) => ({
		on: pattern,
		message: "d1 down",
	})),
});

// A request already stored under the submission id.
const stored = (over: SeedRow = {}) =>
	rows.softwareRequest("r1", {
		name: "Grace Hopper",
		email: "grace@example.com",
		service_id: "workflow",
		summary: "We copy rows by hand.",
		submission_id: SID,
		details_json: JSON.stringify({
			path: "workflow",
			today: "We copy rows by hand.",
			audience: "Ops",
			firstResult: "",
			timing: "month",
			budgetStatus: "approved",
			clientCopyStatus: "sent",
		}),
		...over,
	});

const priorCase = (name: string, over: SeedRow, body: JsonObject = workflow) =>
	single(name, body, { music: { seed: { owner_requests: [stored(over)] } } });

const detailsWith = (details: JsonObject) =>
	JSON.stringify({
		path: "workflow",
		today: "We copy rows by hand.",
		timing: "month",
		...details,
	});

const insertOther = (email: string) => ({
	interleave: [
		{
			on: /INSERT INTO owner_requests/,
			label: `another request saves this submission id for ${email}`,
			run: (sqlite: { exec: (statement: string) => void }) =>
				sqlite.exec(
					`INSERT INTO owner_requests(id,kind,name,email,summary,details_json,status,created_at,updated_at,submission_id) VALUES('raced','software','Grace','${email}','We copy rows','{"path":"workflow","today":"We copy rows","clientCopyStatus":"sent"}','new','2026-11-13T11:59:00.000Z','2026-11-13T11:59:00.000Z','${SID}')`,
				),
		},
	],
});

const claimRace = (sql: string, on: RegExp, label: string) => ({
	interleave: [
		{
			on,
			label,
			run: (sqlite: { exec: (statement: string) => void }) => sqlite.exec(sql),
		},
	],
});

const CLAIM = /'\$\.clientCopyStatus','uncertain'/;
const COPY_STATUS = /clientCopyStatus',\?\)/;
const COPY_FAILED = /clientCopyStatus','failed'/;
const LOOKUP = /WHERE submission_id=\?/;
const INSERT = /INSERT INTO owner_requests/;

// Every field of every path, once as a way to check each is stored and shown in the brief.
const fullWebsite: JsonObject = {
	...website,
	company: "Bakery Co",
	timing: "date",
	timingDate: "2027-01-15",
	timingReason: "Opening day",
	budgetStatus: "approved",
	budgetNote: "About ten thousand",
	approver: "other",
	approverRole: "Owner",
};

const lineFields = [
	"name",
	"email",
	"company",
	"timingReason",
	"budgetNote",
	"approverRole",
];

const controlFields = [
	"name",
	"email",
	"company",
	"timingReason",
	"budgetNote",
	"approverRole",
	"purpose",
	"existing",
	"updates",
	"currentUrl",
];

const cases: Case[] = [
	// --- 200, each path
	single("a website brief with every field", fullWebsite),
	single("a minimal website brief", {
		name: "Grace",
		email: "g@example.com",
		timing: "asap",
		turnstileToken: "t",
		submissionId: SID,
		path: "website",
		purpose: "A site",
		updates: "unsure",
	}),
	single("a web app brief", webapp),
	single("a workflow brief", workflow),
	single("an idea brief (the retired path, still accepted)", idea),
	withBody(
		"a minimal workflow brief",
		{},
		{
			path: "workflow",
			name: "G",
			email: "g@example.com",
			timing: "month",
			turnstileToken: "t",
			submissionId: SID,
			today: "Copying",
		},
	),
	withBody("timing within a month", workflow, { timing: "month" }),
	withBody("timing in one to three months", workflow, { timing: "quarter" }),
	withBody("timing as soon as possible", workflow, { timing: "asap" }),
	withBody("timing by a date", workflow, {
		timing: "date",
		timingDate: "2027-02-28",
	}),
	withBody("a date on a leap day", workflow, {
		timing: "date",
		timingDate: "2028-02-29",
	}),
	withBody("a date given while the timing is flexible", workflow, {
		timingDate: "2027-02-28",
	}),
	withBody("a bad date given while the timing is flexible", workflow, {
		timingDate: "tomorrow",
	}),
	withBody("budget approved", workflow, { budgetStatus: "approved" }),
	withBody("budget waiting for approval", workflow, {
		budgetStatus: "pending",
	}),
	withBody("budget still exploring", workflow, { budgetStatus: "exploring" }),
	withBody("budget not sure", workflow, { budgetStatus: "unsure" }),
	withBody(
		"the approver is the visitor, with a role that is dropped",
		workflow,
		{
			approver: "self",
			approverRole: "CEO",
		},
	),
	withBody("the approver is someone else, with a role kept", workflow, {
		approver: "other",
		approverRole: "CFO",
	}),
	withBody("the approver is not sure, with a role that is dropped", workflow, {
		approver: "unsure",
		approverRole: "CFO",
	}),
	withBody("a website with every updates choice: help", website, {
		updates: "help",
	}),
	withBody(
		"a website brief with a link that has a path, query and fragment",
		website,
		{
			currentUrl: "https://bakery.example.test/menu?x=1#top",
		},
	),
	withBody("a website brief with an http link", website, {
		currentUrl: "http://bakery.example.test",
	}),
	withBody("padding around every text field is trimmed", workflow, {
		name: "  Grace  ",
		email: "  grace@example.com  ",
		company: "  Navy  ",
		today: "  Copying rows  ",
		turnstileToken: " token-1 ",
	}),
	withBody("extra keys in the body are dropped", workflow, {
		admin: true,
		status: "resolved",
		id: "x",
	}),
	withBody("text with unicode", workflow, {
		name: "Zoë Ångström",
		today: "夜の作業。毎日コピーします。",
		audience: "Équipe 🎵",
	}),
	withBody("text with markup characters and quotes", workflow, {
		name: `<b>"Grace"</b> & Co`,
		today: `<script>alert(1)</script> & "quotes" 'single'`,
		audience: "a < b > c",
		company: "<i>Navy</i>",
	}),
	withBody("tabs and line breaks in the long answers are kept", workflow, {
		today: "line one\nline two\r\n\tindented",
		audience: "a\nb",
	}),
	withBody("a summary of the first sentence only", workflow, {
		today: "First sentence. Second sentence! Third?",
	}),
	withBody("a summary cut at 80 characters", workflow, {
		today: "w".repeat(200),
	}),
	withBody("a summary with whitespace folded", workflow, {
		today: "  many    spaces\n\nand\tlines   here  ",
	}),
	withBody("a summary cut between emoji clusters", workflow, {
		today: "👨‍👩‍👧‍👦".repeat(100),
	}),
	withBody("a summary that ends in trailing spaces after the cut", workflow, {
		today: `${"a".repeat(79)} bbbbbb`,
	}),
	single("the largest website brief validation allows", {
		...website,
		purpose: `${'"'.repeat(1999)}x`,
		currentUrl: `https://a.example.test/?${'"'.repeat(2024)}`,
		existing: '"'.repeat(2000),
		company: '"'.repeat(120),
		timingReason: '"'.repeat(500),
		budgetNote: '"'.repeat(200),
		approver: "other",
		approverRole: '"'.repeat(120),
	}),

	// --- musicRequest
	raw("no Origin header", websiteText, { "content-type": "application/json" }),
	raw("an Origin that is another site", websiteText, {
		origin: "https://evil.example.com",
		"content-type": "application/json",
	}),
	raw("a text/plain content type", websiteText, {
		origin: ORIGIN,
		"content-type": "text/plain",
	}),
	raw("a form content type", "a=1", {
		origin: ORIGIN,
		"content-type": "application/x-www-form-urlencoded",
	}),
	raw("no body at all", undefined, jsonHeaders),
	raw(
		"a body over 32768 bytes",
		JSON.stringify({ ...workflow, today: "x".repeat(33_000) }),
		jsonHeaders,
	),
	raw("text that is not JSON", "{not json", jsonHeaders),
	raw("an empty body", "", jsonHeaders),

	// --- validation, bodies and path
	single("a null body", null),
	single("an array body", []),
	single("a string body", "hello"),
	single("a number body", 42),
	single("an empty object body", {}),
	withBody("path missing", workflow, { path: undefined }),
	withBody("path unknown", workflow, { path: "mobile" }),
	withBody("path not text", workflow, { path: 7 }),
	withBody("path is the name of an inherited property", workflow, {
		path: "constructor",
	}),

	// --- validation, common fields
	withBody("name missing", workflow, { name: undefined }),
	withBody("name only whitespace", workflow, { name: "   " }),
	withBody("name 101 characters", workflow, { name: "n".repeat(101) }),
	withBody("name not text", workflow, { name: 5 }),
	withBody("email invalid", workflow, { email: "grace@" }),
	withBody("email 121 characters", workflow, {
		email: `${"e".repeat(117)}@x.co`,
	}),
	withBody("email not text", workflow, { email: ["a@b.co"] }),
	withBody("company 121 characters", workflow, { company: "c".repeat(121) }),
	withBody("company not text", workflow, { company: { a: 1 } }),
	withBody("timing missing", workflow, { timing: undefined }),
	withBody("timing unknown", workflow, { timing: "never" }),
	withBody("timingDate in the wrong format", workflow, {
		timing: "date",
		timingDate: "13/01/2027",
	}),
	withBody("timingDate that is not a real day", workflow, {
		timing: "date",
		timingDate: "2027-02-30",
	}),
	withBody("timingDate that is not text", workflow, {
		timing: "date",
		timingDate: 20270115,
	}),
	withBody("timingDate empty while the timing is a date", workflow, {
		timing: "date",
		timingDate: "",
	}),
	withBody("timingDate left out while the timing is a date", workflow, {
		timing: "date",
		timingDate: undefined,
	}),
	withBody("timingReason 501 characters", workflow, {
		timingReason: "r".repeat(501),
	}),
	withBody("budgetStatus unknown", workflow, { budgetStatus: "rich" }),
	withBody("budgetNote 201 characters", workflow, {
		budgetNote: "b".repeat(201),
	}),
	withBody("approver unknown", workflow, { approver: "boss" }),
	withBody("approverRole 121 characters", workflow, {
		approver: "other",
		approverRole: "r".repeat(121),
	}),
	withBody("turnstileToken missing", workflow, { turnstileToken: undefined }),
	withBody("turnstileToken empty", workflow, { turnstileToken: "" }),
	withBody("turnstileToken 2049 characters", workflow, {
		turnstileToken: "t".repeat(2049),
	}),
	withBody("submissionId missing", workflow, { submissionId: undefined }),
	withBody("submissionId not a uuid", workflow, { submissionId: "abc" }),
	withBody("submissionId not text", workflow, { submissionId: 12 }),

	// --- validation, per path
	withBody("website purpose missing", website, { purpose: undefined }),
	withBody("website purpose only whitespace", website, { purpose: "  " }),
	withBody("website purpose 2001 characters", website, {
		purpose: "p".repeat(2001),
	}),
	withBody("website existing 2001 characters", website, {
		existing: "e".repeat(2001),
	}),
	withBody("website updates missing", website, { updates: undefined }),
	withBody("website updates unknown", website, { updates: "robot" }),
	withBody("website updates not text", website, { updates: 3 }),
	withBody("website link: a bare host", website, {
		currentUrl: "bakery.example.test",
	}),
	withBody("website link: a host and a path", website, {
		currentUrl: "bakery.example.test/menu",
	}),
	withBody("website link: localhost", website, {
		currentUrl: "localhost:3000",
	}),
	withBody("website link: a mistyped scheme", website, {
		currentUrl: "https//bakery.example.test",
	}),
	withBody("website link: one slash", website, {
		currentUrl: "https:/bakery.example.test",
	}),
	withBody("website link: another scheme", website, {
		currentUrl: "ftp://bakery.example.test",
	}),
	withBody("website link: a label before the host", website, {
		currentUrl: "Website: bakery.example.test",
	}),
	withBody("website link: none", website, { currentUrl: "none" }),
	withBody("website link: an email address", website, {
		currentUrl: "me@bakery.example.test",
	}),
	withBody("website link: a space inside", website, {
		currentUrl: "https://bakery example.test",
	}),
	withBody("website link: a username", website, {
		currentUrl: "https://me@bakery.example.test",
	}),
	withBody("website link: a password", website, {
		currentUrl: "https://me:secret@bakery.example.test",
	}),
	withBody("website link: no host", website, { currentUrl: "https://" }),
	withBody("website link: 2049 characters", website, {
		currentUrl: `https://a.example.test/${"x".repeat(2030)}`,
	}),
	withBody("website link: not text", website, { currentUrl: 5 }),
	withBody("webapp appGoal missing", webapp, { appGoal: undefined }),
	withBody("webapp appGoal 1001 characters", webapp, {
		appGoal: "a".repeat(1001),
	}),
	withBody("webapp firstVersion 1001 characters", webapp, {
		firstVersion: "a".repeat(1001),
	}),
	withBody("workflow today missing", workflow, { today: undefined }),
	withBody("workflow today 2001 characters", workflow, {
		today: "t".repeat(2001),
	}),
	withBody("workflow audience 1001 characters", workflow, {
		audience: "a".repeat(1001),
	}),
	withBody("workflow firstResult 2001 characters", workflow, {
		firstResult: "f".repeat(2001),
	}),
	withBody("idea idea missing", idea, { idea: undefined }),
	withBody("idea idea 1001 characters", idea, { idea: "i".repeat(1001) }),
	withBody("idea audienceToday 1001 characters", idea, {
		audienceToday: "a".repeat(1001),
	}),
	withBody("idea firstVersion 1001 characters", idea, {
		firstVersion: "f".repeat(1001),
	}),
	withBody("idea signal 501 characters", idea, { signal: "s".repeat(501) }),
	withBody("fields of another path are not required or kept", workflow, {
		purpose: "ignored",
		appGoal: "ignored",
	}),
	single("every field wrong at once on the website path", {
		path: "website",
		name: "",
		email: "x",
		company: 5,
		timing: "x",
		timingDate: 5,
		timingReason: 5,
		budgetStatus: "x",
		budgetNote: 5,
		approver: "x",
		approverRole: 5,
		turnstileToken: "",
		submissionId: "x",
		purpose: "",
		currentUrl: "nope",
		existing: 5,
		updates: "x",
	}),

	// --- line rules
	...lineFields.map((key) =>
		withBody(`${key} with a line break`, workflow, {
			[key]: key === "email" ? "a@example.com\nb" : "one\ntwo",
		}),
	),
	withBody("currentUrl with a line break", website, {
		currentUrl: "https://a.example.test\nhttps://b.example.test",
	}),
	withBody(
		"currentUrl with a line break on another path is not checked",
		workflow,
		{
			currentUrl: "a\nb",
		},
	),
	withBody("a line break in a date", workflow, {
		timing: "date",
		timingDate: "2027-01-15\n",
	}),
	...controlFields.map((key) =>
		withBody(`${key} with a control character`, website, {
			[key]: "a\u0001b",
		}),
	),
	withBody("a long answer with a control character", workflow, {
		today: "a\u000bb",
	}),
	withBody(
		"a long answer with a vertical tab, a bell and a lone surrogate",
		workflow,
		{
			audience: "x\u0007y",
			firstResult: "z\ud800",
		},
	),
	withBody("a tab and a carriage return are not control characters", workflow, {
		today: "a\tb\rc",
	}),
	withBody(
		"the control character check on a different path's fields",
		workflow,
		{
			purpose: "a\u0001b",
		},
	),

	// --- bindings and secrets
	single("no database binding", workflow, { music: { missing: true } }),
	single("no Turnstile secret", workflow, { omit: ["TURNSTILE_SECRET_KEY"] }),
	single("no rate limit store", workflow, {
		kv: { RATE_LIMIT: { missing: true } },
	}),
	single(
		"an invalid body with no database binding",
		{ name: "" },
		{
			music: { missing: true },
		},
	),

	// --- rate limits
	single("ten attempts already counted", workflow, {
		kv: { RATE_LIMIT: { seed: { [`rl:software-attempt:${IP}`]: "10" } } },
	}),
	single("nine attempts already counted", workflow, {
		kv: { RATE_LIMIT: { seed: { [`rl:software-attempt:${IP}`]: "9" } } },
	}),
	single("a stored attempt count that is not a number", workflow, {
		kv: { RATE_LIMIT: { seed: { [`rl:software-attempt:${IP}`]: "abc" } } },
	}),
	single("a request already counted for this address", workflow, {
		kv: { RATE_LIMIT: { seed: { [`rl:software:${IP}`]: "1" } } },
	}),
	single("no cf-connecting-ip header", workflow, {}, { as: asVisitor() }),
	single("the rate limit store fails to read", workflow, {
		kv: { RATE_LIMIT: { fails: ["get"] } },
	}),
	single("the rate limit store fails to write", workflow, {
		kv: { RATE_LIMIT: { fails: ["put"] } },
	}),

	// --- Turnstile
	single("Turnstile says no", workflow, {
		fetches: outside(json(200, { success: false })),
	}),
	single("Turnstile answers an error status", workflow, {
		fetches: outside(json(500, { success: true })),
	}),
	single("Turnstile answers unreadable text", workflow, {
		fetches: outside(text(200, "<html>")),
	}),
	single("Turnstile cannot be reached", workflow, {
		fetches: outside(networkDown()),
	}),

	// --- a submission id that was already stored
	priorCase("a duplicate from the same email", {}),
	priorCase(
		"a duplicate from the same email in other capitals",
		{
			email: "GRACE@example.COM",
		},
		{ ...workflow, email: "grace@EXAMPLE.com" },
	),
	priorCase("a duplicate from a different email", {
		email: "someone@else.test",
	}),
	priorCase("a duplicate whose copy was uncertain", {
		details_json: detailsWith({ clientCopyStatus: "uncertain" }),
	}),
	priorCase("a duplicate whose copy failed", {
		details_json: detailsWith({ clientCopyStatus: "failed" }),
	}),
	priorCase("a duplicate with no copy status stored", {
		details_json: detailsWith({}),
	}),
	priorCase("a duplicate whose stored details are not an object", {
		details_json: "[]",
	}),
	priorCase("a duplicate stored on the website path with other fields", {
		service_id: "website",
		details_json: JSON.stringify({
			path: "website",
			purpose: "A bakery",
			updates: "help",
			timing: "asap",
			approver: "other",
			approverRole: "Owner",
			clientCopyStatus: "sent",
		}),
	}),
	priorCase("a duplicate stored under a legacy path", {
		service_id: "idea",
		details_json: JSON.stringify({
			path: "idea",
			idea: "Tides",
			clientCopyStatus: "sent",
		}),
	}),
	priorCase(
		"a duplicate with a different body is answered with the stored brief",
		{},
		{
			...workflow,
			today: "Something else entirely",
		},
	),
	single("the duplicate lookup throws", workflow, fails(LOOKUP)),
	single("the duplicate lookup throws and the alert is refused", workflow, {
		...fails(LOOKUP),
		fetches: resend(json(500, {})),
	}),
	single("the duplicate lookup throws and Resend is down", workflow, {
		...fails(LOOKUP),
		fetches: outside(json(200, { success: true }), networkDown()),
	}),
	single("the duplicate lookup throws with no alert address", workflow, {
		...fails(LOOKUP),
		omit: ["CONTACT_TO_EMAIL"],
	}),
	single("the stored duplicate cannot be read back", workflow, {
		...fails(/SELECT id,kind,release_id,service_id/),
		music: { seed: { owner_requests: [stored()] } },
	}),

	// --- saving
	single("the insert batch fails", workflow, fails(INSERT)),
	single("the insert batch fails and the alert is refused", workflow, {
		...fails(INSERT),
		fetches: resend(json(500, {})),
	}),
	single("the insert batch fails with no Resend key", workflow, {
		...fails(INSERT),
		omit: ["RESEND_API_KEY"],
	}),
	single("the insert batch fails with no sender address", workflow, {
		...fails(INSERT),
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	single(
		"the insert batch fails and clearing the counter fails too",
		workflow,
		{
			...fails(INSERT),
			kv: { RATE_LIMIT: { fails: ["delete"] } },
		},
	),
	single(
		"the insert batch fails and the check for a rival also fails",
		workflow,
		{
			failures: [
				{ on: INSERT, message: "d1 down" },
				{ on: LOOKUP, message: "d1 down", nth: 2 },
			],
		},
	),
	single(
		"another request saved this id first, same email",
		workflow,
		insertOther("grace@example.com"),
	),
	single(
		"another request saved this id first, different email",
		workflow,
		insertOther("someone@else.test"),
	),
	single(
		"the read-back after the insert fails (the row stays stored)",
		workflow,
		fails(/SELECT id,kind,release_id,service_id/),
	),

	// --- the client copy (the first Resend call) and the owner notice (the second)
	single("the copy is refused with 400", workflow, {
		fetches: resend(json(400, {}), json(200, {})),
	}),
	single("the copy fails with 500", workflow, {
		fetches: resend(json(500, {}), json(200, {})),
	}),
	single("the copy cannot be sent", workflow, {
		fetches: resend(networkDown(), json(200, {})),
	}),
	single("no Resend key", workflow, { omit: ["RESEND_API_KEY"] }),
	single("no sender address", workflow, { omit: ["CONTACT_FROM_EMAIL"] }),
	single("no owner address", workflow, { omit: ["CONTACT_TO_EMAIL"] }),
	single("no site origin", workflow, { omit: ["SITE_ORIGIN"] }),
	single(
		"the copy claim finds the request already withdrawn",
		workflow,
		claimRace(
			"UPDATE owner_requests SET status='withdrawn'",
			CLAIM,
			"the request is withdrawn before the copy is claimed",
		),
	),
	single(
		"the copy claim finds a status already stored",
		workflow,
		claimRace(
			`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','sent')`,
			CLAIM,
			"another worker records a copy status before the claim",
		),
	),
	single("the copy claim throws", workflow, fails(CLAIM)),
	single(
		"the copy status write throws after the provider answered",
		workflow,
		fails(COPY_STATUS),
	),
	single(
		"the copy claim throws and the failure record throws too",
		workflow,
		fails(CLAIM, COPY_FAILED),
	),
	single(
		"the copy status write finds the attempt time changed",
		workflow,
		claimRace(
			`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyAttemptedAt','changed')`,
			COPY_STATUS,
			"another worker changes the attempt time",
		),
	),
	single("the owner notice is refused with 400", workflow, {
		fetches: resend(json(200, {}), json(400, {})),
	}),
	single("the owner notice fails with 500", workflow, {
		fetches: resend(json(200, {}), json(500, {})),
	}),
	single("the owner notice cannot be sent", workflow, {
		fetches: resend(json(200, {}), networkDown()),
	}),
	single("no execution context, so the notice is awaited", workflow, {
		noContext: true,
	}),
	single(
		"the website notice shows the link and the updates choice",
		fullWebsite,
	),
	single("a brief for a name with several words and markup", {
		...workflow,
		name: "  <b>Mary   Jane</b> Watson ",
	}),
	single("a brief for a name that is only one word", {
		...workflow,
		name: "Grace",
	}),

	// --- sequences
	{
		name: "the same submission sent twice",
		steps: [send(workflow), send(workflow)],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "the same submission sent twice with the copy uncertain the first time",
		steps: [send(workflow), send(workflow)],
		fetches: resend(json(500, {}), json(200, {})),
		final: FINAL,
	},
	{
		name: "two submissions from one address",
		steps: [send(workflow), send({ ...workflow, submissionId: OTHER_SID })],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "two submissions from two addresses",
		steps: [
			send(workflow),
			send(
				{ ...workflow, submissionId: OTHER_SID },
				{ as: asVisitor({ ip: "203.0.113.8" }) },
			),
		],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "one submission id with two different emails",
		steps: [
			send(workflow),
			send(
				{ ...workflow, email: "other@example.com" },
				{ as: asVisitor({ ip: "203.0.113.8" }) },
			),
		],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "a storage failure, then the same visitor retries",
		steps: [send(workflow), send(workflow)],
		fetches: allGood,
		...fails(INSERT),
		final: FINAL,
	},
	{
		name: "a refused challenge, then a good one",
		steps: [send(workflow), send(workflow)],
		fetches: byHost({
			turnstile: [json(200, { success: false }), json(200, { success: true })],
			resend: json(200, { id: "em_1" }),
		}),
		final: FINAL,
	},
	{
		name: "every path in turn from different addresses",
		steps: [
			send(website, { as: asVisitor({ ip: "198.51.100.1" }) }),
			send(
				{ ...webapp, submissionId: OTHER_SID },
				{ as: asVisitor({ ip: "198.51.100.2" }) },
			),
			send(
				{ ...workflow, submissionId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
				{ as: asVisitor({ ip: "198.51.100.3" }) },
			),
			send(
				{ ...idea, submissionId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" },
				{ as: asVisitor({ ip: "198.51.100.4" }) },
			),
		],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "eleven attempts that fail validation do not count",
		steps: Array.from({ length: 11 }, () => send({ ...workflow, name: "" })),
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "eleven refused challenges from one address",
		steps: Array.from({ length: 11 }, () => send(workflow)),
		fetches: outside(json(200, { success: false })),
		final: FINAL,
	},
];

defineCorpus("software-inquiry", POST, cases);
