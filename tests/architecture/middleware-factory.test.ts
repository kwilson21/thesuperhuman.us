import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// `createOnRequest` builds a middleware around an owner check it is given. Only `src/middleware.ts` calls it, with the
// Cloudflare Access check; any other file under src/ that names it could build a middleware with a permissive check.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

it("names createOnRequest only in src/middleware.ts", () => {
	const files = execFileSync("git", ["ls-files", "-z", "src"], {
		cwd: repository,
		encoding: "utf8",
	})
		.split("\0")
		.filter(Boolean);

	expect(files).toContain("src/middleware.ts");

	const naming = files.filter((file) =>
		readFileSync(join(repository, file), "utf8").includes("createOnRequest"),
	);

	expect(naming).toEqual(["src/middleware.ts"]);

	expect(readFileSync(join(repository, "src/middleware.ts"), "utf8")).toContain(
		"export const onRequest = createOnRequest(verifyOwnerAccess);",
	);
});
