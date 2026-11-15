import {
	DEFAULT_PREFETCH_ENABLED,
	PREFETCH_LIMIT,
	isPublicPrefetchSource,
	prefetchTarget,
	reservePrefetch,
} from "~/lib/navigation-prefetch";

type Connection = { saveData?: boolean; effectiveType?: string };

export interface PredictionManager {
	register(options: { element: HTMLAnchorElement; callback: () => void }): {
		unregister(): void;
	};
}

async function loadPredictionManager(): Promise<PredictionManager> {
	const { ForesightManager } = await import("js.foresight");

	return ForesightManager.initialize({
		touchDeviceStrategy: "onTouchStart",
		enableScrollPrediction: false,
	});
}

export async function setupPrefetchTrial(
	loadManager: () => Promise<PredictionManager> = loadPredictionManager,
	defaultEnabled = DEFAULT_PREFETCH_ENABLED,
) {
	if (!isPublicPrefetchSource(location.href)) return;
	const requestedMode = new URL(location.href).searchParams.get("prefetch");

	const mode = requestedMode ?? (defaultEnabled ? "foresight" : "off");

	if (!["foresight", "hover", "off"].includes(mode)) return;
	const diagnostics = requestedMode !== null;
	const panel = document.querySelector<HTMLElement>("#prefetch-trial");
	const status = document.querySelector<HTMLElement>("#prefetch-status");

	const report = (message: string) => {
		if (diagnostics && status) status.textContent = message;
	};

	if (diagnostics && panel) {
		panel.hidden = false;
		report(
			`${mode === "foresight" ? "Prediction" : mode === "hover" ? "Hover" : "Off"}: no hints requested.`,
		);
		document.querySelector("#prefetch-close")?.addEventListener("click", () => {
			const url = new URL(location.href);
			url.searchParams.delete("prefetch");
			location.replace(url.href);
		});
	}

	if (mode === "off") return;
	const seen = new Set<string>();

	const allowedNow = () => {
		// SAFETY: connection is an optional browser extension; only optional documented fields are read.
		const connection = (navigator as Navigator & { connection?: Connection })
			.connection;

		return (
			navigator.onLine &&
			document.visibilityState === "visible" &&
			!connection?.saveData &&
			!/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? "")
		);
	};

	const request = (anchor: HTMLAnchorElement) => {
		// Re-read href at the actual callback, not only at registration.
		const target = prefetchTarget(anchor.href, location.href);

		if (
			!isPublicPrefetchSource(location.href) ||
			!anchor.isConnected ||
			anchor.hasAttribute("download") ||
			anchor.target ||
			!reservePrefetch(target, seen, allowedNow())
		)
			return;
		const hint = document.createElement("link");
		hint.rel = "prefetch";
		hint.as = "document";
		hint.referrerPolicy = "no-referrer";
		hint.href = target!;

		if (hint.relList.supports("prefetch")) {
			document.head.appendChild(hint);
		} else {
			// Safari may not support link prefetch. Never execute the fetched document.
			void fetch(target!, {
				credentials: "omit",
				redirect: "error",
				referrerPolicy: "no-referrer",
			}).catch(() => undefined);
		}

		anchor.dataset.prefetchRequested = "true";
		report(
			`${mode}: ${seen.size}/3 hints requested. Latest: ${new URL(target!).pathname}`,
		);

		if (seen.size >= PREFETCH_LIMIT) pause();
	};

	const eligible = (anchor: HTMLAnchorElement) =>
		anchor.isConnected &&
		!anchor.closest("#prefetch-trial") &&
		!anchor.hasAttribute("download") &&
		!anchor.target &&
		prefetchTarget(anchor.href, location.href);

	let manager: PredictionManager | undefined;

	if (mode === "foresight") {
		try {
			manager = await loadManager();
		} catch {
			report(
				"Prediction could not start. Normal links still work; try Hover instead.",
			);

			return;
		}
	}

	const registrations = new Map<
		HTMLAnchorElement,
		{ href: string; cleanup: () => void }
	>();

	let active = true;

	const observeRequest = (anchor: HTMLAnchorElement) => {
		if (active) request(anchor);
	};

	const register = (anchor: HTMLAnchorElement) => {
		if (manager) {
			const registration = manager.register({
				element: anchor,
				callback: () => observeRequest(anchor),
			});

			return () => registration.unregister();
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const cancel = () => clearTimeout(timer);

		const enter = () => {
			cancel();
			timer = setTimeout(() => observeRequest(anchor), 80);
		};

		const touch = () => observeRequest(anchor);
		anchor.addEventListener("mouseenter", enter);
		anchor.addEventListener("focus", enter);
		anchor.addEventListener("mouseleave", cancel);
		anchor.addEventListener("blur", cancel);
		anchor.addEventListener("touchstart", touch, { passive: true });

		return () => {
			cancel();
			anchor.removeEventListener("mouseenter", enter);
			anchor.removeEventListener("focus", enter);
			anchor.removeEventListener("mouseleave", cancel);
			anchor.removeEventListener("blur", cancel);
			anchor.removeEventListener("touchstart", touch);
		};
	};

	const reconcile = () => {
		if (!active) return;

		for (const [anchor, registration] of registrations) {
			if (!eligible(anchor) || anchor.href !== registration.href) {
				registration.cleanup();
				registrations.delete(anchor);
			}
		}

		if (!isPublicPrefetchSource(location.href) || seen.size >= PREFETCH_LIMIT)
			return;

		for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
			"a[href]",
		)) {
			if (!registrations.has(anchor) && eligible(anchor)) {
				const cleanup = register(anchor);

				if (!active) {
					cleanup();

					return;
				}

				registrations.set(anchor, { href: anchor.href, cleanup });
			}
		}
	};

	const observer = new MutationObserver(reconcile);

	const resume = () => {
		if (seen.size >= PREFETCH_LIMIT) {
			pause();

			return;
		}

		active = true;
		reconcile();

		if (!active) return;
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["href", "download", "target"],
		});
	};

	const pause = () => {
		active = false;
		observer.disconnect();

		for (const registration of registrations.values()) registration.cleanup();
		registrations.clear();
	};

	window.addEventListener("pagehide", pause);
	window.addEventListener("pageshow", resume);
	resume();

	return () => {
		pause();
		window.removeEventListener("pagehide", pause);
		window.removeEventListener("pageshow", resume);
	};
}
