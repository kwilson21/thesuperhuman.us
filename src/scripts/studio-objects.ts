// The objects on the hero's desk are links into the site (Hero.astro). Pointing at or focusing one plays that object's
// own scene (StudioLife.astro reads [data-play]); with reduced motion the scene shows its finished frame instead. The
// headphones play the mix-and-master comparison further down Home when it can play here, and otherwise open the audio
// portfolio, their link.
export function setupStudioObjects() {
	const scene = document.querySelector<HTMLElement>("[data-studio-scene]");

	if (!scene) return;

	let current: string | undefined;

	const play = (id: string) => {
		if (current === id) return;
		current = id;
		// Clearing and reading layout first restarts the scene's animations when the same object is pointed at again.
		delete scene.dataset.play;
		void scene.getBoundingClientRect();
		scene.dataset.play = id;
	};

	const rest = (id: string) => {
		if (current !== id) return;
		current = undefined;
		delete scene.dataset.play;
	};

	scene
		.querySelectorAll<HTMLAnchorElement>("[data-studio-object]")
		.forEach((link) => {
			const id = link.dataset.studioObject ?? "";

			link.addEventListener("pointerenter", () => play(id));
			link.addEventListener("pointerleave", () => {
				if (document.activeElement !== link) rest(id);
			});
			link.addEventListener("focus", () => play(id));
			link.addEventListener("blur", () => rest(id));
		});

	const headphones = scene.querySelector<HTMLAnchorElement>(
		'[data-studio-object="headphones"]',
	);

	headphones?.addEventListener("click", (event) => {
		const player = document.querySelector<HTMLElement>(
			'.music-proof-preview [data-comparison][data-initialized="true"]:not([data-audio-fallback="true"])',
		);

		const button = player?.querySelector<HTMLButtonElement>(
			"[data-comparison-play]",
		);

		if (!player || !button) return;
		event.preventDefault();
		player.scrollIntoView({
			block: "center",
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});

		// The click is the visitor's own gesture, so the comparison may start its audio.
		if (button.dataset.playing !== "true") button.click();
		button.focus({ preventScroll: true });
	});
}
