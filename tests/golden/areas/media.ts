// Shared builders for the golden corpora of the three media routes (music/file, audio/file and og/[name].mp4): the
// bytes every object holds, the Range headers every route is asked, and the headers of a plain read.

/** 64 bytes, so a range can name the first, the middle, the last and the byte past the end by number. */
export const BODY = "0123456789abcdef".repeat(4);

export const SIZE = BODY.length;

/**
 * The Range headers each route is asked (the file is 64 bytes). The routes answer them differently, which is what the
 * corpus records: the name says what the header asks, never what a route answers.
 */
export const RANGES: readonly (readonly [string, string])[] = [
	["the first bytes", "bytes=0-15"],
	["a middle range", "bytes=16-31"],
	["an open-ended range", "bytes=48-"],
	["a suffix range", "bytes=-8"],
	["one byte", "bytes=0-0"],
	["the last byte", "bytes=63-63"],
	["an end past the size", "bytes=0-1000"],
	["a start inside and an end past the size", "bytes=60-99"],
	["a suffix longer than the file", "bytes=-100"],
	["the whole file as a range", "bytes=0-"],
	["the whole file as a closed range", "bytes=0-63"],
	["a start at the size", "bytes=64-"],
	["a start past the size", "bytes=100-120"],
	["a start after the end", "bytes=10-5"],
	["a zero suffix", "bytes=-0"],
	["a range with no start and no end", "bytes=-"],
	["another unit", "items=0-5"],
	["two ranges", "bytes=0-5,10-15"],
	["a range in capitals", "BYTES=0-5"],
	["a range with a leading space (Headers trims it)", " bytes=0-5"],
	["a range with a space after the unit", "bytes= 0-5"],
	["a range of letters", "bytes=a-b"],
	["a range with leading zeros", "bytes=00-05"],
	["an end too large to be exact", "bytes=0-99999999999999999999"],
	["a start too large to be exact", "bytes=99999999999999999999-"],
	["an empty range header", ""],
];

/** Request headers a cache or a browser adds. None of the routes read them. */
export const CONDITIONALS: readonly (readonly [
	string,
	{ [name: string]: string },
])[] = [
	["If-None-Match with a tag", { "if-none-match": '"abc"' }],
	["If-None-Match with a star", { "if-none-match": "*" }],
	[
		"If-Modified-Since",
		{ "if-modified-since": "Wed, 01 Jan 2020 00:00:00 GMT" },
	],
	["If-Range with a range", { "if-range": '"abc"', range: "bytes=0-9" }],
	[
		"a cookie and an authorization header",
		{ cookie: "studio_session=x", authorization: "Bearer x" },
	],
];
