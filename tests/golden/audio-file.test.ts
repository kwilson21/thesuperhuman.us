import { afterEach } from "vitest";
import { clearSuppliedEntries, supplyEntries } from "../helpers/astro-content";
import { GET } from "~/pages/audio/file/[slug]";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";
import type { R2Seed } from "./harness/r2";
import { BODY, CONDITIONALS, RANGES } from "./areas/media";

// The golden corpus for GET /audio/file/[slug]: an mp3 of the portfolio's audio-tracks collection, streamed from R2
// with its own Range handling (parseRangeRequest and resolveRange in the route). The route reads no cookie, session or
// database, makes no write and no log line, so every case's effects are R2 head and get calls and nothing else.
//
// The collection has no files in this repository (src/content/audio-tracks is empty), so a case gives it entries
// through the astro:content helper's seam, as tests/api/audio-file.test.ts does. The entry's schema (a key of the shape
// tracks/<name>.mp3) is not applied to supplied entries, so a case can hold the private keys the route refuses.
//
// Only GET is exported. A HEAD request reaches the same function (Astro serves a HEAD from GET), so the HEAD cases
// record what that function answers to the method.
//
// Every response branch and the cases that reach it:
//
//   404 "not found"      the collection is empty (the real one); an unknown slug; no slug, an empty slug, capitals, an
//                        underscore, a dot, a space, a slash, a traversal, an encoded dot; an entry whose key starts with
//                        studio/ or software/ (R2 is never read); the object missing from R2 (on a whole read, on a range
//                        read at head, and between head and get)
//   200 full body        a whole read; a missing, empty or malformed Range header; a range with a suffix, two ranges,
//                        another unit, capitals, letters (all read as "not a range"); conditional request headers (no
//                        etag, so no 304); cookies and authorization ignored; HEAD
//   206 partial body     a first, middle, open-ended, one byte, last byte, closed whole-file range
//   416 content-range    a start at or past the size, a start after the end, an end at or past the size, a number too
//                        large to be exact, any range on an empty object
//   R2 outage            get throws on a whole read, head throws on a range, get throws on a range, no AUDIO binding
//   sequences            a whole read then a range, two ranges, two slugs

const SLUG = "slow-burn";
const KEY = "tracks/slow-burn.mp3";
const SEED: R2Seed = { [KEY]: { body: BODY } };

afterEach(() => clearSuppliedEntries());

const entries =
	(...tracks: readonly (readonly [string, string])[]) =>
	() =>
		supplyEntries(
			"audio-tracks",
			tracks.map(([id, file]) => ({
				id,
				collection: "audio-tracks",
				data: { file },
			})),
		);

const read = (slug: string | undefined, extra: Partial<Step> = {}): Step => ({
	as: asVisitor(),
	method: "GET",
	path: `/audio/file/${slug ?? ""}`,
	params: { slug },
	...extra,
});

const slow = (extra: Partial<Step> = {}) => read(SLUG, extra);

const ranged = (range: string, extra: Partial<Step> = {}) =>
	slow({ headers: { range }, ...extra });

const open = (
	name: string,
	steps: readonly Step[] = [slow()],
	extra: Partial<Case> = {},
): Case => ({
	name,
	steps,
	setup: entries([SLUG, KEY]),
	r2: { seed: SEED },
	...extra,
});

