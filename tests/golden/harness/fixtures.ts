// Reads, compares and (only with UPDATE_GOLDEN=1) writes the fixture files in tests/golden/fixtures.
//
// A fixture is the answer of a route as it was before its conversion. A test compares against it and never writes it.
// The comparison is on JSON: the record is round-tripped through JSON first, so what is compared is exactly what a
// fixture file can hold, and a field the code stopped producing is a difference, not an absence that `toEqual` skips.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect } from "vitest";

/** Anything recorded for a fixture: a named case. */
export type Named = { readonly name: string };

export const UPDATING = process.env.UPDATE_GOLDEN === "1";

function fixturePath(area: string) {
	return new URL(`../fixtures/${area}.json`, import.meta.url);
}

function readFixture(area: string): Named[] {
	const path = fixturePath(area);

	if (!existsSync(path)) return [];

	// SAFETY: this file is written only by `settleFixture` below, as a JSON array of recorded cases, each with a name.
	return JSON.parse(readFileSync(path, "utf8")) as Named[];
}

const written = new Map<string, Named[]>();

/** The record as a fixture file holds it. */
export function asFixture<T extends Named>(got: T): T {
	// SAFETY: the record is plain data (strings, numbers, booleans, null, arrays, objects), so a JSON round trip returns a value of the same type.
	return JSON.parse(JSON.stringify(got)) as T;
}

/** Fails unless the record is, as JSON, exactly the fixture's. The comparison every corpus test makes. */
export function sameRecord(want: Named | undefined, got: Named) {
	expect(want, `no recorded answer for "${got.name}"`).toBeDefined();
	expect(asFixture(got)).toStrictEqual(want);
}

/** Compares one recorded case with the fixture (or, with UPDATE_GOLDEN=1, keeps it to be written). */
export function expectRecorded(area: string, got: Named) {
	if (UPDATING) {
		written.set(area, [...(written.get(area) ?? []), got]);

		return;
	}

	sameRecord(
		readFixture(area).find((entry) => entry.name === got.name),
		got,
	);
}

/** With UPDATE_GOLDEN=1, writes the fixture for the area. Otherwise checks it records exactly these case names. */
export function settleFixture(area: string, names: readonly string[]) {
	if (UPDATING) {
		writeFileSync(
			fixturePath(area),
			`${JSON.stringify(written.get(area) ?? [], null, "\t")}\n`,
		);

		return;
	}

	expect(readFixture(area).map((entry) => entry.name)).toEqual([...names]);
}
