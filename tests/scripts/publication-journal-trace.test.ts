import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The scripted run of verification/publication-journal.qnt, checked every time: the stale-read trace on which property 6
// was first stated wrongly. `quint test` runs the model's `run` definitions.

describe("the publication-journal model's scripted run", () => {
	it("passes: a conflict for a stale read is right even though the same envelope is stored by then", () => {
		const result = spawnSync(
			"quint",
			["test", "verification/publication-journal.qnt", "--main", "publication"],
			{ encoding: "utf8" },
		);

		expect(result.stdout).toContain("staleReadTest passed");
		expect(result.status).toBe(0);
	});
});