const cases: Case[] = [
	// the collection
	open("the real collection is empty", [slow()], { setup: undefined }),
	open("the real collection is empty, with a range", [ranged("bytes=0-9")], {
		setup: undefined,
	}),
	open("an unknown slug", [read("unknown")]),
	open("a slug that is only a prefix of an entry", [read("slow")]),
	open("a slug that extends an entry", [read("slow-burn-2")]),
	// slugs
	open("no slug param", [read(undefined, { params: {} })]),
	open("an empty slug", [read("")]),
	open("a slug in capitals", [read("SLOW-BURN")]),
	open("a slug with an underscore", [read("slow_burn")]),
	open("a slug with a dot", [read("slow.burn")]),
	open("a slug with the extension", [read("slow-burn.mp3")]),
	open("a slug with a space", [read("slow burn")]),
	open("a slug with a slash", [read("tracks/slow-burn")]),
	open("a slug with a traversal", [read("../slow-burn")]),
	open("a slug with an encoded dot", [read("%2e%2e")]),
	open("a slug with a newline at the end", [read("slow-burn\n")]),
	open("a slug with a unicode letter", [read("slów-burn")]),
	open("a prototype name", [read("__proto__")]),
	open("a slug of digits and dashes only", [read("1-2-3")], {
		setup: entries(["1-2-3", "tracks/one-two-three.mp3"]),
		r2: { seed: { "tracks/one-two-three.mp3": { body: BODY } } },
	}),
	open("a slug with a trailing dash", [read("slow-burn-")], {
		setup: entries(["slow-burn-", "tracks/slow-burn-.mp3"]),
		r2: { seed: { "tracks/slow-burn-.mp3": { body: BODY } } },
	}),
	// private keys
	open("an entry whose key is a studio file", [read("studio-file")], {
		setup: entries(["studio-file", "studio/projects/r1/f1.mp3"]),
		r2: { seed: { "studio/projects/r1/f1.mp3": { body: BODY } } },
	}),
	open("an entry whose key is a software visual", [read("software-file")], {
		setup: entries(["software-file", "software/r1/u1/visual.png"]),
		r2: { seed: { "software/r1/u1/visual.png": { body: BODY } } },
	}),
	open(
		"an entry whose key is a studio file, asked for a range",
		[read("studio-file", { headers: { range: "bytes=0-9" } })],
		{
			setup: entries(["studio-file", "studio/projects/r1/f1.mp3"]),
			r2: { seed: { "studio/projects/r1/f1.mp3": { body: BODY } } },
		},
	),
	open("an entry whose key is a signed agreement", [read("agreement-file")], {
		setup: entries(["agreement-file", "agreements/a1/signed.pdf"]),
		r2: { seed: { "agreements/a1/signed.pdf": { body: BODY } } },
	}),
	open(
		"an entry whose key is an agreement attachment, asked for a range",
		[read("agreement-file", { headers: { range: "bytes=0-9" } })],
		{
			setup: entries(["agreement-file", "agreements/attachments/a1.pdf"]),
			r2: { seed: { "agreements/attachments/a1.pdf": { body: BODY } } },
		},
	),
	open("an entry whose key has studio in capitals", [read("odd-key")], {
		setup: entries(["odd-key", "Studio/projects/r1/f1.mp3"]),
		r2: { seed: { "Studio/projects/r1/f1.mp3": { body: BODY } } },
	}),
	open("an entry whose key has a leading slash", [read("odd-key")], {
		setup: entries(["odd-key", "/studio/projects/r1/f1.mp3"]),
		r2: { seed: { "/studio/projects/r1/f1.mp3": { body: BODY } } },
	}),
	open("an entry whose key only mentions studio", [read("odd-key")], {
		setup: entries(["odd-key", "tracks/studio/x.mp3"]),
		r2: { seed: { "tracks/studio/x.mp3": { body: BODY } } },
	}),
	// the whole file
	open("a whole read"),
	open("a query string is ignored", [
		slow({ path: `/audio/file/${SLUG}?x=1` }),
	]),
	open("an owner's session is ignored", [slow({ as: asOwner() })]),
	open("a second entry", [read("fast-lane")], {
		setup: entries([SLUG, KEY], ["fast-lane", "tracks/fast-lane.mp3"]),
		r2: { seed: { ...SEED, "tracks/fast-lane.mp3": { body: BODY } } },
	}),
	open("two entries with the same slug, the first wins", [slow()], {
		setup: entries([SLUG, KEY], [SLUG, "tracks/other.mp3"]),
		r2: { seed: { ...SEED, "tracks/other.mp3": { body: BODY } } },
	}),
	open("the object is missing from R2", [slow()], { r2: { seed: {} } }),
	open(
		"the object is missing from R2, asked for a range",
		[ranged("bytes=0-9")],
		{
			r2: { seed: {} },
		},
	),
	open("the object vanishes between head and get", [ranged("bytes=0-9")], {
		r2: { seed: SEED, vanishAfterHead: [KEY] },
	}),
	open("R2's own content type is ignored", [slow()], {
		r2: {
			seed: {
				[KEY]: {
					body: BODY,
					httpMetadata: { contentType: "text/html", cacheControl: "no-store" },
				},
			},
		},
	}),
	open("an empty object", [slow()], { r2: { seed: { [KEY]: { body: "" } } } }),
	open("an empty object asked for a range", [ranged("bytes=0-")], {
		r2: { seed: { [KEY]: { body: "" } } },
	}),
	// ranges
	...RANGES.map(([name, header]) => open(`range: ${name}`, [ranged(header)])),
	// conditional requests and other headers
	...CONDITIONALS.map(([name, headers]) =>
		open(`header: ${name}`, [slow({ headers })]),
	),
	// HEAD, which the route does not export
	open("HEAD", [slow({ method: "HEAD" })]),
	open("HEAD with a Range header", [ranged("bytes=0-9", { method: "HEAD" })]),
	open("HEAD with the object missing", [slow({ method: "HEAD" })], {
		r2: { seed: {} },
	}),
	open("HEAD of an unknown slug", [read("unknown", { method: "HEAD" })]),
	// outages
	open("R2 get fails", [slow()], { r2: { seed: SEED, fails: ["get"] } }),
	open("R2 head fails on a range", [ranged("bytes=0-9")], {
		r2: { seed: SEED, fails: ["head"] },
	}),
	open("R2 get fails on a range", [ranged("bytes=0-9")], {
		r2: { seed: SEED, fails: ["get"] },
	}),
	open("R2 head fails on a whole read, which never heads", [slow()], {
		r2: { seed: SEED, fails: ["head"] },
		mustNotFire: [
			{
				trigger: "r2 AUDIO fails head",
				reason: "a whole read gets the object without a head",
			},
		],
	}),
	open(
		"R2 fails for an unknown slug, which never reaches it",
		[read("unknown")],
		{
			r2: { seed: SEED, fails: ["head", "get"] },
			mustNotFire: [
				{
					trigger: "r2 AUDIO fails head",
					reason: "an unknown slug is refused before R2",
				},
				{
					trigger: "r2 AUDIO fails get",
					reason: "an unknown slug is refused before R2",
				},
			],
		},
	),
	open(
		"R2 fails for a private key, which never reaches it",
		[read("studio-file")],
		{
			setup: entries(["studio-file", "studio/projects/r1/f1.mp3"]),
			r2: { seed: SEED, fails: ["head", "get"] },
			mustNotFire: [
				{
					trigger: "r2 AUDIO fails head",
					reason: "a private key is refused before R2",
				},
				{
					trigger: "r2 AUDIO fails get",
					reason: "a private key is refused before R2",
				},
			],
		},
	),
	open("no audio bucket", [slow()], { r2: { missing: true } }),
	open("no audio bucket, asked for a range", [ranged("bytes=0-9")], {
		r2: { missing: true },
	}),
	open("no audio bucket for an unknown slug", [read("unknown")], {
		r2: { missing: true },
	}),
	open("no audio bucket for a private key", [read("studio-file")], {
		setup: entries(["studio-file", "studio/projects/r1/f1.mp3"]),
		r2: { missing: true },
	}),
	// sequences
	open("two whole reads", [slow(), slow({ advanceMs: 1000 })]),
	open("a whole read, then a range, then HEAD", [
		slow(),
		ranged("bytes=10-19", { advanceMs: 1000 }),
		slow({ method: "HEAD", advanceMs: 1000 }),
	]),
	open("a refused range, then a served one", [
		ranged("bytes=64-"),
		ranged("bytes=0-9", { advanceMs: 1000 }),
	]),
];

defineCorpus("audio-file", GET, cases);
