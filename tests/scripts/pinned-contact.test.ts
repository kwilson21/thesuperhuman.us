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

// Only the shared footer is an end marker. Other page buttons never hide the pinned CTA.
const stubPage = (
	elements: Record<string, FakeElement>,
	ends: FakeElement[] = elements[".compact-footer"]
		? [elements[".compact-footer"]]
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
	stubPage({ "[data-pinned-contact]": pinned, ".compact-footer": panel });
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

it("does not observe page invitations or filled buttons", () => {
	expect(STEP_ASIDE_FOR).toBe(".compact-footer");
	const pinned = element({ hidden: "" });
	const footer = element();
	stubPage({
		"[data-pinned-contact]": pinned,
		".compact-footer": footer,
		"[data-pinned-end]": element(),
		"main .site-button:not(.site-button-outline)": element(),
	});
	const observers = stubObserver();
	setupPinnedContact();
	expect(observers[0].observed).toEqual([footer]);
	observers[0].callback([{ isIntersecting: false, target: footer }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(false);
});

it("stays aside on a deep link or restored page already at the footer", () => {
	const pinned = element({ hidden: "" });
	const footer = element();
	stubPage({ "[data-pinned-contact]": pinned, ".compact-footer": footer });
	const observers = stubObserver();
	setupPinnedContact();
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
	observers[0].callback([{ isIntersecting: true, target: footer }]);
	expect(pinned.hasAttribute("data-at-end")).toBe(true);
});

it("does nothing on a quiet contact or intake page without a pinned button", () => {
	stubPage({ ".compact-footer": element() });
	const observers = stubObserver();
	setupPinnedContact();
	expect(observers).toHaveLength(0);
});

it("stays hidden when there is no footer", () => {
	const pinned = element({ hidden: "" });
	stubPage({ "[data-pinned-contact]": pinned });
	const observers = stubObserver();
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(true);
	expect(observers).toHaveLength(0);
});

it("stays hidden when IntersectionObserver is not available", () => {
	const pinned = element({ hidden: "" });
	stubPage({ "[data-pinned-contact]": pinned, ".compact-footer": element() });
	vi.stubGlobal("IntersectionObserver", undefined);
	setupPinnedContact();
	expect(pinned.hasAttribute("hidden")).toBe(true);
});
