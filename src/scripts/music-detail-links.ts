export function setupMusicDetailLinks() {
	function openLinkedDetail() {
		const target = document.getElementById(location.hash.slice(1));

		if (target instanceof HTMLDetailsElement) target.open = true;
	}

	openLinkedDetail();
	window.addEventListener("hashchange", openLinkedDetail);
	document
		.querySelectorAll('a[href="#lyrics"],a[href="#credits"]')
		.forEach((link) =>
			link.addEventListener("click", () => {
				const target = document.getElementById(
					link.getAttribute("href")!.slice(1),
				);

				if (target instanceof HTMLDetailsElement) target.open = true;
			}),
		);
}
