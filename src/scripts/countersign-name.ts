export function setupCountersignName() {
	for (const form of document.querySelectorAll<HTMLFormElement>(
		'form:has([name="action"][value="countersign"])',
	)) {
		const input = form.querySelector<HTMLInputElement>('[name="typed_name"]')!;
		input.addEventListener("input", () => {
			form.querySelector<HTMLElement>(".owner-signature")!.textContent =
				input.value;
			form.querySelector<HTMLButtonElement>(".studio-button")!.textContent =
				`Countersign as ${input.value}`;
		});
	}
}
