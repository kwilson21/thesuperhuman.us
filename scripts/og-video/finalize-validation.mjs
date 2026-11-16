// Default-branch workflow_run only. Candidate checkouts are data, never executable code.
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceSummary, verifyEvidence } from "./review-evidence.mjs";

const SHA = /^[0-9a-f]{40}$/;

export function authenticPath(run, workflow, kind) {
	if (run.path === workflow.path) return true;

	if (typeof run.path !== "string" || !run.path.startsWith(`${workflow.path}@`))
		return false;
	const ref = run.path.slice(workflow.path.length + 1);

	if (kind === "publisher" || run.event === "workflow_dispatch")
		return ["main", "refs/heads/main"].includes(ref);

	if (run.event !== "pull_request") return false;

	return [
		run.head_branch,
		`refs/heads/${run.head_branch}`,
		run.head_sha,
		...(run.pull_requests ?? []).flatMap((pr) =>
			Number.isSafeInteger(pr.number)
				? [`refs/pull/${pr.number}/merge`, `refs/pull/${pr.number}/head`]
				: [],
		),
	].includes(ref);
}

export function authenticRun(run, workflow, repository, kind) {
	return (
		run.workflow_id === workflow.id &&
		authenticPath(run, workflow, kind) &&
		run.repository?.full_name === repository &&
		(kind === "publisher"
			? run.event === "workflow_run"
			: run.event === "pull_request" ||
				(run.event === "workflow_dispatch" && run.head_branch === "main"))
	);
}

export function validMarker(marker, run) {
	return (
		SHA.test(marker?.sha ?? "") &&
		marker.run === String(run.id) &&
		marker.attempt === String(run.run_attempt)
	);
}

export function eligiblePull(pr, sha, repository) {
	return (
		pr.state === "open" &&
		pr.head.sha === sha &&
		pr.head.repo?.full_name === repository &&
		pr.base.ref === "main" &&
		pr.base.repo?.full_name === repository
	);
}

export function decision({ validation, changed, receipt, sha, pr, base }) {
	if (validation !== "success") return validation ? "failure" : "pending";

	if (
		changed &&
		!(
			receipt?.sha === sha &&
			receipt?.pr === String(pr) &&
			receipt?.base === base
		)
	)
		return "pending";

	return "ready";
}

const repository = process.env.GITHUB_REPOSITORY;
const apiRoot = `https://api.github.com/repos/${repository}`;

async function api(path, body) {
	const options = {
		method: body ? "POST" : "GET",
		headers: {
			authorization: `Bearer ${process.env.GH_TOKEN}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
		},
	};

	if (body) options.body = JSON.stringify(body);
	const response = await fetch(`${apiRoot}/${path}`, options);

	if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);

	return response.json();
}

async function marker(run, prefix, filename) {
	const list = await api(`actions/runs/${run.id}/artifacts?per_page=100`);

	const matches = list.artifacts.filter(
		(a) => a.name === `${prefix}-${run.run_attempt}` && !a.expired,
	);

	if (!matches.length) return null;

	if (matches.length !== 1 || matches[0].size_in_bytes > 65536)
		throw new Error("Invalid receipt artifact");

	const response = await fetch(
		`${apiRoot}/actions/artifacts/${matches[0].id}/zip`,
		{ headers: { authorization: `Bearer ${process.env.GH_TOKEN}` } },
	);

	if (!response.ok) throw new Error("Receipt download failed");
	const bytes = Buffer.from(await response.arrayBuffer());

	if (bytes.length > 65536) throw new Error("Receipt archive too large");
	const directory = mkdtempSync(join(tmpdir(), "validation-receipt-"));

	try {
		const zip = join(directory, "receipt.zip");
		writeFileSync(zip, bytes);

		const names = execFileSync("unzip", ["-Z1", zip], {
			encoding: "utf8",
			maxBuffer: 65536,
		}).trim();

		if (names !== filename) throw new Error("Unexpected receipt paths");

		const result = JSON.parse(
			execFileSync("unzip", ["-p", zip, filename], {
				encoding: "utf8",
				maxBuffer: 65536,
			}),
		);

		if (!validMarker(result, run))
			throw new Error("Receipt run/attempt mismatch");

		return result;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

async function status(sha, state, evidenceUrl) {
	if (!SHA.test(sha)) throw new Error("Invalid status head");
	await api(`statuses/${sha}`, {
		state,
		context: "validate",
		description: "Trusted tests, preview review and private approvals",
		target_url:
			evidenceUrl ??
			`https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
	});
}

