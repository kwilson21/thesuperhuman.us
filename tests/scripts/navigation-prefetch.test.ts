import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupPrefetchTrial } from "~/scripts/navigation-prefetch";

const callbacks: Array<() => void> = [];
const unregister = vi.fn();

const loadManager = vi.fn(async () => ({
	register: ({ callback }: { callback: () => void }) => {
		callbacks.push(callback);

		return { unregister };
	},
}));

function node(href = "") {
	const events: Record<string, () => void> = {};
	const dataset: Record<string, string> = {};

	return {
		href,
		rendered: true,
		getBoundingClientRect() {
			return { width: this.rendered ? 40 : 0, height: this.rendered ? 40 : 0 };
		},
		checkVisibility() {
			return this.rendered;
		},
		hidden: true,
		textContent: "",
		isConnected: true,
		download: "",
		target: "",
		dataset,
		closest: () => null,
		hasAttribute(name: string) {
			return name === "download" && this.download !== "";
		},
		removeEventListener: (name: string) => {
			delete events[name];
		},
		addEventListener: (name: string, callback: () => void) => {
			events[name] = callback;
		},
		emit: (name: string) => events[name]?.(),
	};
}

function fixture(
	mode: string | null = "foresight",
	supportsPrefetch = true,
	path = "/",
) {
	const panel = node();
	const status = node();
	const close = node();

	const anchors = [
		"/work",
		"/about",
		"/building",
		"/writing",
		"/api/contact",
	].map((path) => node(`https://thesuperhuman.us${path}`));

	const appendChild = vi.fn();
	const replace = vi.fn();
	const connection = { saveData: false, effectiveType: "4g" };
	const navigator = { onLine: true, connection };

	const window = node();
	const observers: Array<(records?: unknown[]) => void> = [];
	const disconnect = vi.fn();
	vi.stubGlobal("window", window);
	vi.stubGlobal(
		"MutationObserver",
		class {
			constructor(callback: (records: unknown[]) => void) {
				observers.push((records = [{ type: "childList" }]) =>
					callback(records),
				);
			}
			observe() {}
			disconnect = disconnect;
		},
	);

	const document = {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		body: {},
		visibilityState: "visible",
		querySelector: (selector: string) => {
			if (selector === "#prefetch-trial") return panel;

			if (selector === "#prefetch-status") return status;

			if (selector === "#prefetch-close") return close;

			return null;
		},
		querySelectorAll: () => anchors,
		createElement: () => ({
			rel: "",
			as: "",
			href: "",
			relList: { supports: () => supportsPrefetch },
		}),
		head: { appendChild },
	};

	vi.stubGlobal("location", {
		href: `https://thesuperhuman.us${path}${mode === null ? "" : `?prefetch=${mode}&keep=yes`}`,
		replace,
	});
	vi.stubGlobal("navigator", navigator);
	vi.stubGlobal("document", document);
	const fetch = vi.fn().mockResolvedValue({});
	vi.stubGlobal("fetch", fetch);

	return {
		panel,
		window,
		observers,
		disconnect,
		status,
		close,
		anchors,
		appendChild,
		replace,
		navigator,
		document,
		fetch,
	};
}

