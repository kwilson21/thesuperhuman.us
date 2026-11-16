/**
 * One visible action: the phone link stays fixed until it meets the footer slot,
 * then follows that slot in both directions. The footer link preserves layout
 * and the no-JS/desktop fallback, but is inert while its phone proxy is active.
 */
export function setupPinnedContact(): void {
	const pinned = document.querySelector<HTMLElement>("[data-pinned-contact]");

	const footer = document.querySelector<HTMLElement>(
		"footer [data-closing-button]",
	);

	const link = pinned?.querySelector<HTMLElement>("a");

	if (
		!pinned ||
		!footer ||
		!link ||
		typeof requestAnimationFrame === "undefined"
	)
		return;
	const phone = matchMedia("(max-width: 600px)");
	let offset = 0;
	let pending = false;

	pinned.removeAttribute("hidden");

	const update = () => {
		pending = false;

		if (!phone.matches) {
			footer.removeAttribute("data-contact-proxy");
			footer.removeAttribute("inert");

			if (document.activeElement === link)
				footer.focus({ preventScroll: true });
			pinned.setAttribute("inert", "");
			pinned.removeAttribute("data-docked");
			offset = 0;
			pinned.style.setProperty("--contact-dock-offset", "0px");

			return;
		}

		if (!pinned.getClientRects().length) return;
		// Subtract the last translation to recover the stable fixed-bottom position.
		const restingTop = link.getBoundingClientRect().top - offset;
		offset = Math.min(0, footer.getBoundingClientRect().top - restingTop);
		pinned.style.setProperty("--contact-dock-offset", `${offset}px`);

		if (offset < 0) pinned.setAttribute("data-docked", "");
		else pinned.removeAttribute("data-docked");
		footer.setAttribute("data-contact-proxy", "");
		pinned.removeAttribute("inert");

		if (document.activeElement === footer) link.focus({ preventScroll: true });
		footer.setAttribute("inert", "");
	};

	const schedule = () => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(update);
	};

	window.addEventListener("scroll", schedule, { passive: true });
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
	window.visualViewport?.addEventListener("scroll", schedule);

	if (typeof ResizeObserver !== "undefined") {
		const resize = new ResizeObserver(schedule);
		resize.observe(document.documentElement);
	}

	// Establish the initial state before paint, including restored scroll positions.
	update();
}
