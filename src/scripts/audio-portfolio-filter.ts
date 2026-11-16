export function setupAudioPortfolioFilter() {
	const examples = [
		...document.querySelectorAll<HTMLElement>("[data-example-method]"),
	];

	document
		.querySelectorAll<HTMLButtonElement>("[data-method]")
		.forEach((button) =>
			button.addEventListener("click", () => {
				document
					.querySelectorAll("[data-method]")
					.forEach((item) =>
						item.setAttribute("aria-pressed", String(item === button)),
					);
				examples.forEach((example) => {
					example.hidden =
						button.dataset.method !== "all" &&
						example.dataset.exampleMethod !== button.dataset.method;

					if (example.hidden) {
						example.querySelectorAll("audio").forEach((audio) => audio.pause());
						example
							.querySelector("[data-comparison]")
							?.dispatchEvent(new Event("music-pause"));
					}
				});
				document.querySelector<HTMLElement>("[data-no-examples]")!.hidden =
					button.dataset.method === "all" ||
					examples.some((example) => !example.hidden);
			}),
		);
}
