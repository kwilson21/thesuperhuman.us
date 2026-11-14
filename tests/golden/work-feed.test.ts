import { GET, POST } from "~/pages/api/work-feed";
import type { JsonObject } from "../helpers/json";
import {
	auth,
	DAY,
	event,
	feedCase,
	pub,
	post,
	raw,
	read,
	story,
	TOKEN,
	via,
	withBytes,
	withChunks,
	withdraw,
} from "./areas/publication";
import {
	defineCorpus,
	type Case,
	type Handler,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for /api/work-feed: GET reads a project's published journal; POST publishes, corrects or
// withdraws an entry. It is stateful (the journal is an append-only table with a per-project revision) and public to
// read, bearer-token protected to write. Every case runs on a PUBLICATION_DB with the real migrations. The published_at
// default is pinned by a trigger (tests/golden/areas/publication.ts), which changes no statement the route runs.
//
// Every response branch, and its cases:
//
//   GET
//   404 {"error":"Project unavailable."}      no parameter, empty, unknown, other case, trailing space, allowlist unset
//   503 {"error":"Updates unavailable."}      no PUBLICATION_DB (and the 404 check runs first), the read batch fails, a
//                                             stored payload is not JSON or not a valid publication
//   200 ProjectFeed                           empty, one entry, corrected, withdrawn, several entries, backfill, other
//                                             project, unicode and markup, 101 entries (history stops at 100)
//   POST
//   401 {"error":"Unauthorized."}             token unset or empty on the server, header missing, wrong, other scheme,
//                                             lower-case scheme, trailing space, over 4096 characters
//   503 {"error":"Delivery unavailable."}     no PUBLICATION_DB (after the token check, before the body is read)
//   400 {"error":"Missing publication."}      no request body
//   413 {"error":"Publication too large."}    over 32768 bytes (single body, multi-byte text, a stream with no length)
//   400 {"error":"Invalid publication."}      bad JSON, invalid UTF-8, empty body, and every parsePublication rejection:
//                                             not an object, each key missing or extra, version, ids, expectedRevision,
//                                             occurredOn, threadId, milestoneId, operation, origin, the story rules for
//                                             each operation, each story field, control characters
//   403 {"error":"Project unavailable."}      a valid envelope for a project not on the allowlist
//   200 accepted / duplicate                  publish, correct, withdraw from every state; retries; key order
//   409 conflict                              stale or future revision, entry id reused, correct of an unknown entry,
//                                             event id reused with other content, lost races
//   410 withdrawn                             publish or correct of a withdrawn entry, a second withdrawal, a replay
//                                             after withdrawal, a race with a withdrawal
//   400 rejected                              expectedRevision of Number.MAX_SAFE_INTEGER (valid shape, refused by the journal)
//   503 {"error":"Delivery pending. Retry the same event."}   the journal batch throws
//
// Journal paths (D1PublicationJournal.commit): the insert guards (revision, event id, tombstone, operation), the
// withdraw erase, the receipt select, the tombstone select; and the outbox trigger that clears queued prose.
// Multi-step sequences are named "sequence: ...".

const OTHER = "other";
const SHORT = ["publication_events", "publication_outbox"];

const feed = (name: string, steps: Step[], c: Partial<Case> = {}): Case =>
	feedCase({ name, steps, ...c });

const seeded = (rows: SeedRow[]) => ({
	publication: { seed: { publication_events: rows } },
});

const entryOne = event(pub(), 1);

const rej = (name: string, body: JsonObject): Case =>
	feed(`reject: ${name}`, [
		post(body, { dump: { publication: ["publication_events"] } }),
	]);

const rejRaw = (name: string, text: string): Case =>
	feed(`reject: ${name}`, [
		raw(text, { dump: { publication: ["publication_events"] } }),
	]);

const long = (n: number, c = "a") => c.repeat(n);

const withdrawnRows = [
	{ ...event(pub(), 1), payload: null },
	event(withdraw({ eventId: "evt-2", expectedRevision: 1 }), 2),
];

// ---------------------------------------------------------------- reading

const reading: Case[] = [
	feed("read: empty project", [read("threadline")]),
	feed("read: unknown project", [read("unknown")]),
	feed("read: no project parameter", [
		{ method: "GET", path: "/api/work-feed" },
	]),
	feed("read: empty project parameter", [read("")]),
	feed("read: project name in another case", [read("Threadline")]),
	feed("read: project name with a trailing space", [read("threadline%20")]),
	feed("read: the allowlist is not set", [read("threadline")], {
		omit: ["PUBLICATION_PROJECTS"],
	}),
	feed("read: the allowlist has spaces and empty items", [read("threadline")], {
		env: { PUBLICATION_PROJECTS: " other , ,threadline ," },
	}),
	feed("read: the database is not bound", [read("threadline")], {
		publication: { missing: true },
	}),
	feed(
		"read: the database is not bound and the project is unknown",
		[read("unknown")],
		{ publication: { missing: true } },
	),
	feed("read: the read batch fails", [read("threadline")], {
		failures: [
			{ on: /SELECT COALESCE\(MAX\(revision\),0\)/, message: "d1 down" },
		],
	}),
	feed("read: one published entry", [read("threadline")], seeded([entryOne])),
	feed(
		"read: the other allowed project",
		[read(OTHER)],
		seeded([event(pub({ projectId: OTHER }), 1), entryOne]),
	),
	feed(
		"read: another project's events are not shown",
		[read(OTHER)],
		seeded([entryOne]),
	),
	feed(
		"read: two project parameters, the first wins",
		[
			{
				method: "GET",
				path: "/api/work-feed?project=other&project=threadline",
			},
		],
		seeded([entryOne, event(pub({ projectId: OTHER, eventId: "o1" }), 1)]),
	),
	feed(
		"read: extra query parameters are ignored",
		[
			{
				method: "GET",
				path: "/api/work-feed?project=threadline&limit=1&x=%3Cb%3E",
			},
		],
		seeded([entryOne]),
	),
	feed(
		"read: an entry corrected twice",
		[read("threadline")],
		seeded([
			entryOne,
			event(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					story: story({ headline: "Search is much faster" }),
				}),
				2,
			),
			event(
				pub({
					eventId: "evt-3",
					operation: "correct",
					expectedRevision: 2,
					story: story({ headline: "Search is fast", technicalDetail: null }),
				}),
				3,
			),
		]),
	),
	feed(
		"read: a withdrawn entry leaves nothing",
		[read("threadline")],
		seeded(withdrawnRows),
	),
	feed(
		"read: a withdrawn newest entry hides an older current one",
		[read("threadline")],
		seeded([
			event(
				pub({ entryId: "entry-1", eventId: "e1", occurredOn: "2026-11-10" }),
				1,
			),
			event(
				pub({
					entryId: "entry-2",
					eventId: "e2",
					expectedRevision: 1,
					occurredOn: "2026-11-11",
				}),
				2,
				{},
				true,
			),
			event(
				withdraw({ entryId: "entry-2", eventId: "e3", expectedRevision: 2 }),
				3,
			),
		]),
	),
	feed(
		"read: two entries, the newest published is current, history by date",
		[read("threadline")],
		seeded([
			event(
				pub({
					entryId: "entry-1",
					eventId: "e1",
					occurredOn: "2026-11-10",
					story: story({ headline: "First" }),
				}),
				1,
			),
			event(
				pub({
					entryId: "entry-2",
					eventId: "e2",
					expectedRevision: 1,
					occurredOn: "2026-11-08",
					story: story({ headline: "Second, dated earlier" }),
				}),
				2,
			),
			event(
				pub({
					entryId: "entry-3",
					eventId: "e3",
					expectedRevision: 2,
					occurredOn: "2026-11-10",
					story: story({ headline: "Third, same day as first" }),
				}),
				3,
			),
		]),
	),
	feed(
		"read: backfill entries are history only",
		[read("threadline")],
		seeded([
			event(
				pub({
					entryId: "old-1",
					eventId: "b1",
					origin: "backfill",
					occurredOn: "2026-01-05",
					story: story({ headline: "Backfilled one" }),
				}),
				1,
			),
			event(
				pub({
					entryId: "old-2",
					eventId: "b2",
					expectedRevision: 1,
					origin: "backfill",
					occurredOn: "2026-02-05",
					story: story({ headline: "Backfilled two" }),
				}),
				2,
			),
		]),
	),
	feed(
		"read: a backfill correction of a live entry is hidden from current but shown in history",
		[read("threadline")],
		seeded([
			entryOne,
			event(
				pub({
					eventId: "evt-2",
					operation: "correct",
					origin: "backfill",
					expectedRevision: 1,
					story: story({ headline: "Corrected by backfill" }),
				}),
				2,
			),
		]),
	),
	feed(
		"read: a correction that changes occurredOn shows the old date in history only",
		[read("threadline")],
		seeded([
			entryOne,
			event(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					occurredOn: "2026-11-01",
					story: story({ headline: "Date moved" }),
				}),
				2,
			),
		]),
	),
	feed(
		"read: an entry that was only ever withdrawn",
		[read("threadline")],
		seeded([event(withdraw({ entryId: "ghost" }), 1)]),
	),
	feed(
		"read: a shutdown entry is current",
		[read("threadline")],
		seeded([event(pub({ origin: "shutdown" }), 1)]),
	),
	feed(
		"read: unicode and markup in a story come back unescaped",
		[read("threadline")],
		seeded([
			event(
				pub({
					story: story({
						headline: "Fish & chips <b>\"quoted\"</b> 'single' é中🚀",
						summary: "<script>alert(1)</script> & </p>   line",
						technicalDetail: "a\tb\nc",
					}),
				}),
				1,
			),
		]),
	),
	feed(
		"read: a stored payload that is not JSON makes the feed unavailable",
		[read("threadline")],
		seeded([{ ...entryOne, payload: "{not json" }]),
	),
	feed(
		"read: a stored payload that is not a valid publication makes the feed unavailable",
		[read("threadline")],
		seeded([{ ...entryOne, payload: JSON.stringify({ version: 1 }) }]),
	),
	feed(
		"read: a stored correction whose payload is a withdrawal is refused",
		[read("threadline")],
		seeded([
			entryOne,
			{
				...event(withdraw({ eventId: "evt-2", expectedRevision: 1 }), 2),
				operation: "correct",
				payload: JSON.stringify(
					withdraw({ eventId: "evt-2", expectedRevision: 1 }),
				),
			},
		]),
	),
	feed(
		"read: 101 entries, history stops at 100 newest by date",
		[read("threadline")],
		seeded(
			Array.from({ length: 101 }, (_, index) =>
				event(
					pub({
						entryId: `e${index}`,
						eventId: `v${index}`,
						expectedRevision: index,
						occurredOn: new Date(Date.UTC(2026, 0, 1 + index))
							.toISOString()
							.slice(0, 10),
						story: story({
							headline: `h${index}`,
							summary: "s",
							technicalDetail: null,
						}),
					}),
					index + 1,
				),
			),
		),
	),
];

