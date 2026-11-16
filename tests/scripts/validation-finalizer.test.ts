import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	authenticRun,
	assertTarget,
	selectAuthority,
	sameAuthority,
	assertValidationScripts,
	VALIDATION_COMMANDS,
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
		expect(candidate).toContain(
			"inputs.revision || github.event.pull_request.head.sha || github.sha",
		);
		expect(candidate).not.toContain("statuses: write");
		expect(candidate).not.toContain("  validate:");
		expect(trusted).toContain("workflow_run:");
		expect(trusted).not.toContain("workflow_dispatch:");
		expect(trusted).not.toContain("pnpm install");
		expect(trusted).not.toContain("cache:");
		expect(trusted).toContain("persist-credentials: false");
	});
});

describe("latest validation authority", () => {
	const older = {
		id: 100,
		run_attempt: 1,
		status: "completed",
		created_at: "2026-11-16T01:00:00Z",
		run_started_at: "2026-11-16T01:00:00Z",
		conclusion: "success",
	};

	const newer = {
		...older,
		id: 101,
		created_at: "2026-11-16T02:00:00Z",
		run_started_at: "2026-11-16T02:00:00Z",
		conclusion: "failure",
	};

	it("a late older completion cannot replace a newer failure", () => {
		expect(selectAuthority([newer, older])).toEqual(newer);
		expect(sameAuthority(older, selectAuthority([older, newer]))).toBe(false);
	});
	it("runner queue delay cannot make an older request authoritative", () => {
		expect(
			selectAuthority([
				{ ...older, run_started_at: "2026-11-16T04:00:00Z" },
				newer,
			]),
		).toEqual(newer);
	});
	it("a newer rerun attempt invalidates the old attempt", () => {
		const retry = {
			...older,
			run_attempt: 2,
			run_started_at: "2026-11-16T03:00:00Z",
			status: "in_progress",
			conclusion: null,
		};

		expect(selectAuthority([older, newer, retry])).toEqual(retry);
		expect(sameAuthority(older, retry)).toBe(false);
	});
	it("unknown newer dispatch targets hold rather than recycling old green", () => {
		const unbound = { ...newer, unbound: true, conclusion: null };
		expect(selectAuthority([older, unbound])).toEqual(unbound);
		expect(sameAuthority(unbound, unbound)).toBe(false);
	});
	it("pins every invoked package command and lifecycle hooks", () => {
		const trusted = Object.fromEntries(
			VALIDATION_COMMANDS.map((name) => [name, `trusted ${name}`]),
		);

		expect(() =>
			assertValidationScripts(trusted, { ...trusted }),
		).not.toThrow();

		for (const name of VALIDATION_COMMANDS) {
			for (const key of [name, `pre${name}`, `post${name}`])
				expect(() =>
					assertValidationScripts(trusted, { ...trusted, [key]: "true" }),
				).toThrow(/validation command differs/);
		}
	});
});

it("re-resolves provenance inside a per-head lock and rejects target substitution", () => {
	expect(() => assertTarget(sha, sha)).not.toThrow();
	expect(() => assertTarget(sha, base)).toThrow(/target changed/);
	expect(() => assertTarget(undefined, sha)).toThrow(/target changed/);

	const workflow = readFileSync(
		".github/workflows/validation-finalize.yml",
		"utf8",
	);

	expect(workflow).not.toMatch(/^concurrency:/m);
	expect(workflow).toContain(
		"group: trusted-validation-${{ needs.resolve.outputs.sha }}",
	);
	expect(workflow).toContain("EXPECTED_SHA: ${{ needs.resolve.outputs.sha }}");
	const discover = workflow.split("  resolve:\n")[1].split("  finalize:\n")[0];
	expect(discover).not.toContain("statuses: write");
	expect(discover).toContain("finalize-validation.mjs discover");
	expect(workflow.split("  finalize:\n")[1]).toContain(
		"finalize-validation.mjs resolve",
	);
});

it("authenticates both REST path formats without accepting an unrelated ref", () => {
	for (const suffix of ["@main", "@refs/heads/main"])
		expect(
			authenticRun(
				{ ...run, path: workflow.path + suffix },
				workflow,
				repository,
				"validation",
			),
		).toBe(true);

	for (const suffix of ["@attacker", "@refs/heads/attacker", "@main@attacker"])
		expect(
			authenticRun(
				{ ...run, path: workflow.path + suffix },
				workflow,
				repository,
				"validation",
			),
		).toBe(false);

	const pull = {
		...run,
		event: "pull_request",
		head_branch: "feature",
		head_sha: sha,
		pull_requests: [{ number: 213 }],
	};

	for (const suffix of [
		"@feature",
		"@refs/heads/feature",
		"@refs/pull/213/merge",
		`@${sha}`,
	])
		expect(
			authenticRun(
				{ ...pull, path: workflow.path + suffix },
				workflow,
				repository,
				"validation",
			),
		).toBe(true);
	expect(
		authenticRun(
			{ ...pull, path: workflow.path + "@refs/pull/214/merge" },
			workflow,
			repository,
			"validation",
		),
	).toBe(false);
});

it("uses the resolved trusted base and an author-immutable check", () => {
	const trusted = readFileSync(
		".github/workflows/validation-finalize.yml",
		"utf8",
	);

	expect(trusted).toContain("ref: ${{ needs.resolve.outputs.base }}");
	expect(trusted).toContain("EXPECTED_BASE: ${{ needs.resolve.outputs.base }}");
	expect(trusted).toContain("checks: write");

	const publisher = readFileSync(
		".github/workflows/link-previews-publish.yml",
		"utf8",
	);

	expect(publisher).toContain(
		"SCREENSHOTS_COMMIT: ${{ steps.sheets.outputs.commit }}",
	);
	expect(publisher).toContain("node scripts/og-video/review-evidence.mjs");
});