export function runOrder(run) {
	// First attempts are ordered by request creation, not runner queue latency.
	// A rerun reuses its ID/creation time, so its current attempt needs a fresh timestamp.
	let timestamp = run.created_at;

	if (run.run_attempt > 1)
		timestamp = run.status === "queued" ? run.updated_at : run.run_started_at;
	const time = Date.parse(timestamp);

	if (
		!Number.isFinite(time) ||
		!Number.isSafeInteger(run.id) ||
		!Number.isSafeInteger(run.run_attempt)
	)
		throw new Error("Invalid run order");

	return [time, run.id, run.run_attempt];
}

export function selectAuthority(runs) {
	return [...runs].sort((a, b) => {
		const left = runOrder(a),
			right = runOrder(b);

		return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
	})[0];
}

export function sameAuthority(a, b) {
	return Boolean(
		a &&
			b &&
			!a.unbound &&
			!b.unbound &&
			a.id === b.id &&
			a.run_attempt === b.run_attempt,
	);
}

async function latestValidation(sha, workflow) {
	const pulls = await api(
		`actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${sha}&per_page=100`,
	);

	const dispatches = await api(
		`actions/workflows/${workflow.id}/runs?event=workflow_dispatch&branch=main&per_page=100`,
	);

	const candidates = [];

	for (let run of [...pulls.workflow_runs, ...dispatches.workflow_runs]) {
		if (!authenticRun(run, workflow, repository, "validation")) continue;
		// Query the current attempt rather than accepting the triggering completion's stale snapshot.
		run = await api(`actions/runs/${run.id}`);

		if (!authenticRun(run, workflow, repository, "validation")) continue;

		const value = await marker(run, "validation-target", "result.json");

		if (value?.sha === sha) candidates.push({ ...run, target: value });
		else if (
			!value &&
			(run.event === "workflow_dispatch" || run.head_sha === sha)
		)
			candidates.push({ ...run, unbound: true, conclusion: null });
	}

	return selectAuthority(candidates);
}

async function target() {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const source = await api(`actions/runs/${event.workflow_run.id}`);
	const validationWorkflow = await api("actions/workflows/validate.yml");

	const publisherWorkflow = await api(
		"actions/workflows/link-previews-publish.yml",
	);

	let sha;
	let receipt;

	if (authenticRun(source, validationWorkflow, repository, "validation")) {
		if (source.event === "pull_request") sha = source.head_sha;
		else sha = (await marker(source, "validation-target", "result.json"))?.sha;
	} else if (
		authenticRun(source, publisherWorkflow, repository, "publisher") &&
		source.conclusion === "success"
	) {
		receipt = await marker(source, "preview-receipt", "receipt.json");
		sha = receipt?.sha;
	} else return;

	if (!SHA.test(sha ?? "")) return;

	const pulls = (await api(`commits/${sha}/pulls?per_page=100`)).filter((pr) =>
		eligiblePull(pr, sha, repository),
	);

	if (pulls.length !== 1) return;

	return { sha, pr: pulls[0], receipt, validationWorkflow, publisherWorkflow };
}

export function assertTarget(expected, actual) {
	if (!SHA.test(expected ?? "") || expected !== actual)
		throw new Error("Finalizer target changed after concurrency resolution");
}

async function discover() {
	const result = await target();

	if (result) {
		const main = await api("git/ref/heads/main");

		if (!SHA.test(main.object?.sha ?? ""))
			throw new Error("PR base is not the current trusted main commit");
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`sha=${result.sha}\nbase=${main.object.sha}\n`,
		);
	}
}

async function resolve() {
	const result = await target();

	if (!result) return;
	const { sha, pr, validationWorkflow, publisherWorkflow } = result;
	const base = (await api("git/ref/heads/main")).object?.sha;
	let { receipt } = result;
	assertTarget(process.env.EXPECTED_SHA, sha);

	if (
		!SHA.test(process.env.EXPECTED_BASE ?? "") ||
		base !== process.env.EXPECTED_BASE
	)
		throw new Error("Trusted base changed after resolution");
	await status(sha, "pending");

	if (!receipt) {
		const runs = await api(
			`actions/workflows/${publisherWorkflow.id}/runs?event=workflow_run&status=success&per_page=100`,
		);

		for (const run of runs.workflow_runs) {
			if (!authenticRun(run, publisherWorkflow, repository, "publisher"))
				continue;
			const value = await marker(run, "preview-receipt", "receipt.json");

			if (value?.sha === sha && value.pr === String(pr.number)) {
				receipt = value;
				break;
			}
		}
	}

	const authority = await latestValidation(sha, validationWorkflow);
	const validation = authority?.conclusion;

	writeFileSync(
		"validation-state.json",
		JSON.stringify({
			sha,
			pr: pr.number,
			base,
			validation,
			receipt,
			sourceEvent: authority?.event,
			authority,
		}),
	);
	appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
}

const paths = [
	"scripts/og-video",
	"src/styles/global.css",
	"src/assets",
	"src/data/og-media.json",
	"src/lib/og-media.ts",
	"public/fonts",
	"public/music",
	"public/og",
	"package.json",
	"pnpm-lock.yaml",
	"docs/asset-reviews/link-previews.md",
	".github/workflows/link-previews.yml",
];

