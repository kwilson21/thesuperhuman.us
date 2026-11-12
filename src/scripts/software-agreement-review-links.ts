export function setupSoftwareAgreementReviewLinks() {
	document
		.querySelectorAll<HTMLAnchorElement>("[data-agreement-review-link]")
		.forEach((link) => {
			link.addEventListener("click", () => {
				const review = document.getElementById(link.hash.slice(1));

				if (review instanceof HTMLDetailsElement) review.open = true;
			});
		});
}
