export function setupSoftwareOfferPrint() {
	document
		.querySelector("[data-print-offer]")
		?.addEventListener("click", () => window.print());
}