function tree(cwd, selected) {
	return execFileSync(
		"git",
		["ls-tree", "-r", "-z", "HEAD", "--", ...selected],
		{ cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
	);
}

export const VALIDATION_COMMANDS = [
	"test",
	"lint",
	"format:check",
	"check",
	"verify:dafny",
	"verify:quint:all",
	"build",
	"navigation:generate",
	"assets:check",
	"copy:check",
	"design:check",
	"publicist:gate",
];

export function assertValidationScripts(trusted, candidate) {
	for (const key of VALIDATION_COMMANDS.flatMap((name) => [
		name,
		`pre${name}`,
		`post${name}`,
	])) {
		if (trusted[key] !== candidate[key])
			throw new Error(`Candidate validation command differs: ${key}`);
	}
}

export function validMergeEvidence(target, sha, base, commit) {
	return (
		target?.sha === sha &&
		target?.base === base &&
		SHA.test(target?.merge ?? "") &&
		commit?.sha === target.merge &&
		commit.parents?.length === 2 &&
		commit.parents[0].sha === base &&
		commit.parents[1].sha === sha
	);
}

async function verify() {
	const state = JSON.parse(readFileSync("validation-state.json", "utf8"));

	const trustedBase = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();

	if (trustedBase !== state.base)
		throw new Error("Trusted checkout does not match current PR base");

	// PR-controlled workflow edits cannot certify their own checks. A trusted main dispatch is required.
	if (
		state.sourceEvent === "pull_request" &&
		tree(".", [
			".github/workflows/validate.yml",
			"scripts/og-video/validation-target.mjs",
		]) !==
			tree("candidate", [
				".github/workflows/validate.yml",
				"scripts/og-video/validation-target.mjs",
			])
	)
		throw new Error("Candidate validation workflow differs from trusted main");
	const changed = tree(".", paths) !== tree("candidate", paths);
	const verdict = decision({ ...state, changed });

	if (verdict !== "ready") {
		await status(state.sha, verdict);

		return;
	}

	const target = state.authority?.target;

	if (
		!SHA.test(target?.merge ?? "") ||
		!validMergeEvidence(
			target,
			state.sha,
			state.base,
			await api(`git/commits/${target.merge}`),
		)
	)
		throw new Error(
			"Validation did not test the exact head merged with the current base",
		);

	const scriptsAt = (cwd) =>
		JSON.parse(
			execFileSync("git", ["show", "HEAD:package.json"], {
				cwd,
				encoding: "utf8",
				maxBuffer: 2 * 1024 * 1024,
			}),
		).scripts;

	const trusted = scriptsAt(".");
	const candidate = scriptsAt("candidate");

	assertValidationScripts(trusted, candidate);

	if (changed) {
		await verifyEvidence(state.receipt, api);

		const check = await api("check-runs", {
			name: "Trusted preview evidence",
			head_sha: state.sha,
			status: "completed",
			conclusion: "neutral",
			completed_at: new Date().toISOString(),
			details_url: `https://github.com/${repository}/tree/${state.receipt.screenshotsCommit}/${state.receipt.dir}`,
			output: {
				title: "Immutable review sheets",
				summary: evidenceSummary(state.receipt, repository),
			},
		});

		if (!check.html_url?.startsWith(`https://github.com/${repository}/`))
			throw new Error("Invalid canonical check URL");
		state.evidenceUrl = check.html_url;
		writeFileSync("validation-state.json", JSON.stringify(state));
	}

	appendFileSync(process.env.GITHUB_OUTPUT, "ready=true\n");
}

async function finish() {
	const state = JSON.parse(readFileSync("validation-state.json", "utf8"));
	const pr = await api(`pulls/${state.pr}`);

	if (
		!eligiblePull(pr, state.sha, repository) ||
		(await api("git/ref/heads/main")).object?.sha !== state.base
	)
		throw new Error("Pull request head or base moved");
	const workflow = await api("actions/workflows/validate.yml");
	const latest = await latestValidation(state.sha, workflow);

	if (
		!sameAuthority(state.authority, latest) ||
		latest?.conclusion !== "success"
	) {
		await status(
			state.sha,
			latest?.conclusion && latest.conclusion !== "success"
				? "failure"
				: "pending",
		);

		return;
	}

	await status(
		state.sha,
		process.env.GATE_RESULT === "success" ? "success" : "failure",
		state.evidenceUrl,
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "discover") await discover();
	else if (process.argv[2] === "resolve") await resolve();
	else if (process.argv[2] === "verify") await verify();
	else if (process.argv[2] === "finish") await finish();
	else throw new Error("Unknown finalizer operation");
}
