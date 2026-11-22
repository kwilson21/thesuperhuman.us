import { initialTransition } from "xstate";
import { describe, expect, it } from "vitest";
import { next, sourcesOf } from "../../src/server/machines/next";
import {
	ATTEMPTS_PER_CODE,
	CODE_EVENTS,
	CODE_STATES,
	type CodeRow,
	codeAllows,
	codeStateOf,
	discardStateOf,
	signinCode,
} from "../../src/server/machines/signin-code";

// The sign-in code's machine (docs/plans/2026-11-studio-signin-conversion.md, section 1): the state derived from a row,
// and the moves each state allows. The table below is today's answers, written from `decideComplete` and `decideDiscard`
// (src/lib/signin-code-rules.ts at f9480f78, with the limit of 5 attempts) before the conversion deletes them: for each
// row, whether the entry counted an attempt ("count") or refused it (NoCodeToTry), and whether the discard discarded
// ("discard") or refused (NothingToDiscard). The machine must give the same answers, through the full state for ENTER
// and DISCARD, and through the discard's own state (`used_at` alone) for DISCARD.

const NOW = "2026-11-22T12:00:00.000Z";
const LATER = "2026-11-22T12:10:00.000Z";
const EARLIER = "2026-11-22T11:59:00.000Z";

const row = (over: Partial<CodeRow> = {}): CodeRow => ({
	attempts: 0,
	usedAt: null,
	expiresAt: LATER,
	...over,
});

type Today = {
	readonly name: string;
	readonly row: CodeRow | null;
	readonly state: (typeof CODE_STATES)[number];
	readonly entry: "count" | "NoCodeToTry";
	readonly discard: "discard" | "NothingToDiscard";
};

const TODAY: readonly Today[] = [
	{
		name: "no row",
		row: null,
		state: "none",
		entry: "NoCodeToTry",
		discard: "NothingToDiscard",
	},
	{
		name: "a used code",
		row: row({ usedAt: EARLIER }),
		state: "used",
		entry: "NoCodeToTry",
		discard: "NothingToDiscard",
	},
	{
		name: "a used code past its lifetime",
		row: row({ usedAt: EARLIER, expiresAt: EARLIER }),
		state: "used",
		entry: "NoCodeToTry",
		discard: "NothingToDiscard",
	},
	{
		name: "a used code at the attempt limit",
		row: row({ usedAt: EARLIER, attempts: ATTEMPTS_PER_CODE }),
		state: "used",
		entry: "NoCodeToTry",
		discard: "NothingToDiscard",
	},
	{
		name: "an unused code at the instant of expiry",
		row: row({ expiresAt: NOW }),
		state: "expired",
		entry: "NoCodeToTry",
		discard: "discard",
	},
	{
		name: "an unused code a minute past expiry",
		row: row({ expiresAt: EARLIER }),
		state: "expired",
		entry: "NoCodeToTry",
		discard: "discard",
	},
	{
		name: "an unused code past expiry and at the attempt limit",
		row: row({ expiresAt: EARLIER, attempts: ATTEMPTS_PER_CODE }),
		state: "expired",
		entry: "NoCodeToTry",
		discard: "discard",
	},
	{
		name: "an unused, unexpired code at the attempt limit",
		row: row({ attempts: ATTEMPTS_PER_CODE }),
		state: "locked",
		entry: "NoCodeToTry",
		discard: "discard",
	},
	{
		name: "an unused, unexpired code one attempt under the limit",
		row: row({ attempts: ATTEMPTS_PER_CODE - 1 }),
		state: "live",
		entry: "count",
		discard: "discard",
	},
	{
		name: "an unused code that expires a millisecond later",
		row: row({ expiresAt: "2026-11-22T12:00:00.001Z" }),
		state: "live",
		entry: "count",
		discard: "discard",
	},
	{
		name: "a fresh code",
		row: row(),
		state: "live",
		entry: "count",
		discard: "discard",
	},
];

describe("the sign-in code's state, against today's decisions", () => {
	it("has the limit today's entry used", () => {
		expect(ATTEMPTS_PER_CODE).toBe(5);
	});

	for (const today of TODAY)
		it(`${today.name}: ${today.state}, entry ${today.entry}, discard ${today.discard}`, () => {
			const state = codeStateOf(today.row, NOW);

			expect(state).toBe(today.state);
			expect(codeAllows(state, "ENTER")).toBe(today.entry === "count");
			expect(codeAllows(state, "DISCARD")).toBe(today.discard === "discard");
			expect(codeAllows(discardStateOf(today.row), "DISCARD")).toBe(
				today.discard === "discard",
			);
			expect(codeAllows(state, "ISSUE")).toBe(true);
		});

	it("covers every state", () => {
		expect(new Set(TODAY.map((today) => today.state))).toEqual(
			new Set(CODE_STATES),
		);
	});
});

describe("the sign-in code's moves", () => {
	it("starts with no code", () => {
		expect(initialTransition(signinCode)[0].value).toBe("none");
	});

	it("has the states in the order a row is read, and the three moves", () => {
		expect(Object.keys(signinCode.config.states ?? {})).toEqual([
			...CODE_STATES,
		]);
		expect(CODE_EVENTS).toEqual(["ISSUE", "ENTER", "DISCARD"]);
	});

	it("issues a live code from every state: the browser's row is replaced, or inserted", () => {
		for (const state of CODE_STATES)
			expect(next(signinCode, state, "ISSUE")).toBe("live");
		expect(sourcesOf(signinCode, "ISSUE")).toEqual([...CODE_STATES]);
	});

	it("takes an entry only from live: accepted is used, the last refused attempt locked, any other live", () => {
		expect(sourcesOf(signinCode, "ENTER")).toEqual(["live"]);

		const entered = (accepted: boolean, lastAttempt: boolean) =>
			next(signinCode, "live", { type: "ENTER", accepted, lastAttempt });

		expect(entered(true, false)).toBe("used");
		expect(entered(true, true)).toBe("used");
		expect(entered(false, true)).toBe("locked");
		expect(entered(false, false)).toBe("live");
		expect(next(signinCode, "live", "ENTER")).toBe("live");

		for (const state of ["none", "used", "expired", "locked"])
			expect(
				next(signinCode, state, {
					type: "ENTER",
					accepted: true,
					lastAttempt: false,
				}),
			).toBeNull();
	});

	it("discards from live, locked and expired, to no row, and refuses used and none", () => {
		expect(sourcesOf(signinCode, "DISCARD")).toEqual([
			"expired",
			"locked",
			"live",
		]);

		for (const state of ["expired", "locked", "live"])
			expect(next(signinCode, state, "DISCARD")).toBe("none");
	});

	it("derives the discard's state from used_at alone", () => {
		expect(discardStateOf(null)).toBe("none");
		expect(discardStateOf({ usedAt: EARLIER })).toBe("used");
		expect(discardStateOf({ usedAt: null })).toBe("live");
	});
});
