export function setupStudioSignIn() {
	const requestForm = document.querySelector<HTMLFormElement>(
		"#studio-code-request",
	);

	const verifyForm = document.querySelector<HTMLFormElement>(
		"#studio-code-verify",
	);

	const status = document.querySelector<HTMLElement>("#studio-status");
	requestForm?.addEventListener("submit", async (event) => {
		event.preventDefault();

		if (!requestForm || !verifyForm || !status) return;

		// src/pages/studio/sign-in.astro renders the email input in #studio-code-request; a missing one throws, as before.
		const email =
			requestForm.querySelector<HTMLInputElement>('[name="email"]')!.value;

		const turnstileToken =
			requestForm.querySelector<HTMLInputElement>(
				'[name="cf-turnstile-response"]',
			)?.value ?? "";

		const button = requestForm.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		);

		if (button) button.disabled = true;

		try {
			const response = await fetch("/api/studio/code", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, turnstileToken }),
			});

			// SAFETY: src/pages/api/studio/code.ts answers every status with JSON, carrying message on success and error on its 400, 403, 429 and 503 replies (musicRequest, which it calls first, also answers 403, 413, 415 and 400 with JSON error). Only its plain-text 404 ("Not found", sent when the client portal is off) is not JSON, and json() then throws into the catch below. Both fields are optional here and read with ??.
			const result = (await response.json()) as {
				message?: string;
				error?: string;
			};

			status.textContent =
				result.message ?? result.error ?? "Please try again.";

			if (response.ok) {
				verifyForm.hidden = false;
				boxes[0]?.focus();
			}
		} catch {
			status.textContent = "Could not reach the studio. Please try again.";
		} finally {
			if (button) button.disabled = false;
			window.turnstile?.reset();
		}
	});

	// Eight single-digit boxes; typing advances, backspace returns, and a pasted code fills them all.
	const boxes = [
		...document.querySelectorAll<HTMLInputElement>("[data-code-boxes] input"),
	];

	const fill = (digits: string, from: number) => {
		[...digits].forEach((digit, offset) => {
			if (boxes[from + offset]) boxes[from + offset].value = digit;
		});
		boxes[Math.min(from + digits.length, boxes.length - 1)]?.focus();
	};

	boxes.forEach((box, index) => {
		box.addEventListener("input", () => {
			const digits = box.value.replace(/\D/g, "");
			box.value = "";

			if (digits) fill(digits.slice(0, boxes.length - index), index);
		});
		box.addEventListener("keydown", (event) => {
			if (event.key === "Backspace" && !box.value && index > 0) {
				boxes[index - 1].value = "";
				boxes[index - 1].focus();
				event.preventDefault();
			}

			if (event.key === "ArrowLeft" && index > 0) boxes[index - 1].focus();

			if (event.key === "ArrowRight" && index < boxes.length - 1)
				boxes[index + 1].focus();
		});
		box.addEventListener("paste", (event) => {
			const digits =
				event.clipboardData?.getData("text").replace(/\D/g, "") ?? "";

			if (!digits) return;
			event.preventDefault();
			fill(digits.slice(0, boxes.length - index), index);
		});
	});
	document.querySelector("[data-new-code]")?.addEventListener("click", () => {
		if (!verifyForm || !status) return;
		verifyForm.hidden = true;
		boxes.forEach((box) => {
			box.value = "";
		});
		status.textContent = "Complete the security check and send a new code.";
		document.querySelector<HTMLInputElement>("#studio-email")?.focus();
	});
	verifyForm?.addEventListener("submit", async (event) => {
		event.preventDefault();

		if (!requestForm || !verifyForm || !status) return;

		// src/pages/studio/sign-in.astro renders the email input in #studio-code-request; a missing one throws, as before.
		const email =
			requestForm.querySelector<HTMLInputElement>('[name="email"]')!.value;

		const code = boxes.map((box) => box.value).join("");

		if (!/^\d{8}$/.test(code)) {
			status.textContent = "Enter all eight digits.";
			boxes.find((box) => !box.value)?.focus();

			return;
		}

		// src/pages/studio/sign-in.astro renders the hidden code input in #studio-code-verify; a missing one throws, as before.
		verifyForm.querySelector<HTMLInputElement>('[name="code"]')!.value = code;

		const button = verifyForm.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		);

		if (button) button.disabled = true;

		try {
			const response = await fetch("/api/studio/session", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, code }),
			});

			// SAFETY: src/pages/api/studio/session.ts answers with JSON: { ok: true } on success and { ok: false, error } on its 400, 401, 429 and 503 replies (musicRequest adds JSON 403, 413 and 415). Only its plain-text 404 ("Not found", sent when the client portal is off) is not JSON, and json() then throws into the catch below. error is optional and read only after the response.ok success branch has returned.
			const result = (await response.json()) as { error?: string };

			if (response.ok) {
				location.assign("/studio");

				return;
			}

			status.textContent = result.error ?? "Please try again.";
		} catch {
			status.textContent = "Could not reach the studio. Please try again.";
		} finally {
			if (button) button.disabled = false;
		}
	});
}
