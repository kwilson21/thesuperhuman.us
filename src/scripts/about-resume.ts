import { runMotion } from "~/scripts/scroll-scenes";

export function setupAboutResume() {
	function openResume() {
		const section = document.getElementById("resumes");
		if (section instanceof HTMLDetailsElement) {
			section.open = true;
			section.scrollIntoView();
		}
	}
	function revealResume() {
		if (
			location.hash === "#resumes" ||
			location.hash === "#resume-request-form"
		)
			openResume();
	}
	document
		.querySelectorAll('a[href="#resumes"]')
		.forEach((link) => link.addEventListener("click", openResume));
	revealResume();
	window.addEventListener("hashchange", revealResume);

	// The path between chapters follows the reader, and each chapter's object plays once as it
	// arrives (ObjectLife); the terrain stays still. All of it rests fully drawn without motion.
	runMotion();
}
