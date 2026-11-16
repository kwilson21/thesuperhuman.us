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
	const root = element();
	let footerTop = 1000;
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
		if (selector === "[data-pinned-contact]")
			return missing === "pinned" ? null : pinnedNode;

		if (selector === "footer [data-closing-button]")
			return missing === "footer" ? null : footerNode;

		return null;
	});

	type FakeDocument = {
		querySelector: typeof documentQuery;
		documentElement: typeof root;
		activeElement: typeof link | typeof footerNode | null;
	};

	const fakeDocument: FakeDocument = {
		querySelector: documentQuery,
		documentElement: root,
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
		footer,
		root,
		media,
		viewport,
		events,
		frames,
		resizeObservers,
		documentQuery,
		setRendered: (value: boolean) => {
			rendered = value;
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

it("keeps one interactive mobile action and preserves the footer as its layout target", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	expect(p.pinned.hasAttribute("hidden")).toBe(false);
	expect(p.pinned.hasAttribute("inert")).toBe(false);
	expect(p.footer.hasAttribute("data-contact-proxy")).toBe(true);
	expect(p.footer.hasAttribute("inert")).toBe(true);
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("0px");
	expect(p.pinned.hasAttribute("data-docked")).toBe(false);
});

it("docks continuously and reverses at the same position without accumulating transforms", () => {
	const p = page();
	setupPinnedContact();
	p.flush();

	for (const [top, offset] of [
		[800, 0],
		[776, 0],
		[760, -16],
		[600, -176],
		[760, -16],
		[776, 0],
		[800, 0],
	]) {
		p.setFooterTop(top);
		p.events.fire("scroll");
		p.flush();
		expect(p.pinned.properties.get("--contact-dock-offset")).toBe(
			`${offset}px`,
		);
		expect(p.pinned.hasAttribute("data-docked")).toBe(offset < 0);
		expect(p.pinned.hasAttribute("inert")).toBe(false);
		expect(p.footer.hasAttribute("inert")).toBe(true);
	}
});

it("lands correctly when opening at an already-scrolled footer", () => {
	const p = page();
	p.setFooterTop(550);
	setupPinnedContact();
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-226px");
	expect(p.pinned.hasAttribute("data-docked")).toBe(true);
});

it("restores the original footer link on desktop and resumes docking on mobile", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setFooterTop(600);
	p.events.fire("scroll");
	p.flush();
	p.media.matches = false;
	p.media.fire("change");
	p.flush();
	expect(p.footer.hasAttribute("data-contact-proxy")).toBe(false);
	expect(p.footer.hasAttribute("inert")).toBe(false);
	expect(p.pinned.hasAttribute("inert")).toBe(true);
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("0px");
	p.media.matches = true;
	p.media.fire("change");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-176px");
	expect(p.footer.hasAttribute("inert")).toBe(true);
	expect(p.pinned.hasAttribute("inert")).toBe(false);
});

it("coalesces scroll and resize events into a single frame", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.events.fire("scroll");
	p.events.fire("scroll");
	p.events.fire("resize");
	p.viewport.fire("resize");
	expect(p.frames).toHaveLength(1);
	p.flush();
	expect(p.frames).toHaveLength(0);
});

it("recalculates docking for restored pages, viewport changes and page reflow", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setFooterTop(700);
	p.events.fire("pageshow");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-76px");
	p.setFixedTop(720);
	p.viewport.fire("resize");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-20px");
	expect(p.resizeObservers[0].targets).toContain(p.root);
	p.setFooterTop(650);
	p.resizeObservers[0].callback();
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-70px");
});

it.each(["pinned", "footer", "link"])(
	"leaves the fallback alone when %s is absent",
	(missing) => {
		const p = page({ missing });
		setupPinnedContact();
		p.flush();
		expect(p.pinned.hasAttribute("hidden")).toBe(true);
		expect(p.footer.hasAttribute("inert")).toBe(false);
	},
);

it("keeps the no-animation-frame fallback unchanged", () => {
	const p = page();
	vi.stubGlobal("requestAnimationFrame", undefined);
	setupPinnedContact();
	expect(p.pinned.hasAttribute("hidden")).toBe(true);
	expect(p.footer.hasAttribute("inert")).toBe(false);
});

it("does not require ResizeObserver or a visual viewport", () => {
	const p = page({ viewportAvailable: false });
	vi.stubGlobal("ResizeObserver", undefined);
	setupPinnedContact();
	p.flush();
	p.setFooterTop(700);
	p.events.fire("scroll");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-76px");
});

it("ignores suppressed mobile geometry and recovers after focus leaves a field", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setFooterTop(600);
	p.events.fire("scroll");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-176px");
	p.setRendered(false);
	p.setFooterTop(500);
	p.events.fire("focusin");
	p.events.fire("scroll");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-176px");
	p.setRendered(true);
	p.events.fire("focusout");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-276px");
});

it("updates the dock after closing a menu that hid the proxy during scrolling", () => {
	const p = page();
	setupPinnedContact();
	p.flush();
	p.setRendered(false);
	p.setFooterTop(600);
	p.events.fire("scroll");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("0px");
	p.setRendered(true);
	p.events.fire("toggle");
	p.flush();
	expect(p.pinned.properties.get("--contact-dock-offset")).toBe("-176px");
});

it("brings an offscreen focused docked action into view without smooth motion", () => {
	const p = page();
	p.setFooterTop(-100);
	setupPinnedContact();
	p.flush();
	p.focusLink();
	p.events.fire("focusin");
	expect(p.footerNode.scrollIntoView).toHaveBeenCalledWith({
		block: "center",
		behavior: "instant",
	});
	p.flush();
	p.footerNode.scrollIntoView.mockClear();
	p.setFooterTop(600);
	p.events.fire("scroll");
	p.flush();
	p.events.fire("focusin");
	expect(p.footerNode.scrollIntoView).not.toHaveBeenCalled();
});

it("preserves focus across responsive ownership changes", () => {
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
