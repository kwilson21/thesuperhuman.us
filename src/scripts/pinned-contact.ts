/**
 * Shows the pinned Get in touch button, and marks it data-at-end (which hides it) while the closing
 * panel, a page's own invitation (Home's contact section, marked data-pinned-end) or another filled
 * button in the page (Home's "Start a project", the 404's "Back to home", the audio pages' "Start
 * your song") is on screen, so a phone screen never shows two filled buttons at once.
 */
export const STEP_ASIDE_FOR =
	".closing-panel, [data-pinned-end], main .site-button:not(.site-button-outline)";

export function setupPinnedContact(): void {
	const pinned = document.querySelector<HTMLElement>("[data-pinned-contact]");
	const ends = [...document.querySelectorAll<HTMLElement>(STEP_ASIDE_FOR)];

	if (!pinned || !ends.length || typeof IntersectionObserver === "undefined")
		return;
	// It starts aside until the observer's first report, so it never flashes over a button that is
	// already on screen when the page opens.
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
