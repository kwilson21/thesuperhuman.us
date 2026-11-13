// Helpers for the differential tests that hold an Effect Schema validator to the Zod 3 validator it replaced
// (tests/server/validators-differential.test.ts): a seeded random source, pools of awkward values, and the comparison.
import { inspect } from "node:util";
import * as Predicate from "effect/Predicate";
import type { RawValue } from "../../src/lib/fields";

/** A small seeded random source (mulberry32), so a failing case is the same case on every run. */
export function seeded(seed: number) {
	let state = seed >>> 0;

	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	return {
		next,
		below: (n: number) => Math.floor(next() * n),
		pick: <T>(items: readonly T[]): T =>
			items[Math.floor(next() * items.length)],
		chance: (p: number) => next() < p,
	};
}

/** Values that are not strings, of every kind Zod 3 names (a missing field is `undefined`). */
export const notStrings: readonly RawValue[] = [
	undefined,
	null,
	0,
	1,
	-1,
	1.5,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	true,
	false,
	[],
	["a"],
	[[]],
	{},
	{ a: 1 },
	{ length: 3 },
	() => "x",
	10n,
	Symbol("s"),
	new Date(0),
	new Map(),
	new Set(),
	Promise.resolve("p"),
];

/**
 * Text that has to be told apart at a field with this maximum: empty, blank, at the maximum and either side of it,
 * far over it, padded, with every kind of line break and control character, lone surrogates, text that normalises
 * (decomposed letters, ligatures, compatibility characters), text whose length before and after normalising
 * straddles the maximum, characters outside the BMP, and markup.
 */
export function texts(max: number): string[] {
	const half = Math.max(1, Math.floor(max / 2));

	return [
		"",
		" ",
		"   ",
		"\t",
		"\n",
		"\r\n",
		" \r\n\t ",
		" ",
		" ",
		"﻿",
		"​",
		"\u0085",
		"a",
		"ab",
		" a ",
		"\ta\n",
		"A",
		"Ada Lovelace",
		"a".repeat(max - 1),
		"a".repeat(max),
		"a".repeat(max + 1),
		"a".repeat(max * 5 + 7),
		`  ${"a".repeat(max)}  `,
		`  ${"a".repeat(max + 1)}  `,
		` ${"a".repeat(max - 1)} `,
		"a\nb",
		"a\rb",
		"a\r\nb",
		"a\tb",
		"a\u0000b",
		"\u0000",
		"a\u0001b",
		"a\u0007b",
		"a\u0008b",
		"a\u000bb",
		"a\u000cb",
		"a\u000eb",
		"a\u001fb",
		"a\u007fb",
		"a\u0080b",
		"a\u009fb",
		"a b",
		"a b",
		"a\ud800",
		"\udc00a",
		"a\ud83d",
		"\ud800\ud800",
		"😀",
		`a${"😀".repeat(half)}`,
		"😀".repeat(half + 1),
		"é",
		"é",
		"é".repeat(half),
		"é".repeat(half + 1),
		"é".repeat(max),
		"é".repeat(max),
		"é".repeat(max + 1),
		"Å",
		"Ω",
		"ﬁ",
		"Å",
		"Å",
		"ẛ̣",
		"한글",
		"ｱｲｳ",
		"İ",
		"ß",
		"<script>alert(1)</script>",
		"<b>bold</b> & more",
		"'; DROP TABLE users; --",
		"__proto__",
		"constructor",
		"toString",
		"null",
		"undefined",
		"true",
		"0",
		"-1",
		"  ́a",
		`${"x".repeat(max - 1)}\n`,
		`${"x".repeat(max)}\n`,
		`${"x".repeat(max + 1)}\n`,
		`${"x".repeat(max - 1)}\u0000`,
		`${"x".repeat(max + 5)}\u0000`,
		`\u0000${"x".repeat(max + 5)}`,
		`${"x".repeat(max - 1)}\ud800`,
	];
}

