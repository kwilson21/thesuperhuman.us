// The objects on the hero's desk are links into the site (Hero.astro). Pointing at one with a mouse, or reaching it
// with the keyboard, plays that object's own scene (StudioLife.astro reads [data-play]); with reduced motion the scene
// shows its finished frame instead. The object pointed at leads; with none, the one with keyboard focus (:focus-visible)
// plays. A mouse press also focuses a link, and a touch screen sends pointer events for a tap, but neither plays a scene
// (hover effects belong to fine pointers, design.md). Escape hides a label that shows (WCAG 1.4.13). A plain click on
// the headphones plays the mix-and-master comparison further down Home when it can play here; otherwise, and for a
// click that opens a new tab or window, they open the audio portfolio, their link.
export function setupStudioObjects() {
	const scene = document.querySelector<HTMLElement>("[data-studio-scene]");

	if (!scene) return;

	const fineHover = matchMedia("(hover: hover) and (pointer: fine)");

	let current: string | undefined,
		hovered: string | undefined,
		focused: string | undefined;

	const update = () => {
		const id = hovered ?? focused;

		if (id === current) return;
		current = id;
		// Clearing and reading layout first restarts the scene's animations when another object takes over.
		delete scene.dataset.play;

		if (!id) return;
		void scene.getBoundingClientRect();
		scene.dataset.play = id;
	};

	scene
		.querySelectorAll<HTMLAnchorElement>("[data-studio-object]")
		.forEach((link) => {
			const id = link.dataset.studioObject ?? "";

			link.addEventListener("pointerenter", (event) => {
				if (event.pointerType === "touch" || !fineHover.matches) return;
				delete scene.dataset.labelsDismissed;
				hovered = id;
				update();
			});
			link.addEventListener("pointerleave", () => {
				if (hovered !== id) return;
				hovered = undefined;
				update();
			});
			link.addEventListener("focus", () => {
				if (!link.matches(":focus-visible")) return;
				delete scene.dataset.labelsDismissed;
				focused = id;
				update();
			});
			link.addEventListener("blur", () => {
				if (focused !== id) return;
				focused = undefined;
				update();
			});
		});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && (hovered || focused))
			scene.dataset.labelsDismissed = "true";
	});

	const headphones = scene.querySelector<HTMLAnchorElement>(
		'[data-studio-object="headphones"]',
	);

	headphones?.addEventListener("click", (event) => {
		const ownTabOrWindow =
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey;

		if (event.defaultPrevented || ownTabOrWindow) return;

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

		// The click is the visitor's own gesture, so the comparison may start its audio. While it is playing, or still
		// getting ready to (aria-busy), another click on its button would stop it.
		const started =
			button.dataset.playing === "true" ||
			button.getAttribute("aria-busy") === "true";

		if (!started) button.click();
		button.focus({ preventScroll: true });
	});
}
