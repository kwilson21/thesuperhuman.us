import { describe, expect, it } from "vitest";
import { specifiersOf } from "./import-graph";

describe("specifiersOf", () => {
	it.each([
		['import a from "./a.mjs";', ["./a.mjs"]],
		["import a from './a.mjs';", ["./a.mjs"]],
		['import { a, b } from "../lib/b.mjs";', ["../lib/b.mjs"]],
		['import * as c from "./sub/c.mjs";', ["./sub/c.mjs"]],
		['import "./side-effect.mjs";', ["./side-effect.mjs"]],
		['export { x } from "./x.mjs";', ["./x.mjs"]],
		['export * from "./y.mjs";', ["./y.mjs"]],
		['const m = await import("./d.mjs");', ["./d.mjs"]],
		["const m = await import('./e.mjs');", ["./e.mjs"]],
		['const r = require("./f.cjs");', ["./f.cjs"]],
		['import {\n\ta,\n\tb,\n} from\n\t"./multi.mjs";', ["./multi.mjs"]],
		['import { readFileSync } from "node:fs";', ["node:fs"]],
		["import a from `./tick.mjs`;", ["./tick.mjs"]],
	])("%s", (source, expected) => {
		expect(specifiersOf(source)).toEqual(expected);
	});

	it("reads several imports in one file and ignores a word that merely contains import", () => {
		const source =
			'import a from "./a.mjs";\nconst important = 1;\nimport("./b.mjs");';

		expect(specifiersOf(source).sort()).toEqual(["./a.mjs", "./b.mjs"]);
	});
});