/** Emails of many shapes: valid, invalid, odd, at the usual lengths, and padded. */
export const emails: readonly string[] = [
	"a@b.co",
	"ada@example.com",
	"ADA@EXAMPLE.COM",
	"Ada.Lovelace@Example.Co.UK",
	"a+b@c.dd",
	"a_b@c.dd",
	"a-b@c-d.ee",
	"a'b@c.dd",
	"a..b@c.dd",
	".a@c.dd",
	"a.@c.dd",
	"a@c",
	"a@c.d",
	"a@c.dd",
	"a@c.d1",
	"a@c.1d",
	"a@.dd",
	"a@c..dd",
	"a@-c.dd",
	"a@c-.dd",
	"a@c_d.dd",
	"a@@c.dd",
	"a@b@c.dd",
	"@c.dd",
	"a@",
	"@",
	"a",
	"a b@c.dd",
	"a@c d.dd",
	'"a"@c.dd',
	"a@[1.2.3.4]",
	"a@1.2.3.4",
	"ü@c.dd",
	"a@ü.dd",
	"a@xn--bcher-kva.example",
	"a@c.ddddddddddddddddd",
	"a@c.dd.",
	"a@c.dd\n",
	"a@c.dd\t",
	"\na@c.dd",
	" a@c.dd ",
	"\ta@c.dd\r\n",
	"a\u0000@c.dd",
	"a@c.dd\u0000",
	"a@c.d\ud800",
	"a%40b@c.dd",
	"a,b@c.dd",
	"a;b@c.dd",
	"a<b>@c.dd",
	"a(b)@c.dd",
	"a/b@c.dd",
	"a=b@c.dd",
	"a?b@c.dd",
	"a!b@c.dd",
	"a#b@c.dd",
	"a$b@c.dd",
	"a&b@c.dd",
	"a*b@c.dd",
	"a^b@c.dd",
	"a`b@c.dd",
	"a{b}@c.dd",
	"a|b@c.dd",
	"a~b@c.dd",
	"-a@c.dd",
	"+a@c.dd",
	"_a@c.dd",
	"a-@c.dd",
	"a+@c.dd",
	"a_@c.dd",
	"a'@c.dd",
	"'a@c.dd",
	"a.b.c@d.e.f.gg",
	"1@2.34",
	"a@b.c-d",
	"a@b.cd-",
	`${"a".repeat(63)}@c.dd`,
	`${"a".repeat(110)}@c.dd`,
	`${"a".repeat(111)}@c.dd`,
	`${"a".repeat(112)}@c.dd`,
	`${"a".repeat(113)}@c.dd`,
	`${"a".repeat(114)}@c.dd`,
	`${"a".repeat(115)}@c.dd`,
	`${"a".repeat(116)}@c.dd`,
	`${"a".repeat(117)}@c.dd`,
	`${"a".repeat(300)}@c.dd`,
	`${"a".repeat(312)}@c.dd`,
	`${"a".repeat(313)}@c.dd`,
	`${"a".repeat(314)}@c.dd`,
	`${"a".repeat(315)}@c.dd`,
	`${"a".repeat(316)}@c.dd`,
	`${"a".repeat(317)}@c.dd`,
	` ${"a".repeat(316)}@c.dd `,
	`${"a".repeat(400)}@c.dd`,
	`a@${"b".repeat(60)}.dd`,
	`a@${"b.".repeat(60)}dd`,
	"x".repeat(119),
	"x".repeat(120),
	"x".repeat(121),
	"x".repeat(321),
	`${"a".repeat(118)}@b`,
	`  ${"a".repeat(112)}@c.dd  `,
	"",
	" ",
];

