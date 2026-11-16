import { afterEach, expect, it, vi } from "vitest";
import { setupPinnedContact } from "../../src/scripts/pinned-contact";

afterEach(() => {
	vi.unstubAllGlobals();
});

const element = (initial: Record<string, string> = {}) => {
	const attributes = new Map(Object.entries(initial));
	const properties = new Map<string, string>();

	return {
		attributes,
		properties,
		hasAttribute: (name: string) => attributes.has(name),
		setAttribute: (name: string, value: string) => attributes.set(name, value),
		removeAttribute: (name: string) => attributes.delete(name),
		toggleAttribute: (name: string, on: boolean) =>
			on ? attributes.set(name, "") : attributes.delete(name),
		style: {
			setProperty: (name: string, value: string) => properties.set(name, value),
			removeProperty: (name: string) => properties.delete(name),
		},
	};
};

const eventTarget = () => {
	const listeners = new Map<string, (() => void)[]>();

	return {
		addEventListener: (name: string, callback: () => void) => {
			listeners.set(name, [...(listeners.get(name) ?? []), callback]);
		},
		fire: (name: string) => {
			for (const callback of listeners.get(name) ?? []) callback();
		},
	};
};

const page = ({
	mobile = true,
	missing = "",
	viewportAvailable = true,
} = {}) => {
	const pinned = element({ hidden: "" });
	const footer = element();
	const track = element();
	const root = element();
	const main = element();
	let footerTop = 1000;
	let bodyBottom = 1300;
	let fixedTop = 776;
	let rendered = true;
	const frames: FrameRequestCallback[] = [];

	const resizeObservers: {
		callback: () => void;
		targets: ReturnType<typeof element>[];
	}[] = [];

	const media = { ...eventTarget(), matches: mobile };
	const viewport = eventTarget();
	const events = eventTarget();

	const requestFrame = vi.fn((callback: FrameRequestCallback) => {
		frames.push(callback);

		return frames.length;
	});

	const link = {
		focus: vi.fn(),
		getBoundingClientRect: () => ({
			bottom:
				fixedTop +
				parseFloat(pinned.properties.get("--contact-dock-offset") ?? "0") +
				52,
			top:
				fixedTop +
				parseFloat(pinned.properties.get("--contact-dock-offset") ?? "0"),
		}),
	};

	const pinnedNode = {
		...pinned,
		getBoundingClientRect: () => ({
			top: fixedTop - 12,
			bottom: fixedTop + 68,
			height: 80,
		}),
		getClientRects: () => (rendered ? [{ top: fixedTop }] : []),
		querySelector: (selector: string) =>
			selector === "a" && missing !== "link" ? link : null,
	};

	const footerNode = {
		...footer,
		focus: vi.fn(),
		scrollIntoView: vi.fn(),
		getBoundingClientRect: () => ({ top: footerTop }),
	};

	const documentQuery = vi.fn((selector: string) => {
		if (selector === "main") return main;

		if (selector === "[data-contact-track]")
			return missing === "track" ? null : track;

		if (selector === "[data-pinned-contact]")
			return missing === "pinned" ? null : pinnedNode;

		if (selector === "footer [data-closing-button]")
			return missing === "footer" ? null : footerNode;

		return null;
	});

	type FakeDocument = {
		querySelector: typeof documentQuery;
		documentElement: typeof root;
		body: { getBoundingClientRect: () => { bottom: number } };
		activeElement: typeof link | typeof footerNode | null;
	};

	const fakeDocument: FakeDocument = {
		querySelector: documentQuery,
		documentElement: root,
		body: { getBoundingClientRect: () => ({ bottom: bodyBottom }) },
		activeElement: null,
	};

	vi.stubGlobal("document", fakeDocument);
	vi.stubGlobal("requestAnimationFrame", requestFrame);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => media),
	);
	vi.stubGlobal("window", {
		...events,
		innerHeight: 844,
		scrollY: 0,
		requestAnimationFrame: requestFrame,
		matchMedia: vi.fn(() => media),
		visualViewport: viewportAvailable ? viewport : undefined,
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			callback: () => void;
			targets: ReturnType<typeof element>[] = [];
			constructor(callback: () => void) {
				this.callback = callback;
				resizeObservers.push(this);
			}
			observe(target: ReturnType<typeof element>) {
				this.targets.push(target);
			}
		},
	);

	return {
		link,
		footerNode,
		focusLink: () => {
			fakeDocument.activeElement = link;
		},
		focusFooter: () => {
			fakeDocument.activeElement = footerNode;
		},
		pinned,
		track,
		footer,
		root,
		main,
		media,
		viewport,
		events,
		frames,
		resizeObservers,
		documentQuery,
		setRendered: (value: boolean) => {
			rendered = value;
		},
		setBodyBottom: (value: number) => {
			bodyBottom = value;
		},
		setFooterTop: (value: number) => {
			footerTop = value;
		},
		setFixedTop: (value: number) => {
			fixedTop = value;
		},
		flush: () => {
			const pending = frames.splice(0);

			for (const callback of pending) callback(0);
		},
	};
};

