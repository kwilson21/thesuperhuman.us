export function setupOpenDetailsLinks() {
	document
		.querySelectorAll<HTMLAnchorElement>("[data-open-details]")
		.forEach((link) =>
			link.addEventListener("click", () => {
				const target = document.getElementById(link.hash.slice(1));
				const details = target?.closest("details");

				if (details) details.open = true;
			}),
		);
}