/** Link-field values: blank, every scheme, credentials, odd hosts, and lengths either side of the limit. */
export const links: readonly string[] = [
	"",
	" ",
	"https://example.com",
	"HTTPS://EXAMPLE.COM/Path",
	"  https://example.com/a  ",
	"https://example.com/a?b=c#d",
	"https://sub.example.co.uk:8443/x",
	"http://example.com",
	"ftp://example.com",
	"javascript:alert(1)",
	"mailto:a@b.co",
	"data:text/plain,hi",
	"file:///etc/passwd",
	"https://u@example.com",
	"https://u:p@example.com",
	"https://:p@example.com",
	"https://@example.com",
	"https://",
	"https:///x",
	"https:example.com",
	"https:/example.com",
	"https//example.com",
	"//example.com",
	"example.com",
	"www.example.com",
	"example.com:8080",
	"localhost",
	"localhost:3000",
	"https://localhost",
	"https://localhost:8080/x",
	"https://[::1]/",
	"https://127.0.0.1",
	"https://exa mple.com",
	"https://example.com/a b",
	"https://ex\tample.com",
	"https://example.com\n",
	"https://example.com\nx",
	"https://例え.jp/パス",
	"https://xn--r8jz45g.jp",
	"https://exa_mple.com",
	"https://example.com:99999",
	"https://example.com:abc",
	"https://.",
	"https://..",
	"https://a",
	"Website: example.com",
	"foo@bar.com",
	"n/a",
	"none",
	"not a link",
	"http://",
	"x.com:8080",
	"HTTP://X.COM",
	"https://a.b/\u0000",
	`https://example.com/${"a".repeat(2000)}`,
	`https://example.com/${"a".repeat(2020)}`,
	`https://example.com/${"a".repeat(2027)}`,
	`https://example.com/${"a".repeat(2028)}`,
	`https://example.com/${"a".repeat(2029)}`,
	`https://example.com/${"a".repeat(5000)}`,
	`https://${"é".repeat(400)}.com`,
	`${"a".repeat(2049)}`,
	`https://${"a".repeat(2043)}`,
	`  https://${"a".repeat(2043)}  `,
];

/** A value as JSON with every object's keys sorted: a value is compared deeply, not by the order its keys were made in. */
function stable(value: RawValue): string {
	return JSON.stringify(value, (_key, inner: RawValue) =>
		Predicate.isObject(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) =>
						a < b ? -1 : a > b ? 1 : 0,
					),
				)
			: inner,
	);
}

/**
 * What an answer looks like, in one comparable line: the flag, then the value, and every error key and message in the
 * order they were given (which the browser's focus order follows). A value is compared with its keys sorted unless
 * `ordered` is set, which compares it as `JSON.stringify` writes it, key order included.
 */
export function fingerprint(
	answer:
		| { ok: true; value: RawValue }
		| { ok: false; errors: Readonly<Record<string, string>> },
	ordered = false,
): string {
	if (!answer.ok)
		return JSON.stringify(["errors", Object.entries(answer.errors)]);

	return ordered
		? `ok ${JSON.stringify(answer.value)}`
		: `ok ${stable(answer.value)}`;
}

/** Runs a validator, giving what it threw (never expected) in place of an answer. */
export function attempt<A>(run: () => A): A | { threw: string } {
	try {
		return run();
	} catch (error) {
		return { threw: error instanceof Error ? error.message : String(error) };
	}
}

export type Mismatch = { input: string; expected: string; actual: string };

/** Collects each input the two validators answer differently, and counts the inputs run. */
export function differential<I, A extends object>(
	oracle: (input: I) => A,
	subject: (input: I) => A,
	describeAnswer: (answer: A) => string,
	observe?: (expected: A) => void,
) {
	const mismatches: Mismatch[] = [];
	let count = 0;

	return {
		run(input: I) {
			count += 1;

			const expected = attempt(() => oracle(input));

			if (observe && !("threw" in expected)) observe(expected);
			const actual = attempt(() => subject(input));

			const said = (answer: A | { threw: string }) =>
				"threw" in answer ? `threw: ${answer.threw}` : describeAnswer(answer);

			if (said(expected) !== said(actual))
				mismatches.push({
					input: inspect(input, { depth: 4, breakLength: 200 }).slice(0, 600),
					expected: said(expected).slice(0, 600),
					actual: said(actual).slice(0, 600),
				});
		},
		get count() {
			return count;
		},
		get mismatches() {
			return mismatches;
		},
	};
}