it("uses a layout track and keeps one interactive mobile action", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	expect(p.pinned.hasAttribute("hidden")).toBe(false);
	expect(p.footer.hasAttribute("inert")).toBe(true);
	expect(p.track.properties.get("--contact-track-bottom")).toBe("232px");
	expect(p.pinned.properties.get("--contact-height")).toBe("80px");
	expect(p.pinned.properties.has("--contact-dock-offset")).toBe(false);
});

it("fast scroll never writes positional styles or queues animation frames", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	const track = [...p.track.properties];
	const pinned = [...p.pinned.properties];

	for (const y of [760, 300, -100, 600, 900, 500, 1000]) {
		p.setFooterTop(y);
		p.events.fire("scroll");
		p.viewport.fire("scroll");
		expect(p.frames).toHaveLength(0);
		expect([...p.track.properties]).toEqual(track);
		expect([...p.pinned.properties]).toEqual(pinned);
	}
});

it("updates layout bounds after reflow and coalesces resize events", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setFooterTop(800);
	p.events.fire("resize");
	p.viewport.fire("resize");
	p.resizeObservers[0].callback();
	expect(p.frames).toHaveLength(1);
	p.flush();
	expect(p.track.properties.get("--contact-track-bottom")).toBe("432px");
	expect(p.resizeObservers[0].targets).toContain(p.root);
	expect(p.resizeObservers[0].targets).toContain(p.main);
});

it("restored scroll measures clearance relative to the body", () => {
	const p = page();
	p.setFooterTop(550);
	window.scrollY = 450;
	p.setBodyBottom(850);
	setupPinnedContact();
	p.flush();
	expect(p.track.properties.get("--contact-track-bottom")).toBe("232px");
});

it("restores footer ownership on desktop and resumes mobile", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.media.matches = false;
	p.media.fire("change");
	p.flush();
	expect(p.footer.hasAttribute("inert")).toBe(false);
	expect(p.pinned.hasAttribute("inert")).toBe(true);
	p.media.matches = true;
	p.media.fire("change");
	p.flush();
	expect(p.footer.hasAttribute("inert")).toBe(true);
	expect(p.pinned.hasAttribute("inert")).toBe(false);
});

it("recovers after menu or form suppression without measuring hidden geometry", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setRendered(false);
	p.setFooterTop(500);
	p.events.fire("focusin");
	p.flush();
	expect(p.track.properties.get("--contact-track-bottom")).toBe("232px");
	p.setRendered(true);
	p.events.fire("toggle");
	p.flush();
	expect(p.track.properties.get("--contact-track-bottom")).toBe("732px");
});

it.each(["pinned", "footer", "link", "track"])(
	"keeps fallback when %s absent",
	(missing) => {
		const p = page({ missing });
		setupPinnedContact();
		p.flush();
		expect(p.pinned.hasAttribute("hidden")).toBe(true);
		expect(p.footer.hasAttribute("inert")).toBe(false);
	},
);

it("supports missing observer and visual viewport", () => {
	const p = page({ viewportAvailable: false });
	vi.stubGlobal("ResizeObserver", undefined);
	setupPinnedContact();
	p.flush();
	expect(p.footer.hasAttribute("inert")).toBe(true);
});

it("preserves keyboard focus across responsive ownership changes", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.focusLink();
	p.media.matches = false;
	p.media.fire("change");
	p.flush();
	expect(p.footerNode.focus).toHaveBeenCalledWith({ preventScroll: true });
	p.focusFooter();
	p.media.matches = true;
	p.media.fire("change");
	p.flush();
	expect(p.link.focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("brings an offscreen focused link into view without smooth motion", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setFixedTop(-100);
	p.focusLink();
	p.events.fire("focusin");
	expect(p.footerNode.scrollIntoView).toHaveBeenCalledWith({
		block: "center",
		behavior: "instant",
	});
});

it("refreshes track bounds after cold fonts finish loading", async () => {
	const p = page();
	let loaded: () => void = () => {};

	Object.defineProperty(document, "fonts", {
		value: {
			ready: new Promise<void>((resolve) => {
				loaded = resolve;
			}),
		},
	});
	setupPinnedContact();
	p.flush();
	p.setFooterTop(700);
	loaded();
	await Promise.resolve();
	expect(p.frames).toHaveLength(1);
	p.flush();
	expect(p.track.properties.get("--contact-track-bottom")).toBe("532px");
});
