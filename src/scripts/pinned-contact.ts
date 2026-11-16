/**
 * Keep the phone contact action available throughout the page. Only the shared footer replaces it;
 * page buttons (project choices, players, etc.) are not substitutes for Get in touch.
 * CSS separately steps aside for the mobile menu and focused form fields.
 */
export const STEP_ASIDE_FOR = ".compact-footer";

export function setupPinnedContact(): void {
	const pinned = document.querySelector<HTMLElement>("[data-pinned-contact]");
	const ends = [...document.querySelectorAll<HTMLElement>(STEP_ASIDE_FOR)];

	if (!pinned || !ends.length || typeof IntersectionObserver === "undefined")
		return;
	// It starts aside until the observer's first report, so it never flashes over a button that is
	// already on screen when the page opens or its scroll position is restored.
	pinned.setAttribute("data-at-end", "");
	pinned.removeAttribute("hidden");
	const showing = new Set<Element>();

	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries)
			if (entry.isIntersecting) showing.add(entry.target);
			else showing.delete(entry.target);

		if (showing.size) pinned.setAttribute("data-at-end", "");
		else pinned.removeAttribute("data-at-end");
	});

	for (const end of ends) observer.observe(end);
}
