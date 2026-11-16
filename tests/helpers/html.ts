import type { DefaultTreeAdapterMap } from "parse5";

// Typed walks of a parse5 tree for tests that read rendered HTML.

/** Any node of a parse5 tree. */
export type HtmlNode = DefaultTreeAdapterMap["node"];

/** An element of a parse5 tree. */
export type HtmlElement = DefaultTreeAdapterMap["element"];

/** True for an element, the only node with a tag name and attributes. */
export function isElement(node: HtmlNode): node is HtmlElement {
	return "tagName" in node;
}

/** The children of a node; a text or comment node has none. */
export function childrenOf(node: HtmlNode): HtmlNode[] {
	return "childNodes" in node ? node.childNodes : [];
}

/** The value of an attribute of an element, or undefined when it has none or the node is not an element. */
export function attrOf(node: HtmlNode, name: string): string | undefined {
	return isElement(node)
		? node.attrs.find((attr) => attr.name === name)?.value
		: undefined;
}

/** True when the node is an element that has the attribute, whatever its value. */
export function hasAttr(node: HtmlNode, name: string): boolean {
	return isElement(node) && node.attrs.some((attr) => attr.name === name);
}

/** The text of a node and its descendants. */
export function textOf(node: HtmlNode): string {
	return node.nodeName === "#text" && "value" in node
		? node.value
		: childrenOf(node).map(textOf).join("");
}

/** The first element, in document order, for which `test` is true, or undefined. */
export function findElement(
	node: HtmlNode,
	test: (element: HtmlElement) => boolean,
): HtmlElement | undefined {
	if (isElement(node) && test(node)) return node;

	for (const child of childrenOf(node)) {
		const found = findElement(child, test);

		if (found) return found;
	}

	return undefined;
}

/** The first element that has the attribute; a page without one fails the test. */
export function elementWithAttr(node: HtmlNode, name: string): HtmlElement {
	const found = findElement(node, (element) => hasAttr(element, name));

	if (!found) throw new Error(`No element has the ${name} attribute.`);

	return found;
}

/** Every element, in document order, for which `test` is true. */
export function findElements(
	node: HtmlNode,
	test: (element: HtmlElement) => boolean,
): HtmlElement[] {
	return [
		...(isElement(node) && test(node) ? [node] : []),
		...childrenOf(node).flatMap((child) => findElements(child, test)),
	];
}
