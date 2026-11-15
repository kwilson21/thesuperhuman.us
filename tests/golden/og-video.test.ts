import { vi } from "vitest";
import rendered from "~/data/og-media.json";
import { GET, HEAD } from "~/pages/og/[name].mp4";
import { double } from "../helpers/doubles";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	networkDown,
	text,
	type Case,
	type FetchAnswer,
	type Handler,
	type Responder,
	type Step,
} from "./harness";
import { BODY, CONDITIONALS, RANGES } from "./areas/media";

// The golden corpus for GET and HEAD /og/[name].mp4: the looping silent video behind a link preview. The route
// (src/pages/og/[name].mp4.ts, serveOgVideo in src/lib/og-media.ts) names one of the rendered scenes' videos, fetches
// the bytes from the static assets at /og/raw/<name>.mp4 and slices them with mediaRange (src/lib/music-media.ts),
// because the platform's static answers carry no byte ranges and Safari needs 206.
//
// The route reads no cookie, session, database or R2 bucket, writes nothing and logs nothing. Its one outside call
// is the fetch of the raw file: through the ASSETS binding in production, through the global fetch in a development
// server (import.meta.env.DEV). Both are recorded as the same outgoing request, so a case in production forwards the
// binding's calls to the recorded global fetch. A case whose name says "in development" runs the route as it is
// without the forwarding. The forwarded call carries a marker header, x-golden-via, so a recording shows whether the
// binding or the global fetch made it.
//
// The rendered file names carry a hash of their content (src/data/og-media.json), so this file pins the names of two
// scenes: a re-render of a scene never changes this corpus.
//
// Every response branch and the cases that reach it:
//
//   404 "Not found"      an unknown name, a name from an earlier render, no name, an empty name, capitals, the name with
//                        its extension, a traversal, an encoded letter, a name of an image, the raw file's own name;
//                        the assets answer 404, 403, 500 and 304 (any answer that is not ok)
//   200 full body        the whole file, with content-type video/mp4, byte ranges advertised and a year of caching;
//                        every conditional header ignored; HEAD; cookies ignored
//   206 partial body     a first, middle, open-ended, suffix, one byte, last byte, an end past the size, a suffix longer
//                        than the file
//   416 content-range    a start at or past the size, a start after the end, a zero suffix, "bytes=-", another unit, two
//                        ranges, capitals, letters, any range on an empty file
//   HEAD                 headers only, content-length of the whole file, Range ignored
//   outage               the assets fetch rejects
//   binding              production without the ASSETS binding (the global fetch answers, as in development)
//   sequences            two reads, a range after a whole read, two scenes

const NAME = "home-golden0001";
const OTHER = "about-golden0002";
const RAW = `/og/raw/${NAME}.mp4`;

Object.assign(rendered.home, {
	video: `/og/${NAME}.mp4`,
	image: `/og/${NAME}.png`,
});

Object.assign(rendered.about, { video: `/og/${OTHER}.mp4` });

const assets =
	(status: number, body: string): Responder =>
	(call) =>
		call.url.endsWith(RAW) || call.url.endsWith(`/og/raw/${OTHER}.mp4`)
			? text(status, body)
			: text(404, "Not found");

const down =
	(message: string): Responder =>
	() =>
		networkDown(message);

const bound =
	(route: Handler): Handler =>
	async (context) => {
		vi.stubEnv("DEV", false);
		context.locals.runtime.env.ASSETS = double<Fetcher>({
			fetch: (input, init) =>
				fetch(input, { ...init, headers: { "x-golden-via": "ASSETS" } }),
		});

		try {
			return await route(context);
		} finally {
			vi.unstubAllEnvs();
		}
	};

/** Production with no ASSETS binding at all. */
const unbound =
	(route: Handler): Handler =>
	async (context) => {
		vi.stubEnv("DEV", false);

		try {
			return await route(context);
		} finally {
			vi.unstubAllEnvs();
		}
	};

const read = (name: string | undefined, extra: Partial<Step> = {}): Step => ({
	as: asVisitor(),
	method: "GET",
	path: `/og/${name ?? ""}.mp4`,
	params: { name },
	...extra,
});

const home = (extra: Partial<Step> = {}) => read(NAME, extra);

const ranged = (range: string, extra: Partial<Step> = {}) =>
	home({ headers: { range }, ...extra });

const open = (
	name: string,
	steps: readonly Step[] = [home()],
	fetches: Responder = assets(200, BODY),
	extra: Partial<Case> = {},
): Case => ({ name, steps, fetches, ...extra });

const answers: readonly (readonly [string, FetchAnswer])[] = [
	["404", text(404, "Not found")],
	["403", text(403, "Forbidden")],
	["500", text(500, "Internal error")],
	["304", text(304, "")],
];

