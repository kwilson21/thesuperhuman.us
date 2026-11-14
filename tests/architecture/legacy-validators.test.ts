import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The frozen Zod 3 copies of the validators converted in layer 7 (tests/fixtures/legacy-validators) are reference
// copies for the differential tests, kept for the Effect stack's layer 7 only. They are test fixtures, not product
// code: no file under src/ or scripts/ may import them, and each says so at the top. The stack's final layer deletes
// the directory and this test with it.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(join(repository, file), "utf8");

describe("the frozen Zod validators", () => {
	const frozen = globSync("tests/fixtures/legacy-validators/*.ts", {
		cwd: repository,
	});

	it("are the six reference copies", () => {
		expect(frozen.map((file) => file.split("/").pop()).sort()).toEqual([
			"agreement-client-fields.ts",
			"agreement-draft-fields.ts",
			"agreement-fields.ts",
			"audio-intake.ts",
			"music-demand.ts",
			"software-inquiry.ts",
		]);
	});

	it("each says at the top that it is a frozen reference copy and not product code", () => {
		for (const file of frozen)
			expect(read(file).split("\n").slice(0, 4).join("\n")).toMatch(
				/^\/\/ FROZEN REFERENCE COPY\./,
			);
	});

	it("are imported by no file under src/ or scripts/", () => {
		const importing = globSync("{src,scripts}/**/*.{ts,tsx,js,mjs,astro}", {
			cwd: repository,
		}).filter((file) =>
			/legacy-validators|tests\/fixtures|\.\.\/tests\//.test(read(file)),
		);

		expect(importing).toEqual([]);
	});
});