// ---------------------------------------------------------------- the bearer token

const goodBody = pub();

const authCases: Case[] = [
	feed("unauthorized: no authorization header", [
		post(goodBody, { headers: {} }),
	]),
	feed("unauthorized: the token is not set on the server", [post(goodBody)], {
		omit: ["PUBLICATION_TOKEN"],
	}),
	feed("unauthorized: the token on the server is empty", [post(goodBody)], {
		env: { PUBLICATION_TOKEN: "" },
	}),
	feed(
		"unauthorized: the token on the server is empty and the header is empty",
		[post(goodBody, { headers: { authorization: "Bearer " } })],
		{ env: { PUBLICATION_TOKEN: "" } },
	),
	feed("unauthorized: wrong token", [
		post(goodBody, { headers: { authorization: "Bearer nope" } }),
	]),
	feed("unauthorized: the token with one character missing", [
		post(goodBody, {
			headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
		}),
	]),
	feed("unauthorized: a wrong token of the right length", [
		post(goodBody, {
			headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}X` },
		}),
	]),
	feed("unauthorized: the right token under the Basic scheme", [
		post(goodBody, { headers: { authorization: `Basic ${TOKEN}` } }),
	]),
	feed("unauthorized: the right token under a lower-case bearer scheme", [
		post(goodBody, { headers: { authorization: `bearer ${TOKEN}` } }),
	]),
	feed("unauthorized: the bare token without a scheme", [
		post(goodBody, { headers: { authorization: TOKEN } }),
	]),
	feed("unauthorized: an authorization header over 4096 characters", [
		post(goodBody, { headers: { authorization: `Bearer ${long(4100)}` } }),
	]),
	feed("unauthorized: a long header that ends with the right token", [
		post(goodBody, {
			headers: { authorization: `Bearer ${long(4100)}${TOKEN}` },
		}),
	]),
	feed(
		"authorized: a header of exactly 4096 characters is accepted",
		[
			post(goodBody, {
				headers: { authorization: `Bearer ${long(4089, "t")}` },
			}),
		],
		{ env: { PUBLICATION_TOKEN: long(4089, "t") } },
	),
	feed(
		"unauthorized: the right token in a header of 4097 characters is refused",
		[
			post(goodBody, {
				headers: { authorization: `Bearer ${long(4090, "t")}` },
			}),
		],
		{ env: { PUBLICATION_TOKEN: long(4090, "t") } },
	),
	feed(
		"unauthorized: the token check runs before the database check",
		[post(goodBody, { headers: {} })],
		{ publication: { missing: true } },
	),
	feed("unauthorized: a read token is not needed and a read still works", [
		read("threadline", { headers: { authorization: "Bearer nope" } }),
	]),
	feed(
		"authorized: a token of exactly the server's length from the header only",
		[post(goodBody)],
		{ env: { PUBLICATION_TOKEN: TOKEN } },
	),
	feed("authorized: the token is accepted for the other allowed project too", [
		post(pub({ projectId: OTHER })),
	]),
];

// ---------------------------------------------------------------- body handling

const encoder = new TextEncoder();
const goodText = JSON.stringify(pub());

const padded = (size: number) =>
	goodText + " ".repeat(size - encoder.encode(goodText).length);

const posted: Handler = POST;

const unicodeBody = JSON.stringify(
	pub({ story: story({ headline: "café 中文 🚀 done" }) }),
);

const unicodeBytes = encoder.encode(unicodeBody);

// Split inside the three-byte character so a chunk boundary falls in the middle of it.
const cut = unicodeBytes.indexOf(0xe4) + 1;

const bodyCases: Case[] = [
	feed("body: the database is not bound", [post(goodBody)], {
		publication: { missing: true },
	}),
	feed("body: the database is not bound and the body is junk", [raw("{junk")], {
		publication: { missing: true },
	}),
	feed("body: no body at all", [
		{ path: "/api/work-feed", headers: auth, dump: { publication: SHORT } },
	]),
	feed("body: an empty string body", [raw("")]),
	feed("body: malformed JSON", [raw("{bad")]),
	feed("body: only whitespace", [raw("   \n")]),
	feed("body: invalid UTF-8 bytes", [
		{
			...raw("(bytes ff fe fd, not UTF-8)"),
			handler: via(posted, withBytes(new Uint8Array([0xff, 0xfe, 0xfd]))),
		},
	]),
	feed("body: a UTF-8 byte order mark before valid JSON", [
		raw(`${String.fromCharCode(0xfeff)}${goodText}`),
	]),
	feed("body: JSON with a repeated key, the last one wins", [
		raw(
			goodText.replace(
				'"projectId":"threadline"',
				'"projectId":"other","projectId":"threadline"',
			),
		),
	]),
	feed("body: a __proto__ member counts as an extra key", [
		raw(goodText.replace("{", '{"__proto__":{"x":1},')),
	]),
	feed("body: accepted whatever the content type says (form type)", [
		raw(goodText, {
			headers: { ...auth, "content-type": "application/x-www-form-urlencoded" },
		}),
	]),
	feed("body: accepted whatever the content type says (text/plain)", [
		raw(goodText, { headers: { ...auth, "content-type": "text/plain" } }),
	]),
	feed("body: exactly 32768 bytes is read", [raw(padded(32768))]),
	feed("body: 32769 bytes is too large", [raw(padded(32769))]),
	feed("body: 20000 two-byte characters are over the limit in bytes", [
		raw(`{"x":"${"é".repeat(20000)}"}`),
	]),
	feed("body: too large and the database is not bound", [raw(padded(40000))], {
		publication: { missing: true },
	}),
	feed("unauthorized: a too large body is not read", [
		raw(padded(40000), { headers: {} }),
	]),
	feed("body: a stream with no length over the limit", [
		{
			...raw("(four chunks of 9000 bytes)"),
			handler: via(
				posted,
				withChunks(
					Array.from({ length: 4 }, () => new Uint8Array(9000).fill(0x20)),
				),
			),
		},
	]),
	feed(
		"body: a valid body split over three chunks inside a multi-byte character",
		[
			{
				...raw("(unicode body in three chunks)"),
				handler: via(
					posted,
					withChunks([
						unicodeBytes.slice(0, cut),
						unicodeBytes.slice(cut, cut + 1),
						unicodeBytes.slice(cut + 1),
					]),
				),
			},
		],
	),
];

// ---------------------------------------------------------------- parsePublication rejections

const keys = [
	"version",
	"projectId",
	"eventId",
	"entryId",
	"expectedRevision",
	"operation",
	"origin",
	"occurredOn",
	"threadId",
	"milestoneId",
	"story",
];

const storyKeys = [
	"headline",
	"summary",
	"technicalDetail",
	"delivery",
	"basis",
];

const invalidCases: Case[] = [
	...[
		["null", "null"],
		["an array", "[]"],
		["an array holding a publication", `[${goodText}]`],
		["a string", '"text"'],
		["a number", "42"],
		["true", "true"],
		["an empty object", "{}"],
	].map(([name, text]) => rejRaw(`${name} is not a publication`, text)),
	...keys.map((key) =>
		rej(`the ${key} member is missing`, pub({ [key]: undefined })),
	),
	rej("an extra top-level member", pub({ extra: 1 })),
	rej("a member named like a key in another case", pub({ ProjectId: "x" })),
	...storyKeys.map((key) =>
		rej(
			`the story's ${key} member is missing`,
			pub({ story: story({ [key]: undefined }) }),
		),
	),
	rej("an extra story member", pub({ story: story({ extra: true }) })),
	rej("version 2", pub({ version: 2 })),
	rej("version as text", pub({ version: "1" })),
	rej("version null", pub({ version: null })),
	rej("projectId in upper case", pub({ projectId: "Threadline" })),
	rej("projectId empty", pub({ projectId: "" })),
	rej("projectId starting with a dash", pub({ projectId: "-threadline" })),
	rej("projectId of 81 characters", pub({ projectId: long(81) })),
	rej("projectId a number", pub({ projectId: 5 })),
	rej("projectId with a slash", pub({ projectId: "a/b" })),
	rej("projectId with a space", pub({ projectId: "a b" })),
	rej("eventId in upper case", pub({ eventId: "EVT-1" })),
	rej("eventId of 81 characters", pub({ eventId: long(81) })),
	rej("eventId null", pub({ eventId: null })),
	rej("entryId with a dot", pub({ entryId: "entry.1" })),
	rej("entryId null", pub({ entryId: null })),
	rej("expectedRevision negative", pub({ expectedRevision: -1 })),
	rej("expectedRevision fractional", pub({ expectedRevision: 1.5 })),
	rej("expectedRevision as text", pub({ expectedRevision: "0" })),
	rej("expectedRevision null", pub({ expectedRevision: null })),
	rej(
		"expectedRevision above the safe integers",
		pub({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 }),
	),
	rejRaw(
		"expectedRevision too large for a number",
		goodText.replace('"expectedRevision":0', '"expectedRevision":1e400'),
	),
	rej(
		"occurredOn not a real day (30 February)",
		pub({ occurredOn: "2026-02-30" }),
	),
	rej("occurredOn month 13", pub({ occurredOn: "2026-13-01" })),
	rej("occurredOn without zero padding", pub({ occurredOn: "2026-2-3" })),
	rej("occurredOn with a time", pub({ occurredOn: "2026-11-12T00:00:00Z" })),
	rej("occurredOn a number", pub({ occurredOn: 20261112 })),
	rej("threadId in upper case", pub({ threadId: "THREAD" })),
	rej("threadId a number", pub({ threadId: 5 })),
	rej("milestoneId with a space", pub({ milestoneId: "m 1" })),
	rej("operation unknown", pub({ operation: "delete" })),
	rej("operation in upper case", pub({ operation: "PUBLISH" })),
	rej("operation null", pub({ operation: null })),
	rej("origin unknown", pub({ origin: "chat" })),
	rej("a withdrawal that carries a story", withdraw({ story: story() })),
	rej("a publish with a null story", pub({ story: null })),
	rej(
		"a correction with a null story",
		pub({ operation: "correct", story: null }),
	),
	rej("a story that is a string", pub({ story: "text" })),
	rej("a story that is an array", pub({ story: [] })),
	rej("headline empty", pub({ story: story({ headline: "" }) })),
	rej("headline only spaces", pub({ story: story({ headline: "   " }) })),
	rej(
		"headline of 141 characters",
		pub({ story: story({ headline: long(141) }) }),
	),
	rej("headline a number", pub({ story: story({ headline: 5 }) })),
	rej("headline with a NUL", pub({ story: story({ headline: "a\u0000b" }) })),
	rej(
		"headline with a control character",
		pub({ story: story({ headline: "a\u0001b" }) }),
	),
	rej(
		"headline with a vertical tab",
		pub({ story: story({ headline: "a\u000bb" }) }),
	),
	rej(
		"headline with a form feed",
		pub({ story: story({ headline: "a\u000cb" }) }),
	),
	rej(
		"headline with an escape character",
		pub({ story: story({ headline: "a\u001bb" }) }),
	),
	rej("summary empty", pub({ story: story({ summary: "" }) })),
	rej(
		"summary of 1001 characters",
		pub({ story: story({ summary: long(1001) }) }),
	),
	rej("summary null", pub({ story: story({ summary: null }) })),
	rej("technicalDetail empty", pub({ story: story({ technicalDetail: "" }) })),
	rej(
		"technicalDetail of 4001 characters",
		pub({ story: story({ technicalDetail: long(4001) }) }),
	),
	rej(
		"technicalDetail a number",
		pub({ story: story({ technicalDetail: 5 }) }),
	),
	rej("delivery unknown", pub({ story: story({ delivery: "shipped" }) })),
	rej("basis unknown", pub({ story: story({ basis: "ai-reported" }) })),
	feed(
		"invalid for the shape and for the project: the shape is answered first",
		[post(pub({ projectId: "Unknown", version: 2 }))],
	),
];

// ---------------------------------------------------------------- accepted shapes

const accepted: Case[] = [
	feed("accept: a headline of 140 and the longest summary and detail", [
		post(
			pub({
				story: story({
					headline: long(140),
					summary: long(1000),
					technicalDetail: long(4000),
				}),
			}),
		),
	]),
	feed("accept: tabs, newlines, carriage returns, DEL and line separators", [
		post(
			pub({
				story: story({
					headline: "a\tb",
					summary: "line one\r\nline two\n\u007f ",
					technicalDetail: null,
				}),
			}),
		),
	]),
	feed("accept: unicode and markup are stored as written", [
		post(
			pub({
				story: story({
					headline: "Fish & chips <b>\"hi\"</b> 'x' é中🚀",
					summary: "<script>alert(1)</script> & </p>",
				}),
			}),
		),
		read("threadline"),
	]),
	feed("accept: a thread and a milestone", [
		post(pub({ threadId: "thread-1", milestoneId: "m_1" })),
	]),
	feed("accept: a null technicalDetail", [
		post(pub({ story: story({ technicalDetail: null }) })),
	]),
	feed("accept: an id of 80 characters", [
		post(pub({ entryId: long(80), eventId: long(80) })),
	]),
	feed("accept: an id of digits", [post(pub({ entryId: "0", eventId: "7" }))]),
	feed("accept: expectedRevision written as 0.0", [
		raw(
			JSON.stringify(pub()).replace(
				'"expectedRevision":0',
				'"expectedRevision":0.0',
			),
		),
	]),
	feed("accept: shutdown origin", [post(pub({ origin: "shutdown" }))]),
	feed("accept: backfill origin", [post(pub({ origin: "backfill" }))]),
	feed("accept: every delivery and basis value", [
		post(
			pub({
				eventId: "a",
				entryId: "a",
				story: story({ delivery: "proposed", basis: "agent-reported" }),
			}),
		),
		post(
			pub({
				eventId: "b",
				entryId: "b",
				expectedRevision: 1,
				story: story({ delivery: "implemented", basis: "human-confirmed" }),
			}),
		),
		post(
			pub({
				eventId: "c",
				entryId: "c",
				expectedRevision: 2,
				story: story({ delivery: "tested", basis: "repository-verified" }),
			}),
		),
	]),
	feed("accept: the other allowed project has its own revision count", [
		post(pub({ projectId: OTHER })),
		post(
			pub({ projectId: "threadline", eventId: "evt-9", entryId: "entry-9" }),
		),
	]),
	feed("accept: the allowlist has spaces around the name", [post(goodBody)], {
		env: { PUBLICATION_PROJECTS: "  threadline  " },
	}),
];

// ---------------------------------------------------------------- projects

const projects: Case[] = [
	feed("project: not on the allowlist is forbidden and writes nothing", [
		post(pub({ projectId: "stranger" })),
	]),
	feed("project: valid shape of 80 characters, not allowed", [
		post(pub({ projectId: long(80) })),
	]),
	feed("project: the allowlist is not set", [post(goodBody)], {
		omit: ["PUBLICATION_PROJECTS"],
	}),
	feed("project: the allowlist is empty", [post(goodBody)], {
		env: { PUBLICATION_PROJECTS: "" },
	}),
	feed("project: a case difference is not the same project", [
		post(pub({ projectId: "threadlinx" })),
	]),
];

// ---------------------------------------------------------------- journal state matrix

const published = [entryOne];

const corrected = [
	entryOne,
	event(
		pub({
			eventId: "evt-2",
			operation: "correct",
			expectedRevision: 1,
			story: story({ headline: "Corrected" }),
		}),
		2,
	),
];

const queued = [
	{
		project_id: "threadline",
		event_id: "evt-1",
		entry_id: "entry-1",
		payload_hash: "h1",
		payload: '{"queued":"entry one text"}',
		receipt: null,
	},
	{
		project_id: "threadline",
		event_id: "evt-7",
		entry_id: "entry-7",
		payload_hash: "h7",
		payload: '{"queued":"entry seven text"}',
		receipt: '{"r":1}',
	},
	{
		project_id: "other",
		event_id: "evt-1",
		entry_id: "entry-1",
		payload_hash: "h1",
		payload: '{"queued":"other project text"}',
		receipt: null,
	},
];

const journal: Case[] = [
	// publish
	feed("publish: the first entry of a project", [post(pub())]),
	feed(
		"publish: a second entry at the next revision",
		[post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 }))],
		seeded(published),
	),
	feed(
		"publish: a second entry with a stale revision",
		[post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 0 }))],
		seeded(published),
	),
	feed("publish: a revision ahead of the log", [
		post(pub({ expectedRevision: 5 })),
	]),
	feed(
		"publish: an entry id that already exists",
		[post(pub({ eventId: "evt-2", expectedRevision: 1 }))],
		seeded(published),
	),
	feed(
		"publish: an entry id that was corrected",
		[post(pub({ eventId: "evt-3", expectedRevision: 2 }))],
		seeded(corrected),
	),
	feed(
		"publish: an entry id that was withdrawn",
		[post(pub({ eventId: "evt-3", expectedRevision: 2 }))],
		seeded(withdrawnRows),
	),
	feed(
		"publish: the same event id in another project is a new event",
		[post(pub({ projectId: OTHER }))],
		seeded(published),
	),
	feed(
		"publish: the same entry id in another project is a new entry",
		[post(pub({ projectId: OTHER, eventId: "o-1" }))],
		seeded(published),
	),
	feed(
		"publish: expectedRevision equal to the largest safe integer is rejected",
		[post(pub({ expectedRevision: Number.MAX_SAFE_INTEGER }))],
	),
	feed(
		"publish: expectedRevision one below the largest safe integer is a conflict",
		[post(pub({ expectedRevision: Number.MAX_SAFE_INTEGER - 1 }))],
	),
	feed(
		"publish: with a backfilled earlier event the revision counts it",
		[post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 }))],
		seeded([
			event(pub({ eventId: "b1", entryId: "old", origin: "backfill" }), 1),
		]),
	),
	// correct
	feed(
		"correct: a published entry",
		[
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					story: story({ headline: "Corrected" }),
				}),
			),
			read("threadline"),
		],
		seeded(published),
	),
	feed(
		"correct: a stale revision",
		[
			post(
				pub({ eventId: "evt-2", operation: "correct", expectedRevision: 0 }),
			),
		],
		seeded(published),
	),
	feed("correct: an entry that was never published", [
		post(pub({ operation: "correct", expectedRevision: 0 })),
	]),
	feed(
		"correct: an entry of another project that was never published here",
		[
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 0,
					projectId: OTHER,
				}),
			),
		],
		seeded(published),
	),
	feed(
		"correct: a withdrawn entry",
		[
			post(
				pub({ eventId: "evt-3", operation: "correct", expectedRevision: 2 }),
			),
		],
		seeded(withdrawnRows),
	),
	feed(
		"correct: an entry that was already corrected",
		[
			post(
				pub({
					eventId: "evt-3",
					operation: "correct",
					expectedRevision: 2,
					story: story({ headline: "Corrected again" }),
				}),
			),
		],
		seeded(corrected),
	),
	feed(
		"correct: with identical content under a new event id",
		[
			post(
				pub({ eventId: "evt-2", operation: "correct", expectedRevision: 1 }),
			),
		],
		seeded(published),
	),
	feed(
		"correct: with origin backfill",
		[
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					origin: "backfill",
					expectedRevision: 1,
					story: story({ headline: "Backfill fix" }),
				}),
			),
		],
		seeded(published),
	),
	feed(
		"correct: a backfilled entry",
		[
			post(
				pub({
					eventId: "evt-2",
					entryId: "old",
					operation: "correct",
					origin: "work",
					expectedRevision: 1,
				}),
			),
		],
		seeded([
			event(pub({ eventId: "b1", entryId: "old", origin: "backfill" }), 1),
		]),
	),
	feed(
		"correct: changes the date",
		[
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					occurredOn: "2026-10-01",
				}),
			),
			read("threadline"),
		],
		seeded(published),
	),
	// withdraw
	feed(
		"withdraw: a published entry",
		[
			post(withdraw({ eventId: "evt-2", expectedRevision: 1 })),
			read("threadline"),
		],
		seeded(published),
	),
	feed(
		"withdraw: a corrected entry erases the text of every revision",
		[post(withdraw({ eventId: "evt-3", expectedRevision: 2 }))],
		seeded(corrected),
	),
	feed("withdraw: an entry that was never published still leaves a tombstone", [
		post(withdraw({ entryId: "ghost" })),
	]),
	feed(
		"withdraw: an entry that is already withdrawn, with a new event",
		[post(withdraw({ eventId: "evt-3", expectedRevision: 2 }))],
		seeded(withdrawnRows),
	),
	feed(
		"withdraw: a stale revision",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 0 }))],
		seeded(published),
	),
	feed(
		"withdraw: leaves other entries as they were",
		[
			post(
				withdraw({ eventId: "evt-3", entryId: "entry-1", expectedRevision: 2 }),
			),
		],
		seeded([
			entryOne,
			event(
				pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 }),
				2,
			),
		]),
	),
	feed(
		"withdraw: clears the queued text of that entry in the outbox, in that project only",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 1 }))],
		{
			publication: {
				seed: { publication_events: published, publication_outbox: queued },
			},
		},
	),
	feed(
		"withdraw: another project's same entry id is untouched",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 1 }))],
		seeded([entryOne, event(pub({ projectId: OTHER }), 1)]),
	),
	feed(
		"withdraw: with origin backfill",
		[
			post(
				withdraw({ eventId: "evt-2", expectedRevision: 1, origin: "backfill" }),
			),
		],
		seeded(published),
	),
	feed(
		"withdraw: a withdrawal for an entry in another project that is not on the allowlist",
		[post(withdraw({ projectId: "stranger" }))],
	),
	// duplicates
	feed(
		"retry: the same publish returns the stored receipt",
		[post(pub())],
		seeded(published),
	),
	feed(
		"retry: the same publish with keys in another order and spaces",
		[
			raw(
				`{ "story" : ${JSON.stringify(story())}, "milestoneId":null, "threadId":null, "occurredOn":"${DAY}", "origin":"work", "operation":"publish", "expectedRevision":0, "entryId":"entry-1", "eventId":"evt-1", "projectId":"threadline", "version":1 }`,
			),
		],
		seeded(published),
	),
	feed(
		"retry: the same event id with other content is a conflict",
		[post(pub({ story: story({ headline: "A different headline" }) }))],
		seeded(published),
	),
	feed(
		"retry: the same event id with another revision expectation is a conflict",
		[post(pub({ expectedRevision: 3 }))],
		seeded(published),
	),
	feed(
		"retry: the same event id used for another entry is a conflict",
		[post(pub({ entryId: "entry-2" }))],
		seeded(published),
	),
	feed(
		"retry: the same event id used for another operation is a conflict",
		[post(pub({ operation: "correct" }))],
		seeded(published),
	),
	feed(
		"retry: a correction",
		[
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					story: story({ headline: "Corrected" }),
				}),
			),
		],
		seeded(corrected),
	),
	feed(
		"retry: a withdrawal returns the stored receipt",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 1 }))],
		seeded(withdrawnRows),
	),
	feed(
		"retry: a withdrawal with other content is a conflict",
		[
			post(
				withdraw({ eventId: "evt-2", expectedRevision: 1, origin: "shutdown" }),
			),
		],
		seeded(withdrawnRows),
	),
	feed(
		"retry: a publish whose entry was withdrawn since is gone",
		[post(pub())],
		seeded(withdrawnRows),
	),
	feed(
		"retry: a publish whose entry was withdrawn since, with changed content, is a conflict",
		[post(pub({ story: story({ headline: "Other" }) }))],
		seeded(withdrawnRows),
	),
	feed(
		"retry: the same event id in the other project with other content is a conflict",
		[post(pub({ projectId: OTHER }))],
		seeded([
			event(
				pub({ projectId: OTHER, story: story({ headline: "Other text" }) }),
				1,
			),
		]),
	),
	feed(
		"retry: the revision in the stored row differs from the one now expected",
		[post(pub())],
		seeded([
			event(pub({ eventId: "x1", entryId: "other-entry" }), 1),
			event(pub(), 2),
		]),
	),
];