beforeEach(() => {
	callbacks.length = 0;
	unregister.mockClear();
	loadManager.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("prefetch trial runtime boundaries", () => {
	it("keeps default prediction off when the rollback switch is disabled", async () => {
		const f = fixture(null);
		await setupPrefetchTrial(loadManager, false);
		expect(loadManager).not.toHaveBeenCalled();
		expect(f.panel.hidden).toBe(true);
		expect(f.appendChild).not.toHaveBeenCalled();
	});
	it("runs default public prediction without showing diagnostics", async () => {
		const f = fixture(null);
		await setupPrefetchTrial(loadManager, true);
		expect(loadManager).toHaveBeenCalledOnce();
		expect(f.panel.hidden).toBe(true);
		expect(f.status.textContent).toBe("");
		callbacks[0]();
		expect(f.appendChild).toHaveBeenCalledOnce();
		expect(f.status.textContent).toBe("");
	});
	it.each(["/owner", "/studio", "/api/contact", "/offer/token"])(
		"never loads prediction on unreviewed source %s even in diagnostics",
		async (path) => {
			const f = fixture("foresight", true, path);
			await setupPrefetchTrial(loadManager);
			expect(loadManager).not.toHaveBeenCalled();
			expect(f.panel.hidden).toBe(true);
			expect(f.appendChild).not.toHaveBeenCalled();
		},
	);
	it("stops a reserved callback after navigation to a private source", async () => {
		const f = fixture(null);
		await setupPrefetchTrial(loadManager, true);
		vi.stubGlobal("location", { href: "https://thesuperhuman.us/owner" });
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
	});
	it.each(["https://other.thesuperhuman.us/"])(
		"never loads the manager on unreviewed host %s",
		async (href) => {
			const f = fixture();
			vi.stubGlobal("location", { href: `${href}?prefetch=foresight` });
			await setupPrefetchTrial(loadManager);
			expect(loadManager).not.toHaveBeenCalled();
			expect(f.panel.hidden).toBe(true);
			expect(f.appendChild).not.toHaveBeenCalled();
		},
	);

	it.each(["", "unexpected"])(
		"does nothing for inactive mode %s",
		async (mode) => {
			const f = fixture(mode);
			await setupPrefetchTrial(loadManager);
			expect(f.panel.hidden).toBe(true);
			expect(loadManager).not.toHaveBeenCalled();
			expect(f.appendChild).not.toHaveBeenCalled();
			expect(f.fetch).not.toHaveBeenCalled();
		},
	);
	it("off mode shows diagnostics but no prediction, and close preserves other parameters", async () => {
		const f = fixture("off");
		await setupPrefetchTrial(loadManager);
		expect(f.panel.hidden).toBe(false);
		expect(loadManager).not.toHaveBeenCalled();
		f.close.emit("click");
		expect(f.replace).toHaveBeenCalledWith(
			"https://thesuperhuman.us/?keep=yes",
		);
		expect(f.appendChild).not.toHaveBeenCalled();
	});
	it("registers only public links and rechecks a mutated href at callback time", async () => {
		const f = fixture();
		await setupPrefetchTrial(loadManager);
		expect(callbacks).toHaveLength(4);
		f.anchors[0].href = "https://thesuperhuman.us/api/contact";
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		f.anchors[0].href = "https://thesuperhuman.us/work";
		callbacks[0]();
		expect(f.appendChild).toHaveBeenCalledOnce();
		expect(f.appendChild.mock.calls[0][0]).toMatchObject({
			rel: "prefetch",
			as: "document",
			referrerPolicy: "no-referrer",
			href: f.anchors[0].href,
		});
	});
	it("rechecks connectivity, visibility and data constraints without consuming the cap", async () => {
		const f = fixture();
		await setupPrefetchTrial(loadManager);
		f.navigator.onLine = false;
		callbacks[0]();
		f.navigator.onLine = true;
		f.document.visibilityState = "hidden";
		callbacks[0]();
		f.document.visibilityState = "visible";
		f.navigator.connection.saveData = true;
		callbacks[0]();
		f.navigator.connection.saveData = false;
		f.navigator.connection.effectiveType = "3g";
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		f.navigator.connection.effectiveType = "4g";

		for (const callback of callbacks) {
			callback();
			callback();
		}

		expect(f.appendChild).toHaveBeenCalledTimes(3);
	});
	it("rejects disconnected or newly download/target links", async () => {
		const f = fixture();
		await setupPrefetchTrial(loadManager);
		f.anchors[0].isConnected = false;
		f.anchors[1].download = "file";
		f.anchors[2].target = "_blank";
		callbacks.slice(0, 3).forEach((callback) => callback());
		expect(f.appendChild).not.toHaveBeenCalled();
	});
	it("supports delayed focus, cancels departed hover, and requests immediately on touch", async () => {
		vi.useFakeTimers();
		const f = fixture("hover");
		await setupPrefetchTrial(loadManager);
		f.anchors[0].emit("mouseenter");
		f.anchors[0].emit("mouseleave");
		vi.advanceTimersByTime(100);
		expect(f.appendChild).not.toHaveBeenCalled();
		f.anchors[0].emit("focus");
		vi.advanceTimersByTime(79);
		expect(f.appendChild).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(f.appendChild).toHaveBeenCalledOnce();
		f.anchors[1].emit("touchstart");
		expect(f.appendChild).toHaveBeenCalledTimes(2);
		expect(loadManager).not.toHaveBeenCalled();
	});
	it("registers inserted links once, revalidates replacements, and cleans up on pagehide", async () => {
		const f = fixture(null);
		const dispose = await setupPrefetchTrial(loadManager);
		expect(callbacks).toHaveLength(4);
		f.anchors.push(node("https://thesuperhuman.us/privacy"));
		f.observers[0]();
		f.observers[0]();
		expect(callbacks).toHaveLength(5);
		f.anchors[5].href = "https://thesuperhuman.us/api/contact";
		callbacks[4]();
		expect(f.appendChild).not.toHaveBeenCalled();
		f.window.emit("pagehide");
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		expect(f.disconnect).toHaveBeenCalled();
		f.window.emit("pageshow");
		callbacks.at(-1)!();
		expect(f.appendChild).toHaveBeenCalledOnce();
		dispose?.();
	});
	it("cleans up removed links and retains the lifetime budget through bfcache restore", async () => {
		const f = fixture(null);
		const dispose = await setupPrefetchTrial(loadManager);
		f.anchors[0].isConnected = false;
		f.observers[0]();
		expect(unregister).toHaveBeenCalled();
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		callbacks.slice(1).forEach((callback) => callback());
		expect(f.appendChild).toHaveBeenCalledTimes(3);
		expect(f.disconnect).toHaveBeenCalled();
		const registrations = callbacks.length;
		f.window.emit("pagehide");
		f.window.emit("pageshow");
		f.anchors.push(node("https://thesuperhuman.us/privacy"));
		f.observers[0]();
		expect(callbacks).toHaveLength(registrations);
		callbacks.forEach((callback) => callback());
		expect(f.appendChild).toHaveBeenCalledTimes(3);
		dispose?.();
	});
	it("strips only the fetch fragment and leaves native link behavior intact", async () => {
		const f = fixture(null);
		f.anchors[0].href = "https://thesuperhuman.us/work#history";
		await setupPrefetchTrial(loadManager);
		callbacks[0]();
		expect(f.appendChild.mock.calls[0][0].href).toBe(
			"https://thesuperhuman.us/work",
		);
		expect(f.anchors[0].href).toBe("https://thesuperhuman.us/work#history");
	});
	it("allows public form and no-store sources but never targets those pages", async () => {
		const f = fixture(null, true, "/software/start");
		await setupPrefetchTrial(loadManager);
		callbacks[0]();
		expect(f.appendChild).toHaveBeenCalledOnce();
		expect(f.fetch).not.toHaveBeenCalled();
	});

	it("uses a credential-free, redirect-refusing fetch fallback", async () => {
		const f = fixture("foresight", false);
		await setupPrefetchTrial(loadManager);
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		expect(f.fetch).toHaveBeenCalledWith("https://thesuperhuman.us/work", {
			credentials: "omit",
			redirect: "error",
			referrerPolicy: "no-referrer",
		});
	});
});

describe("prefetch visibility lifecycle", () => {
	it("does not register hidden menu links and registers after opening", async () => {
		const f = fixture();
		f.anchors[0].rendered = false;
		await setupPrefetchTrial(loadManager);
		expect(callbacks).toHaveLength(3);
		f.anchors[0].rendered = true;
		f.observers[0]();
		expect(callbacks).toHaveLength(4);
		callbacks[3]();
		expect(f.appendChild).toHaveBeenCalledTimes(1);
	});
	it("drops a stale hidden prediction without spending budget and can register again", async () => {
		const f = fixture();
		await setupPrefetchTrial(loadManager);
		f.anchors[0].rendered = false;
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		expect(unregister).toHaveBeenCalledTimes(1);
		f.anchors[0].rendered = true;
		f.observers[0]();
		expect(callbacks).toHaveLength(5);
		callbacks[4]();
		expect(f.appendChild).toHaveBeenCalledTimes(1);
	});
	it("reconciles breakpoint changes and removes its resize listener on cleanup", async () => {
		const f = fixture();
		const cleanup = await setupPrefetchTrial(loadManager);
		f.anchors[0].rendered = false;
		f.window.emit("resize");
		expect(unregister).toHaveBeenCalledTimes(1);
		f.anchors[0].rendered = true;
		f.window.emit("resize");
		expect(callbacks).toHaveLength(5);
		cleanup?.();
		f.window.emit("resize");
		expect(callbacks).toHaveLength(5);
	});
});

it("ignores animation-only style updates but reconciles visibility styles", async () => {
	const f = fixture();
	await setupPrefetchTrial(loadManager);
	f.anchors[0].rendered = false;

	const target = {
		matches: () => true,
		querySelector: () => null,
		getAttribute: () => "--p: 0.5; --rx: 1;",
	};

	f.observers[0]([
		{
			type: "attributes",
			attributeName: "style",
			oldValue: "--p: 0.1;",
			target,
		},
	]);
	expect(unregister).not.toHaveBeenCalled();
	target.getAttribute = () => "display: none; --p: 0.5;";
	f.observers[0]([
		{
			type: "attributes",
			attributeName: "style",
			oldValue: "--p: 0.5;",
			target,
		},
	]);
	expect(unregister).toHaveBeenCalledTimes(1);
});

it("ignores decorative animation styles with no link descendants", async () => {
	const f = fixture();
	await setupPrefetchTrial(loadManager);
	f.anchors[0].rendered = false;

	for (const style of ["--glow: 1", "--lit: .8", "transform: rotate(1deg)"]) {
		f.observers[0]([
			{
				type: "attributes",
				attributeName: "style",
				oldValue: "",
				target: {
					matches: () => false,
					querySelector: () => null,
					getAttribute: () => style,
				},
			},
		]);
	}

	expect(unregister).not.toHaveBeenCalled();
});
