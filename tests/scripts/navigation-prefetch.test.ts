import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupPrefetchTrial } from "~/scripts/navigation-prefetch";

const callbacks: Array<() => void> = [];

const loadManager = vi.fn(async () => ({
	register: ({ callback }: { callback: () => void }) => {
		callbacks.push(callback);
	},
}));

function node(href = "") {
	const events: Record<string, () => void> = {};
	const dataset: Record<string, string> = {};

	return {
		href,
		hidden: true,
		textContent: "",
		isConnected: true,
		download: "",
		target: "",
		dataset,
		closest: () => null,
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

	const document = {
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
	it.each([
		"/owner",
		"/studio",
		"/software/start",
		"/api/contact",
		"/offer/token",
	])(
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
	it("uses a credential-free, redirect-refusing fetch fallback", async () => {
		const f = fixture("foresight", false);
		await setupPrefetchTrial(loadManager);
		callbacks[0]();
		expect(f.appendChild).not.toHaveBeenCalled();
		expect(f.fetch).toHaveBeenCalledWith("https://thesuperhuman.us/work", {
			credentials: "omit",
			redirect: "error",
		});
	});
});