// ---------------------------------------------------------------- races and outages

const raceRow = (over: JsonObject = {}, revision = 1, erased = false) =>
	event(
		pub({ eventId: "rival", entryId: "rival-entry", ...over }),
		revision,
		{},
		erased,
	);

const races: Case[] = [
	feed("race: another writer takes the revision first", [post(pub())], {
		interleave: [
			{
				on: /INSERT INTO publication_events/,
				label: "another publish lands at revision 1",
				run: (sqlite) =>
					sqlite.exec(
						`INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES ('threadline','rival','rival-entry',1,'publish','work','h','{}','2026-11-13T11:59:00.000Z')`,
					),
			},
		],
	}),
	feed("race: the identical event lands first (a retry won)", [post(pub())], {
		interleave: [
			{
				on: /INSERT INTO publication_events/,
				label: "the same event is stored first",
				run: (sqlite) => {
					const row = event(pub(), 1);
					sqlite
						.prepare(
							"INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES (?,?,?,?,?,?,?,?,?)",
						)
						.run(
							row.project_id,
							row.event_id,
							row.entry_id,
							row.revision,
							row.operation,
							row.origin,
							row.payload_hash,
							row.payload,
							row.published_at,
						);
				},
			},
		],
	}),
	feed(
		"race: the same event id lands first with other content",
		[post(pub())],
		{
			interleave: [
				{
					on: /INSERT INTO publication_events/,
					label: "the same event id is stored with a different hash",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES ('threadline','evt-1','entry-1',1,'publish','work','different','{}','2026-11-13T11:59:00.000Z')`,
						),
				},
			],
		},
	),
	feed(
		"race: a correction loses to a withdrawal of the entry",
		[
			post(
				pub({ eventId: "evt-2", operation: "correct", expectedRevision: 1 }),
			),
		],
		{
			...seeded(published),
			interleave: [
				{
					on: /INSERT INTO publication_events/,
					label: "the entry is withdrawn first",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES ('threadline','rival','entry-1',2,'withdraw','work','h',NULL,'2026-11-13T11:59:00.000Z'); UPDATE publication_events SET payload=NULL WHERE entry_id='entry-1'`,
						),
				},
			],
		},
	),
	feed(
		"race: a withdrawal loses to another withdrawal of the same entry",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 1 }))],
		{
			...seeded(published),
			interleave: [
				{
					on: /INSERT INTO publication_events/,
					label: "another withdrawal lands first",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES ('threadline','rival','entry-1',2,'withdraw','work','h',NULL,'2026-11-13T11:59:00.000Z')`,
						),
				},
			],
		},
	),
	feed(
		"race: a publish of an entry id loses to another publish of that id",
		[post(pub({ eventId: "evt-2", entryId: "entry-9" }))],
		{
			interleave: [
				{
					on: /INSERT INTO publication_events/,
					label: "another event publishes entry-9",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES ('threadline','rival','entry-9',1,'publish','work','h','{}','2026-11-13T11:59:00.000Z')`,
						),
				},
			],
		},
	),
	feed(
		"race: the read sees a row written between its queries only in the next read",
		[read("threadline"), read("threadline")],
		{
			...seeded(published),
			interleave: [
				{
					on: /SELECT COALESCE\(MAX\(revision\),0\)/,
					label: "a second entry is stored before the first read",
					run: (sqlite) => {
						const row = raceRow({ expectedRevision: 1 }, 2);
						sqlite
							.prepare(
								"INSERT INTO publication_events (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload,published_at) VALUES (?,?,?,?,?,?,?,?,?)",
							)
							.run(
								row.project_id,
								row.event_id,
								row.entry_id,
								row.revision,
								row.operation,
								row.origin,
								row.payload_hash,
								row.payload,
								row.published_at,
							);
					},
				},
			],
		},
	),
];

