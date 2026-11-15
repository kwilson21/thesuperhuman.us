/**
 * Shows the pinned Get in touch button and marks it at the end while the closing panel, or a
 * page's own invitation (Home's contact section, marked data-pinned-end), is on screen.
 */
export function setupPinnedContact(): void {
	const pinned = document.querySelector<HTMLElement>("[data-pinned-contact]");

	const ends = [
		...document.querySelectorAll<HTMLElement>(
			".closing-panel, [data-pinned-end]",
		),
	];

	if (!pinned || !ends.length || typeof IntersectionObserver === "undefined")
		return;
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
