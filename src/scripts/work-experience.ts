import { runMotion } from "~/scripts/scroll-scenes";

export function setupWorkExperience() {
	// Restrained on purpose: only the two evidence diagrams build as they arrive.
	runMotion();
	function revealExperience(hash = location.hash) {
		const target = document.getElementById(hash.slice(1));
		if (target instanceof HTMLDetailsElement) {
			target.open = true;
			target.scrollIntoView();
		}
	}
	revealExperience();
	window.addEventListener("hashchange", () => revealExperience());
	document
		.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
		.forEach((link) => {
			link.addEventListener("click", () => revealExperience(link.hash));
		});
}