const outages: Case[] = [
	feed("outage: the journal batch fails on a publish", [post(pub())], {
		failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
	}),
	feed(
		"outage: the journal batch fails on a withdrawal",
		[post(withdraw({ eventId: "evt-2", expectedRevision: 1 }))],
		{
			...seeded(published),
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
		},
	),
	feed(
		"outage: the journal batch fails on a correction",
		[
			post(
				pub({ eventId: "evt-2", operation: "correct", expectedRevision: 1 }),
			),
		],
		{
			...seeded(published),
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
		},
	),
	feed(
		"outage: a failure and then the same event is retried",
		[post(pub()), post(pub()), read("threadline")],
		{
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
		},
	),
	feed(
		"outage: a rejected publish never reaches the database",
		[post(pub({ expectedRevision: Number.MAX_SAFE_INTEGER }))],
		{
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
			optionalTriggers: [
				{
					trigger: "d1 failure on /INSERT INTO publication_events/",
					reason:
						"a control: the case claims the request never reaches the database, so this failure must stay unused",
				},
			],
		},
	),
	feed(
		"outage: a bad shape never reaches the database",
		[post(pub({ version: 2 }))],
		{
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
			optionalTriggers: [
				{
					trigger: "d1 failure on /INSERT INTO publication_events/",
					reason:
						"a control: the case claims the request never reaches the database, so this failure must stay unused",
				},
			],
		},
	),
];

