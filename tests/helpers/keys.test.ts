import { expect, it } from "vitest";
import { keysOf } from "./keys";

it("keysOf lists the own keys of an object literal in order", () => {
	const scenes = { home: 1, work: 2 };

	expect(keysOf(scenes)).toEqual(["home", "work"]);
});
