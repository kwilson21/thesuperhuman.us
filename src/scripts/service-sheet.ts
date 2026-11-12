export function setupServiceSheet() {
	document
		.querySelector("[data-print-sheet]")
		?.addEventListener("click", () => window.print());
	const rows = [
		...document.querySelectorAll<HTMLDetailsElement>(
			"#software .service-offer",
		),
	];
	let closed: HTMLDetailsElement[] = [];
	window.addEventListener("beforeprint", () => {
		closed = rows.filter((row) => !row.open);
		rows.forEach((row) => {
			row.open = true;
		});
	});
	window.addEventListener("afterprint", () => {
		closed.forEach((row) => {
			row.open = false;
		});
		closed = [];
	});
}