// ---------------------------------------------------------------- sequences

const sequences: Case[] = [
	feed(
		"sequence: publish, read, correct, read, withdraw, read, try to restore",
		[
			post(pub()),
			read("threadline"),
			post(
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					story: story({ headline: "Corrected" }),
				}),
			),
			read("threadline"),
			post(withdraw({ eventId: "evt-3", expectedRevision: 2 })),
			read("threadline"),
			post(pub({ eventId: "evt-4", expectedRevision: 3 })),
			post(pub()),
			post(withdraw({ eventId: "evt-3", expectedRevision: 2 })),
			read("threadline"),
		],
	),
	feed("sequence: the same publish three times", [
		post(pub()),
		post(pub()),
		post(pub()),
	]),
	feed("sequence: two entries, a stale correction, then a fresh one", [
		post(pub()),
		post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 })),
		post(
			pub({
				eventId: "evt-3",
				operation: "correct",
				expectedRevision: 1,
				story: story({ headline: "Stale fix" }),
			}),
		),
		post(
			pub({
				eventId: "evt-4",
				operation: "correct",
				expectedRevision: 2,
				story: story({ headline: "Fresh fix" }),
			}),
		),
		read("threadline"),
	]),
	feed("sequence: withdraw before publish blocks the entry id for good", [
		post(withdraw({ entryId: "entry-1", eventId: "evt-1" })),
		post(pub({ eventId: "evt-2", expectedRevision: 1 })),
		read("threadline"),
	]),
	feed("sequence: backfill, then live work", [
		post(
			pub({
				entryId: "old",
				eventId: "b1",
				origin: "backfill",
				occurredOn: "2026-01-02",
			}),
		),
		post(pub({ eventId: "evt-2", expectedRevision: 1 })),
		post(
			pub({
				entryId: "old2",
				eventId: "b2",
				origin: "backfill",
				occurredOn: "2026-01-03",
				expectedRevision: 2,
			}),
		),
		read("threadline"),
	]),
	feed("sequence: unauthorized, then authorized with the same body", [
		post(pub(), { headers: { authorization: "Bearer nope" } }),
		post(pub()),
		read("threadline"),
	]),
	feed("sequence: conflict, then reconcile with the fresh revision", [
		post(pub()),
		post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 0 })),
		read("threadline"),
		post(pub({ eventId: "evt-3", entryId: "entry-2", expectedRevision: 1 })),
	]),
	feed("sequence: two projects count revisions apart", [
		post(pub()),
		post(pub({ projectId: OTHER })),
		post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 })),
		post(
			pub({
				projectId: OTHER,
				eventId: "evt-2",
				entryId: "entry-2",
				expectedRevision: 1,
			}),
		),
		read(OTHER),
		read("threadline"),
	]),
	feed(
		"sequence: queued text is cleared only by a withdrawal",
		[
			post(pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 1 })),
			post(
				withdraw({ eventId: "evt-3", entryId: "entry-1", expectedRevision: 2 }),
			),
		],
		{
			publication: {
				seed: { publication_events: published, publication_outbox: queued },
			},
		},
	),
	feed(
		"sequence: a withdrawal that is retried erases nothing more",
		[
			post(withdraw({ eventId: "evt-2", expectedRevision: 1 })),
			post(withdraw({ eventId: "evt-2", expectedRevision: 1 })),
			post(withdraw({ eventId: "evt-5", expectedRevision: 1 })),
		],
		seeded(published),
	),
	feed("sequence: an invalid body then a valid one", [
		raw("{bad"),
		post(pub({ version: 2 })),
		post(pub()),
	]),
];

const cases: Case[] = [
	...reading,
	...authCases,
	...bodyCases,
	...invalidCases,
	...accepted,
	...projects,
	...journal,
	...races,
	...outages,
	...sequences,
];

defineCorpus(
	"work-feed",
	(context) =>
		context.request.method === "GET" ? GET(context) : POST(context),
	cases,
);
