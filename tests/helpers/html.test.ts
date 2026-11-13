import { parse, serialize } from "parse5";
import { describe, expect, it } from "vitest";
import {
	attrOf,
	childrenOf,
	elementWithAttr,
	findElement,
	findElements,
	hasAttr,
	isElement,
	textOf,
} from "./html";

const dom = parse(
	'<ol data-steps class="a"><li data-n="1">One</li><li data-n="2" hidden>Two <b>bold</b></li></ol>',
);

describe("html helpers", () => {
	it("isElement is true for elements and false for text", () => {
		const list = elementWithAttr(dom, "data-steps");

		expect(isElement(list)).toBe(true);
		expect(list.tagName).toBe("ol");

		const [first] = childrenOf(list);
		const [text] = first ? childrenOf(first) : [];

		expect(text && isElement(text)).toBe(false);
	});

	it("attrOf and hasAttr read attributes of elements only", () => {
		const list = elementWithAttr(dom, "data-steps");

		expect(attrOf(list, "class")).toBe("a");
		expect(attrOf(list, "missing")).toBeUndefined();
		expect(hasAttr(list, "data-steps")).toBe(true);
		expect(hasAttr(list, "missing")).toBe(false);
		expect(hasAttr(dom, "data-steps")).toBe(false);
	});

	it("textOf joins the text of a node and its descendants", () => {
		expect(textOf(elementWithAttr(dom, "data-steps"))).toBe("OneTwo bold");
	});

	it("findElement and findElements walk in document order", () => {
		expect(
			findElement(dom, (element) => element.tagName === "li")?.attrs[0]?.value,
		).toBe("1");
		expect(
			findElements(dom, (element) => element.tagName === "li").map((element) =>
				attrOf(element, "data-n"),
			),
		).toEqual(["1", "2"]);
		expect(findElement(dom, (element) => element.tagName === "h1")).toBe(
			undefined,
		);
	});

	it("elementWithAttr throws when no element has the attribute", () => {
		expect(() => elementWithAttr(dom, "data-nothing")).toThrow(
			"No element has the data-nothing attribute.",
		);
		expect(serialize(elementWithAttr(dom, "hidden"))).toContain("Two");
	});
});
