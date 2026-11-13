// Reads, compares and (only with UPDATE_GOLDEN=1) writes the fixture files in tests/golden/fixtures.
//
// A fixture file is gzip-compressed JSON (`<area>.json.gz`): the recorded cases are large and repetitive, and the
// compressed file is about a tenth of the size. The compression is deterministic (fixed level, mtime 0, no file name,
// fixed operating-system byte), so recording unchanged behaviour again produces the same bytes. A change to a fixture
// is reviewed with `pnpm run golden:diff` (see tests/golden/README.md), because GitHub cannot show a diff of it.
//
// A fixture is the answer of a route as it was before its conversion. A test compares against it and never writes it.
// The comparison is on JSON: the record is round-tripped through JSON first, so what is compared is exactly what a
// fixture file can hold, and a field the code stopped producing is a difference, not an absence that `toEqual` skips.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync, gunzipSync } from "node:zlib";
import { expect } from "vitest";

/** Anything recorded for a fixture: a named case. */
export type Named = { readonly name: string };

export const UPDATING = process.env.UPDATE_GOLDEN === "1";

function fixturePath(area: string) {
	return new URL(`../fixtures/${area}.json.gz`, import.meta.url);
}

/** gzip with a fixed header (no mtime, no name, unix) so the same text always gives the same bytes. */
export function gzipFixture(text: string): Buffer {
	const data = Buffer.from(text, "utf8");
	const header = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
	const trailer = Buffer.alloc(8);

	trailer.writeUInt32LE(crc32(data), 0);
	trailer.writeUInt32LE(data.length % 2 ** 32, 4);

	return Buffer.concat([
		header,
		deflateRawSync(data, { level: 9, memLevel: 9 }),
		trailer,
	]);
}

const read = new Map<string, Named[]>();

function readFixture(area: string): Named[] {
	const cached = read.get(area);

	if (cached) return cached;

	const path = fixturePath(area);

	if (!existsSync(path)) return [];

	// SAFETY: this file is written only by `settleFixture` below, as a JSON array of recorded cases, each with a name.
	const cases = JSON.parse(
		gunzipSync(readFileSync(path)).toString("utf8"),
	) as Named[];

	read.set(area, cases);

	return cases;
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

/** Whether every expected case was collected, in order: only then is a recording a whole fixture. */
export function isWholeRecording(
	collected: readonly Named[],
	names: readonly string[],
) {
	return (
		collected.length === names.length &&
		collected.every((entry, index) => entry.name === names[index])
	);
}

/**
 * With UPDATE_GOLDEN=1, writes the fixture for the area, but only when every expected case was collected: a case that
 * threw, or a run filtered to some cases, must not replace the fixture with a partial one. Otherwise checks it records
 * exactly these case names.
 */
export function settleFixture(area: string, names: readonly string[]) {
	if (UPDATING) {
		const collected = written.get(area) ?? [];

		if (!isWholeRecording(collected, names))
			throw new Error(
				`golden harness: ${area} was not re-recorded. Collected ${collected.length} of ${names.length} cases, so the fixture was left as it is.`,
			);

		writeFileSync(
			fixturePath(area),
			gzipFixture(`${JSON.stringify(collected, null, "\t")}\n`),
		);

		return;
	}

	expect(readFixture(area).map((entry) => entry.name)).toEqual([...names]);
}
