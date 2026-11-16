/**
 * One visible action: the phone link stays fixed until it meets the footer slot,
 * then follows that slot in both directions using native sticky positioning. The footer link preserves layout
 * and the no-JS/desktop fallback, but is inert while its phone proxy is active.
 */
export function setupPinnedContact(): void {
	const pinned = document.querySelector<HTMLElement>("[data-pinned-contact]");

	const footer = document.querySelector<HTMLElement>(
		"footer [data-closing-button]",
	);

	const link = pinned?.querySelector<HTMLElement>("a");
	const track = document.querySelector<HTMLElement>("[data-contact-track]");

	if (
		!pinned ||
		!footer ||
		!link ||
		!track ||
		typeof requestAnimationFrame === "undefined"
	)
		return;
	const phone = matchMedia("(max-width: 600px)");
	let pending = false;

	pinned.removeAttribute("hidden");

	// Only the backdrop changes on scroll. Native sticky geometry does not wait
	// for this callback, including when scroll events are delayed or coalesced.
	const updateBackdrop = () => {
		if (!phone.matches) return;
		const target = footer.getBoundingClientRect();
		const action = link.getBoundingClientRect();
		pinned.toggleAttribute("data-docked", target.top <= action.top + 1);
	};

	const update = () => {
		pending = false;

		if (!phone.matches) {
			footer.removeAttribute("data-contact-proxy");
			footer.removeAttribute("inert");

			if (document.activeElement === link)
				footer.focus({ preventScroll: true });
			pinned.setAttribute("inert", "");
			pinned.removeAttribute("data-docked");

			return;
		}

		if (!pinned.getClientRects().length) return;
		// Layout-only measurements: the browser, not a scroll-event transform,
		// constrains the sticky action to this document-space track. It therefore
		// follows fast/compositor scrolling even while the main thread is busy.
		const box = pinned.getBoundingClientRect();
		const action = link.getBoundingClientRect();
		const target = footer.getBoundingClientRect();
		track.style.setProperty(
			"--contact-track-height",
			`${target.top + window.scrollY + box.bottom - action.top}px`,
		);
		pinned.style.setProperty("--contact-height", `${box.height}px`);
		footer.setAttribute("data-contact-proxy", "");
		pinned.removeAttribute("inert");

		if (document.activeElement === footer) link.focus({ preventScroll: true });
		footer.setAttribute("inert", "");
		updateBackdrop();
	};

	const schedule = () => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(update);
	};

	window.addEventListener("scroll", updateBackdrop, { passive: true });
	window.addEventListener("resize", schedule);
	window.addEventListener("pageshow", schedule);
	window.addEventListener("focusin", () => {
		if (phone.matches && document.activeElement === link) {
			const rect = link.getBoundingClientRect();

			if (rect.bottom <= 0 || rect.top >= window.innerHeight)
				footer.scrollIntoView({ block: "center", behavior: "instant" });
		}

		schedule();
	});
	window.addEventListener("focusout", schedule);
	// Details toggle does not bubble; capture also covers closing the phone menu
	// after scrolling while its CSS temporarily hid the proxy.
	window.addEventListener("toggle", schedule, true);
	phone.addEventListener("change", schedule);
	window.visualViewport?.addEventListener("resize", schedule);
	window.visualViewport?.addEventListener("scroll", updateBackdrop);

	if (typeof ResizeObserver !== "undefined") {
		const resize = new ResizeObserver(schedule);
		resize.observe(document.documentElement);
		// Main can reflow without changing the root viewport box (notably WebKit).
		const main = document.querySelector("main");
		if (main) resize.observe(main);
		resize.observe(footer);
		resize.observe(pinned);
	}

	// Cold-font loads can move the footer without resizing the footer itself.
	void document.fonts?.ready.then(schedule);

	// Establish the initial state before paint, including restored scroll positions.
	update();
	updateBackdrop();
}
