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

const SHA = /^[0-9a-f]{40}$/;

export function authenticRun(run, workflow, repository, kind) {
	return (
		run.workflow_id === workflow.id &&
		run.path === workflow.path &&
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

async function status(sha, state) {
	if (!SHA.test(sha)) throw new Error("Invalid status head");
	await api(`statuses/${sha}`, {
		state,
		context: "validate",
		description: "Trusted tests, preview review and private approvals",
		target_url: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
	});
}

async function resolve() {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const source = await api(`actions/runs/${event.workflow_run.id}`);
	const validationWorkflow = await api("actions/workflows/validate.yml");

	const publisherWorkflow = await api(
		"actions/workflows/link-previews-publish.yml",
	);

	let sha;
	let validation;
	let receipt;

	if (authenticRun(source, validationWorkflow, repository, "validation")) {
		if (source.event === "pull_request") sha = source.head_sha;
		else sha = (await marker(source, "validation-target", "result.json"))?.sha;
		validation = source.conclusion;
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
	const pr = pulls[0];
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

	if (validation === undefined) {
		const runs = await api(
			`actions/workflows/${validationWorkflow.id}/runs?event=workflow_dispatch&branch=main&per_page=100`,
		);

		for (const run of runs.workflow_runs) {
			if (!authenticRun(run, validationWorkflow, repository, "validation"))
				continue;
			const value = await marker(run, "validation-target", "result.json");

			if (value?.sha === sha) {
				validation = run.conclusion;
				break;
			}
		}
	}

	writeFileSync(
		"validation-state.json",
		JSON.stringify({
			sha,
			pr: pr.number,
			base: pr.base.sha,
			validation,
			receipt,
			sourceEvent: source.event,
		}),
	);
	appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
}

const paths = [
	"scripts/og-video",
	"src/styles/global.css",
	"src/assets",
	"src/data/og-media.json",
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
		tree(".", [".github/workflows/validate.yml"]) !==
			tree("candidate", [".github/workflows/validate.yml"])
	)
		throw new Error("Candidate validation workflow differs from trusted main");
	const changed = tree(".", paths) !== tree("candidate", paths);
	const verdict = decision({ ...state, changed });

	if (verdict !== "ready") {
		await status(state.sha, verdict);

		return;
	}

	execFileSync(
		process.execPath,
		["scripts/og-video/publicist-inputs.mjs", "candidate"],
		{ stdio: "inherit" },
	);
	const trusted = JSON.parse(readFileSync("package.json", "utf8")).scripts;

	const candidate = JSON.parse(
		readFileSync("candidate/package.json", "utf8"),
	).scripts;

	for (const key of [
		"build",
		"prebuild",
		"postbuild",
		"navigation:generate",
		"assets:check",
		"copy:check",
		"design:check",
		"publicist:gate",
	]) {
		if (trusted[key] !== candidate[key])
			throw new Error(`Candidate build command differs: ${key}`);
	}

	appendFileSync(process.env.GITHUB_OUTPUT, "ready=true\n");
}

async function finish() {
	const state = JSON.parse(readFileSync("validation-state.json", "utf8"));
	const pr = await api(`pulls/${state.pr}`);

	if (!eligiblePull(pr, state.sha, repository) || pr.base.sha !== state.base)
		throw new Error("Pull request head or base moved");
	await status(
		state.sha,
		process.env.GATE_RESULT === "success" ? "success" : "failure",
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "resolve") await resolve();
	else if (process.argv[2] === "verify") await verify();
	else if (process.argv[2] === "finish") await finish();
	else throw new Error("Unknown finalizer operation");
}
