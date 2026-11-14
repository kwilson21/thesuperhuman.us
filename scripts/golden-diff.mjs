// Reviews a golden fixture without a diff of the compressed file (GitHub cannot show one).
//
//   pnpm run golden:diff <fixture> [<from> [<to>]]   differing cases of a fixture between two git revisions
//   pnpm run golden:show <fixture> [<case>]          the cases of a fixture on disk, or one case in full
//
// <fixture> is a name such as `contact` (tests/golden/fixtures/contact.json.gz). <from> defaults to HEAD and <to> to the
// working tree; a revision is anything `git show` accepts (a branch, a commit, origin/main). A fixture that did not
// exist at a revision reads as no cases.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIRECTORY = "tests/golden/fixtures";
const LIMIT = 200;

function pathOf(fixture) {
	return `${DIRECTORY}/${fixture.replace(/\.json(\.gz)?$/, "")}.json.gz`;
}

function parse(buffer) {
	return buffer ? JSON.parse(gunzipSync(buffer).toString("utf8")) : [];
}

export function fromDisk(fixture) {
	const path = join(process.cwd(), pathOf(fixture));

	return parse(existsSync(path) ? readFileSync(path) : undefined);
}

function git(args, cwd) {
	return execFileSync("git", args, {
		cwd,
		maxBuffer: 1 << 30,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** The bytes of `path` at `revision`, or undefined when that revision is valid and has no such path. */
function gitShow(revision, path, cwd) {
	try {
		git(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], cwd);
	} catch {
		throw new Error(
			`golden:diff: "${revision}" is not a revision git can find.`,
		);
	}

	try {
		git(["cat-file", "-e", `${revision}:${path}`], cwd);
	} catch {
		return undefined;
	}

	return git(["show", `${revision}:${path}`], cwd);
}

function parseAt(revision, path, buffer, compressed) {
	try {
		return JSON.parse(
			(compressed ? gunzipSync(buffer) : buffer).toString("utf8"),
		);
	} catch (error) {
		throw new Error(
			`golden:diff: ${path} at ${revision} cannot be read (${error.message}).`,
		);
	}
}

/**
 * The cases of a fixture at a git revision. Three older fixtures were plain `.json` before the corpus was compressed, so
 * when the `.json.gz` does not exist at the revision the `.json` of the same name is read instead. A path that does not
 * exist at a valid revision reads as no cases; a revision git cannot find, or a fixture that cannot be read, throws.
 */
export function fromRevision(fixture, revision, cwd = process.cwd()) {
	const path = pathOf(fixture);
	const packed = gitShow(revision, path, cwd);

	if (packed) return parseAt(revision, path, packed, true);

	const plainPath = path.replace(/\.gz$/, "");
	const plain = gitShow(revision, plainPath, cwd);

	return plain ? parseAt(revision, plainPath, plain, false) : [];
}

function show(value) {
	const text = JSON.stringify(value);

	return text === undefined
		? "(absent)"
		: text.length > LIMIT
			? `${text.slice(0, LIMIT)}... (${text.length} characters)`
			: text;
}

/** Every path at which `a` and `b` differ, with the two values there. */
export function differences(a, b, path = "") {
	if (
		a === null ||
		b === null ||
		typeof a !== "object" ||
		typeof b !== "object" ||
		Array.isArray(a) !== Array.isArray(b)
	) {
		return Object.is(a, b) ? [] : [{ path, expected: a, actual: b }];
	}

	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];

	return keys.flatMap((key) =>
		differences(
			a[key],
			b[key],
			`${path}${Array.isArray(a) ? `[${key}]` : `.${key}`}`,
		),
	);
}

function diff(fixture, from, to) {
	const before = fromRevision(fixture, from);
	const after = to ? fromRevision(fixture, to) : fromDisk(fixture);
	const names = [...new Set([...before, ...after].map((entry) => entry.name))];
	let changed = 0;

	for (const name of names) {
		const old = before.find((entry) => entry.name === name);
		const next = after.find((entry) => entry.name === name);

		if (!old || !next) {
			console.log(`${old ? "removed" : "added"} case: ${name}`);
			changed += 1;
			continue;
		}

		const found = differences(old, next);

		if (found.length === 0) continue;

		changed += 1;
		console.log(`case: ${name} (${found.length} differences)`);

		for (const { path, expected, actual } of found.slice(0, 20)) {
			console.log(
				`  ${path || "(root)"}\n    -  ${show(expected)}\n    +  ${show(actual)}`,
			);
		}

		if (found.length > 20) console.log(`  ... ${found.length - 20} more`);
	}

	const order = (list) => list.map((entry) => entry.name).join("\n");

	if (changed === 0 && order(before) !== order(after)) {
		console.log("same cases, in a different order");
		changed = 1;
	}

	console.log(
		changed === 0
			? `${fixture}: no difference (${after.length} cases)`
			: `${fixture}: ${changed} of ${names.length} cases differ`,
	);
}

function showCases(fixture, name) {
	const cases = fromDisk(fixture);

	if (name === undefined) {
		cases.forEach((entry, index) => console.log(`${index + 1}\t${entry.name}`));

		return;
	}

	const found = cases.find((entry) => entry.name === name);

	if (!found) throw new Error(`no case named "${name}" in ${fixture}`);

	console.log(JSON.stringify(found, null, "\t"));
}

function main([mode, fixture, ...rest]) {
	if (!fixture) {
		console.error(
			"usage: golden-diff.mjs diff <fixture> [<from> [<to>]] | show <fixture> [<case>]",
		);
		process.exit(2);
	}

	try {
		if (mode === "diff") diff(fixture, rest[0] ?? "HEAD", rest[1]);
		else if (mode === "show") showCases(fixture, rest[0]);
		else throw new Error(`unknown mode "${mode}"`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	main(process.argv.slice(2));
