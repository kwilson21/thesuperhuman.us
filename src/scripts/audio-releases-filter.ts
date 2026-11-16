export function setupAudioReleasesFilter() {
	const cards = [
		...document.querySelectorAll<HTMLElement>("[data-release-type]"),
	];

	document
		.querySelectorAll<HTMLButtonElement>("[data-filter]")
		.forEach((button) =>
			button.addEventListener("click", () => {
				document
					.querySelectorAll("[data-filter]")
					.forEach((item) =>
						item.setAttribute("aria-pressed", String(item === button)),
					);
				cards.forEach((card) => {
					card.hidden =
						button.dataset.filter !== "all" &&
						card.dataset.releaseType !== button.dataset.filter;

					if (card.hidden) card.querySelector("audio")?.pause();
				});
				const count = cards.filter((card) => !card.hidden).length;
				document.querySelector("[data-release-count]")!.textContent =
					`${count} ${count === 1 ? "release" : "releases"}`;
			}),
		);
}
