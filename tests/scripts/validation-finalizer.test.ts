import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	authenticRun,
	validMarker,
	eligiblePull,
	decision,
} from "../../scripts/og-video/finalize-validation.mjs";

const sha = "a".repeat(40);
const base = "b".repeat(40);
const repository = "owner/site";
const workflow = { id: 42, path: ".github/workflows/validate.yml" };

const run = {
	workflow_id: 42,
	path: workflow.path,
	repository: { full_name: repository },
	event: "workflow_dispatch",
	head_branch: "main",
	id: 100,
	run_attempt: 2,
};

const pr = {
	state: "open",
	head: { sha, repo: { full_name: repository } },
	base: { sha: base, ref: "main", repo: { full_name: repository } },
};

const ready = {
	validation: "success",
	changed: true,
	receipt: { sha, base, pr: "213" },
	sha,
	base,
	pr: 213,
};

describe("trusted validation provenance", () => {
	it("accepts only main dispatches and known workflow identity", () => {
		expect(authenticRun(run, workflow, repository, "validation")).toBe(true);

		for (const changes of [
			{ head_branch: "attacker" },
			{ workflow_id: 12 },
			{ path: "other.yml" },
			{ repository: { full_name: "fork/site" } },
			{ event: "push" },
		]) {
			expect(
				authenticRun(
					{ ...run, ...changes },
					workflow,
					repository,
					"validation",
				),
			).toBe(false);
		}
	});
	it("accepts publisher receipts only from workflow_run", () => {
		expect(authenticRun(run, workflow, repository, "publisher")).toBe(false);
		expect(
			authenticRun(
				{ ...run, event: "workflow_run" },
				workflow,
				repository,
				"publisher",
			),
		).toBe(true);
	});
	it("binds markers to exact run and attempt", () => {
		expect(validMarker({ sha, run: "100", attempt: "2" }, run)).toBe(true);
		expect(validMarker({ sha, run: "100", attempt: "1" }, run)).toBe(false);
		expect(validMarker({ sha, run: "101", attempt: "2" }, run)).toBe(false);
		expect(validMarker({ sha: "main", run: "100", attempt: "2" }, run)).toBe(
			false,
		);
	});
	it("requires an open same-repository exact head and main base", () => {
		expect(eligiblePull(pr, sha, repository)).toBe(true);
		expect(eligiblePull({ ...pr, state: "closed" }, sha, repository)).toBe(
			false,
		);
		expect(eligiblePull(pr, base, repository)).toBe(false);
		expect(
			eligiblePull(
				{ ...pr, base: { ...pr.base, ref: "other" } },
				sha,
				repository,
			),
		).toBe(false);
	});
	it("cannot green from tests alone, forged or stale review", () => {
		expect(decision(ready)).toBe("ready");
		expect(decision({ ...ready, receipt: null })).toBe("pending");
		expect(
			decision({ ...ready, receipt: { ...ready.receipt, base: sha } }),
		).toBe("pending");
		expect(
			decision({ ...ready, receipt: { ...ready.receipt, sha: base } }),
		).toBe("pending");
		expect(
			decision({ ...ready, receipt: { ...ready.receipt, pr: "214" } }),
		).toBe("pending");
		expect(decision({ ...ready, validation: null })).toBe("pending");
		expect(decision({ ...ready, validation: "failure" })).toBe("failure");
		expect(decision({ ...ready, changed: false, receipt: null })).toBe("ready");
	});
	it("leaves private credentials and required success outside candidate execution", () => {
		const candidate = readFileSync(".github/workflows/validate.yml", "utf8");

		const trusted = readFileSync(
			".github/workflows/validation-finalize.yml",
			"utf8",
		);

		expect(candidate).not.toContain("PRIVATE_TOKEN");
		expect(candidate).not.toContain("cache: pnpm");
		expect(candidate).not.toContain("statuses: write");
		expect(candidate).not.toContain("  validate:");
		expect(trusted).toContain("workflow_run:");
		expect(trusted).not.toContain("workflow_dispatch:");
		expect(trusted).not.toContain("pnpm install");
		expect(trusted).not.toContain("cache:");
		expect(trusted).toContain("persist-credentials: false");
	});
});