const cases: Case[] = [
	// the whole file
	open("a whole read"),
	open("a query string is ignored", [home({ path: `/og/${NAME}.mp4?v=2` })]),
	open("an owner's session is ignored", [home({ as: asOwner() })]),
	open("another scene", [read(OTHER)]),
	open("from another host the fetch goes to that host", [
		home({ origin: "https://www.thesuperhuman.us" }),
	]),
	open("from a preview host the fetch goes to that host", [
		home({ origin: "https://preview.example.test" }),
	]),
	// names
	open("an unknown name", [read("nothing-0000000000")]),
	open("a name from an earlier render", [read("home-3d557ab871")]),
	open("no name param", [read(undefined, { params: {} })]),
	open("an empty name", [read("")]),
	open("the name in capitals", [read("HOME-GOLDEN0001")]),
	open("the name with its extension", [read(`${NAME}.mp4`)]),
	open("the name with a trailing slash", [read(`${NAME}/`)]),
	open("a name of the poster image", [read(`${NAME}.png`)]),
	open("a traversal into the raw folder", [read("../raw/x")]),
	open("a traversal that ends at a real name", [read(`x/../${NAME}`)]),
	open("an encoded letter", [read("%68ome-golden0001")]),
	open("a name with a query", [read(`${NAME}?x=1`)]),
	open("a name with a space", [read(`${NAME} `)]),
	open("a prototype name", [read("__proto__")]),
	open("the raw file's own path as the name", [read(`raw/${NAME}`)]),
	// the source
	...answers.map(([label, answer]) =>
		open(`the assets answer ${label}`, [home()], () => answer),
	),
	open("the assets answer 200 with an empty body", [home()], assets(200, "")),
	open(
		"the assets answer 200 with an empty body, asked for a range",
		[ranged("bytes=0-")],
		assets(200, ""),
	),
	open(
		"the assets answer 200 with an empty body, HEAD",
		[home({ method: "HEAD" })],
		assets(200, ""),
	),
	open(
		"the assets answer 404 for HEAD",
		[home({ method: "HEAD" })],
		assets(404, ""),
	),
	open(
		"the assets answer 404 for a range",
		[ranged("bytes=0-9")],
		assets(404, ""),
	),
	open(
		"the assets answer 500 for a range",
		[ranged("bytes=0-9")],
		assets(500, ""),
	),
	// ranges
	...RANGES.map(([name, header]) => open(`range: ${name}`, [ranged(header)])),
	// conditional requests and other headers
	...CONDITIONALS.map(([name, headers]) =>
		open(`header: ${name}`, [home({ headers })]),
	),
	// HEAD
	open("HEAD", [home({ method: "HEAD" })]),
	open("HEAD with a Range header ignores it", [
		ranged("bytes=0-9", { method: "HEAD" }),
	]),
	open("HEAD with a range that GET would refuse", [
		ranged("bytes=64-", { method: "HEAD" }),
	]),
	open("HEAD with a malformed range", [
		ranged("items=0-5", { method: "HEAD" }),
	]),
	open("the HEAD export is served by its own handler", [
		home({ method: "HEAD", handler: bound(HEAD) }),
	]),
	open("HEAD of an unknown name", [
		read("nothing-0000000000", { method: "HEAD" }),
	]),
	// outages
	open("the assets fetch rejects", [home()], down("assets down")),
	open(
		"the assets fetch rejects for HEAD",
		[home({ method: "HEAD" })],
		down("assets down"),
	),
	open(
		"the assets fetch rejects for a range",
		[ranged("bytes=0-9")],
		down("assets down"),
	),
	open(
		"the assets fetch is never reached for an unknown name",
		[read("nothing-0000000000")],
		down("assets down"),
	),
	// the binding
	open("in production without the ASSETS binding", [
		home({ handler: unbound(GET) }),
	]),
	open(
		"in production without the ASSETS binding, the fetch rejects",
		[home({ handler: unbound(GET) })],
		down("network down"),
	),
	open("in development", [home({ handler: GET })]),
	open("in development, a range", [ranged("bytes=0-9", { handler: GET })]),
	open(
		"in development, the file is missing",
		[home({ handler: GET })],
		assets(404, ""),
	),
	open(
		"in development, the fetch rejects",
		[home({ handler: GET })],
		down("dev server down"),
	),
	open("in development, HEAD", [home({ method: "HEAD", handler: GET })]),
	// sequences
	open("two whole reads", [home(), home({ advanceMs: 1000 })]),
	open("a whole read, then a range, then HEAD", [
		home(),
		ranged("bytes=10-19", { advanceMs: 1000 }),
		home({ method: "HEAD", advanceMs: 1000 }),
	]),
	open("two scenes", [home(), read(OTHER, { advanceMs: 1000 })]),
	open(
		"the file changes between two reads",
		[home(), home({ advanceMs: 1000 })],
		(call) => text(200, call.n === 0 ? BODY : BODY.toUpperCase()),
	),
];

defineCorpus("og-video", bound(GET), cases);
