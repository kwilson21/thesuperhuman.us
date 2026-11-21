// Isolated read-only target resolution. Finalizer pins this helper to main before
// accepting pull-request evidence; main-dispatched validation runs trusted code.
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;

export function mergedTarget(pr, commit, sha, repository, base = pr.base.sha) {
	if (
		!SHA.test(sha) ||
		pr.state !== "open" ||
		pr.head.sha !== sha ||
		pr.head.repo.full_name !== repository ||
		pr.base.repo.full_name !== repository ||
		pr.base.ref !== "main" ||
		!SHA.test(base) ||
		!SHA.test(pr.merge_commit_sha) ||
		commit.sha !== pr.merge_commit_sha ||
		commit.parents?.length !== 2 ||
		commit.parents[0].sha !== base ||
		commit.parents[1].sha !== sha
	)
		throw new Error(
			"No exact head/base merge is available; rerun after GitHub prepares it",
		);

	return { sha, base, merge: commit.sha, pr: String(pr.number) };
}

// GitHub's PR base.sha can lag the branch ref. Authenticate both merge parents
// against the live main ref, and retry only the bounded merge-preparation race.
export async function resolveMerge(
	api,
	number,
	sha,
	repository,
	pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const pr = await api(`pulls/${number}`);
		const base = (await api("git/ref/heads/main")).object?.sha;

		if (pr.state !== "open" || pr.head.sha !== sha)
			throw new Error("Validation target moved or closed");

		if (SHA.test(pr.merge_commit_sha ?? "") && SHA.test(base ?? "")) {
			const commit = await api(`git/commits/${pr.merge_commit_sha}`);

			try {
				const target = mergedTarget(pr, commit, sha, repository, base);

				if ((await api("git/ref/heads/main")).object?.sha === base)
					return target;
			} catch {
				// Never fall back to validating the raw head or a stale base.
			}
		}

		if (attempt < 5) await pause(2000);
	}

	throw new Error("No exact head/base merge is available after bounded retry");
}

async function main() {
	const repository = process.env.GITHUB_REPOSITORY;

	const api = async (path) => {
		const response = await fetch(
			`https://api.github.com/repos/${repository}/${path}`,
			{
				headers: {
					authorization: `Bearer ${process.env.GH_TOKEN}`,
					accept: "application/vnd.github+json",
				},
			},
		);

		if (!response.ok) throw new Error(`GitHub ${response.status}`);

		return response.json();
	};

	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));

	const sha =
		process.env.REVISION ||
		event.pull_request?.head.sha ||
		process.env.GITHUB_SHA;

	if (!SHA.test(sha)) throw new Error("Invalid validation target");
	let target;

	if (process.env.GITHUB_EVENT_NAME === "push")
		target = { sha, base: sha, merge: sha };
	else {
		const pulls = (await api(`commits/${sha}/pulls?per_page=100`)).filter(
			(p) =>
				p.state === "open" &&
				p.head.sha === sha &&
				p.base.ref === "main" &&
				p.head.repo.full_name === repository,
		);

		if (pulls.length !== 1) throw new Error("Ambiguous validation PR");
		target = await resolveMerge(api, pulls[0].number, sha, repository);
	}

	mkdirSync("result", { recursive: true });
	writeFileSync(
		"result/result.json",
		JSON.stringify({
			...target,
			run: process.env.GITHUB_RUN_ID,
			attempt: process.env.GITHUB_RUN_ATTEMPT,
		}),
	);
	appendFileSync(process.env.GITHUB_OUTPUT, `merge=${target.merge}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
