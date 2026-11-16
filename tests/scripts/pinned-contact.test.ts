import { afterEach, expect, it, vi } from "vitest";
import {
	STEP_ASIDE_FOR,
	setupPinnedContact,
} from "../../src/scripts/pinned-contact";

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

// What it steps aside for: the closing panel, a page invitation marked data-pinned-end and the page's
// filled buttons, in page order.
const stubPage = (
	elements: Record<string, FakeElement>,
	ends: FakeElement[] = elements[".closing-panel"]
		? [elements[".closing-panel"]]
		: [],
) => {
	vi.stubGlobal("document", {
		querySelector: (selector: string) => elements[selector] ?? null,
		querySelectorAll: (selector: string) =>
			selector === STEP_ASIDE_FOR ? ends : [],
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
	// Aside until the first report, then shown once the report says nothing is on screen.
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: false, target: panel }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(false);
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

// The pinned button and the closing panel sit outside <main>, so the last selector reaches only the
// page's own filled buttons. A browser check of Home, the 404 and Audio confirms it on the real pages.
it("steps aside for the closing panel, page invitations and the page's filled buttons", () => {
	expect(STEP_ASIDE_FOR.split(", ")).toEqual([
		".closing-panel",
		"[data-pinned-end]",
		"main .site-button:not(.site-button-outline)",
	]);
});

it("does not show over a button already on screen when the page opens", () => {
	const pinned = element({ hidden: "" });
	const button = element();
	stubPage({ "[data-pinned-contact]": pinned }, [button]);
	const observers = stubObserver();
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(false);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: true, target: button }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: false, target: button }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(false);
});

it("stays hidden when there is no closing panel, page invitation or filled button", () => {
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
