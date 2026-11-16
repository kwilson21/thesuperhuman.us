export function setupSiteNav() {
	document
		.querySelectorAll<HTMLDetailsElement>(".mobile-menu")
		.forEach((menu) => {
			menu.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && menu.open) {
					menu.open = false;
					menu.querySelector("summary")?.focus();
				}
			});
			menu.querySelectorAll("a").forEach((link) =>
				link.addEventListener("click", () => {
					menu.open = false;
				}),
			);
		});
}
