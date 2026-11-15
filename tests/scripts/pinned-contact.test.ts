import { afterEach, expect, it, vi } from "vitest";
import { setupPinnedContact } from "../../src/scripts/pinned-contact";

afterEach(() => {
	vi.unstubAllGlobals();
});

type ObserverCallback = (
	entries: { isIntersecting: boolean; target: FakeElement }[],
) => void;

// A plain element with attributes, enough for the script's hidden and data-at-end handling.
const element = (initial: Record<string, string> = {}) => {
	const attributes = new Map(Object.entries(initial));

	return {
		attributes,
		hasAttribute: (name: string) => attributes.has(name),
		setAttribute: (name: string, value: string) => {
			attributes.set(name, value);
		},
		removeAttribute: (name: string) => {
			attributes.delete(name);
		},
	};
};

type FakeElement = ReturnType<typeof element>;

// The ends: the closing panel and any page invitation marked data-pinned-end, in page order.
const stubPage = (
	elements: Record<string, FakeElement>,
	ends: FakeElement[] = elements[".closing-panel"]
		? [elements[".closing-panel"]]
		: [],
) => {
	vi.stubGlobal("document", {
		querySelector: (selector: string) => elements[selector] ?? null,
		querySelectorAll: (selector: string) =>
			selector === ".closing-panel, [data-pinned-end]" ? ends : [],
	});
};

const stubObserver = () => {
	const observers: FakeObserver[] = [];

	class FakeObserver {
		callback: ObserverCallback;
		observed: FakeElement[] = [];
		constructor(callback: ObserverCallback) {
			this.callback = callback;
			observers.push(this);
		}
		observe(target: FakeElement) {
			this.observed.push(target);
		}
	}

	vi.stubGlobal("IntersectionObserver", FakeObserver);

	return observers;
};

it("shows the pinned button and marks it at the end while the closing panel is on screen", () => {
	const pinned = element({ hidden: "" });
	const panel = element();
	stubPage({ "[data-pinned-contact]": pinned, ".closing-panel": panel });
	const observers = stubObserver();
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(false);
	expect(observers).toHaveLength(1);
	expect(observers[0].observed).toEqual([panel]);
	observers[0].callback([{ isIntersecting: true, target: panel }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: false, target: panel }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(false);
});

it("also steps aside for a page’s own invitation, until neither end is on screen", () => {
	const pinned = element({ hidden: "" });
	const invitation = element();
	const panel = element();
	stubPage({ "[data-pinned-contact]": pinned, ".closing-panel": panel }, [
		invitation,
		panel,
	]);
	const observers = stubObserver();
	setupPinnedContact();
	expect(observers[0].observed).toEqual([invitation, panel]);
	observers[0].callback([{ isIntersecting: true, target: invitation }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: true, target: panel }]);
	observers[0].callback([{ isIntersecting: false, target: invitation }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: false, target: panel }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(false);
});

it("stays hidden when there is no closing panel or page invitation", () => {
	const pinned = element({ hidden: "" });
	stubPage({ "[data-pinned-contact]": pinned });
	const observers = stubObserver();
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(true);
	expect(observers).toHaveLength(0);
});

it("stays hidden when IntersectionObserver is not available", () => {
	const pinned = element({ hidden: "" });
	stubPage({ "[data-pinned-contact]": pinned, ".closing-panel": element() });
	vi.stubGlobal("IntersectionObserver", undefined);
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(true);
});
