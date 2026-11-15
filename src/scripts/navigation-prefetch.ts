import {
	DEFAULT_PREFETCH_ENABLED,
	isPublicPrefetchSource,
	prefetchTarget,
	reservePrefetch,
} from "~/lib/navigation-prefetch";

type Connection = { saveData?: boolean; effectiveType?: string };

export interface PredictionManager {
	register(options: { element: HTMLAnchorElement; callback: () => void }): void;
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
			anchor.download ||
			anchor.target ||
			!reservePrefetch(target, seen, allowedNow())
		)
			return;
		const hint = document.createElement("link");
		hint.rel = "prefetch";
		hint.as = "document";
		hint.href = target!;

		if (hint.relList.supports("prefetch")) {
			document.head.appendChild(hint);
		} else {
			// Safari may not support link prefetch. Never execute the fetched document.
			void fetch(target!, { credentials: "omit", redirect: "error" }).catch(
				() => undefined,
			);
		}

		anchor.dataset.prefetchRequested = "true";
		report(
			`${mode}: ${seen.size}/3 hints requested. Latest: ${new URL(target!).pathname}`,
		);
	};

	const anchors = [
		...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
	].filter(
		(a) =>
			!a.closest("#prefetch-trial") &&
			!a.download &&
			!a.target &&
			prefetchTarget(a.href, location.href),
	);

	if (mode === "foresight") {
		try {
			const manager = await loadManager();

			for (const anchor of anchors)
				manager.register({ element: anchor, callback: () => request(anchor) });
		} catch {
			report(
				"Prediction could not start. Normal links still work; try Hover instead.",
			);
		}
	} else {
		for (const anchor of anchors) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const cancel = () => clearTimeout(timer);

			const enter = () => {
				cancel();
				timer = setTimeout(() => request(anchor), 80);
			};

			anchor.addEventListener("mouseenter", enter);
			anchor.addEventListener("focus", enter);
			anchor.addEventListener("mouseleave", cancel);
			anchor.addEventListener("blur", cancel);
			anchor.addEventListener("touchstart", () => request(anchor), {
				passive: true,
			});
		}
	}
}
