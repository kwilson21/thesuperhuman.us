export function setupPayloadReviewIllustration() {
	document
		.querySelectorAll<HTMLElement>("[data-review-illustration]")
		.forEach((root) => {
			const phases = [
				"Before: the editor is blocked",
				"Change: use a nonblocking notification",
				"After: inspect, then decide",
			];
			const captions = [
				"Before the fix, the decision covers the document and blocks editor interaction.",
				"Removing the modal option moves the decision out of the document’s way.",
				"The document stays usable. The notification still waits for an explicit decision before sending.",
			];
			const stage = root.querySelector<HTMLElement>("[data-stage]")!;
			const play = root.querySelector<HTMLButtonElement>("[data-play]")!;
			let step = 0;
			let timer: ReturnType<typeof setTimeout> | undefined;
			function stop() {
				clearTimeout(timer);
				timer = undefined;
				play.textContent = "Play change";
			}
			function show(n: number) {
				step = n;
				stage.dataset.step = String(n);
				root.querySelector("[data-phase]")!.textContent = phases[n];
				root.querySelector("[data-caption]")!.textContent = captions[n];
				root.querySelector("[data-count]")!.textContent = `${n + 1} / 3`;
			}
			root
				.querySelector("[data-review-next]")!
				.addEventListener("click", () => {
					stop();
					show((step + 1) % 3);
				});
			root.querySelector("[data-reset]")!.addEventListener("click", () => {
				stop();
				show(0);
			});
			play.addEventListener("click", () => {
				if (timer) {
					stop();
					return;
				}
				if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
					show((step + 1) % 3);
					return;
				}
				show(0);
				play.textContent = "Pause";
				function advance() {
					if (
						!root.isConnected ||
						document.hidden ||
						root.closest<HTMLElement>("[data-panel]")?.hidden
					) {
						stop();
						return;
					}
					show(step + 1);
					if (step < 2) timer = setTimeout(advance, 1800);
					else stop();
				}
				timer = setTimeout(advance, 1800);
			});
		});
}
