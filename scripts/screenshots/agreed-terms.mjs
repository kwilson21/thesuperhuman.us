/**
 * The SOW number the signing screenshots show. The server makes a new random id for each SOW it builds
 * (src/lib/software-agreements.ts), so the number, and the SHA-256 of the text that contains it, differ on
 * every run. The capture replaces both on screen with these fixed fictional values. The stored agreement is
 * unchanged; only the image shows the fixed values.
 */
export const FIXED_SOW_NUMBER = "SOW-00000000-0000-4000-8000-000000000009";
export const FIXED_AGREEMENT_HASH = "0123456789abcdef".repeat(4);

/**
 * Runs in the page: in each document of the terms reader, shows the fixed hash and SOW number (see
 * FIXED_SOW_NUMBER). Self-contained, so Playwright can run it in the page; the constants above are repeated
 * here for that reason.
 */
export function fixDisplayedAgreementIds(
	root = document.querySelector("[data-terms-reader]"),
) {
	const sowNumber =
		/SOW-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

	for (const block of root.querySelectorAll(".terms-document")) {
		const hash = block.querySelector(".terms-hash");
		const legal = block.querySelector("pre.terms-legal");

		if (hash)
			hash.textContent = `SHA-256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;

		if (legal)
			legal.textContent = legal.textContent.replace(
				sowNumber,
				"SOW-00000000-0000-4000-8000-000000000009",
			);
	}
}

// Exercise the real read-only controls with keyboard navigation before capturing a stage.
export async function prepareAgreedTerms(page, stage = 0, full = false) {
	const mutations = [];

	const watch = (request) => {
		if (
			request.method() !== "GET" &&
			new URL(request.url()).pathname.startsWith("/api/")
		)
			mutations.push(request.url());
	};

	page.on("request", watch);

	try {
		const outer = page.locator("[data-agreed-terms]");
		await outer.locator(":scope > summary").click();
		await page.locator("[data-terms-reader][data-terms-ready=true]").waitFor();
		const reader = page.locator("[data-terms-reader]");

		for (let index = 0; index < stage; index++) {
			const next = reader.locator("[data-terms-next]");
			await next.focus();
			await next.press("Enter");
		}

		const verify = async (index) => {
			const result = await reader.evaluate(
				(element, index) => ({
					visible: [...element.querySelectorAll("[data-terms-stage]")].flatMap(
						(stage, i) => (stage.hidden ? [] : [i]),
					),
					focused:
						document.activeElement ===
						element
							.querySelectorAll("[data-terms-stage]")
							[index].querySelector("h2"),
					headingTop: element
						.querySelectorAll("[data-terms-stage]")
						[index].querySelector("h2")
						.getBoundingClientRect().top,
					summaryBottom: element
						.querySelector(".terms-summary")
						.getBoundingClientRect().bottom,
					current: element
						.querySelector(`[data-terms-stage-button="${index}"]`)
						.getAttribute("aria-current"),
				}),
				index,
			);

			if (
				result.visible.join() !== String(index) ||
				(index > 0 && !result.focused) ||
				result.current !== "step" ||
				result.headingTop < result.summaryBottom - 1
			)
				throw new Error(
					`Guided terms stage/focus mismatch: ${JSON.stringify(result)}`,
				);
		};

		await verify(stage);

		if (stage > 0) {
			const back = reader.locator("[data-terms-back]");
			await back.focus();
			await back.press("Space");
			await verify(stage - 1);
			const selected = reader.locator(`[data-terms-stage-button="${stage}"]`);
			await selected.focus();
			await selected.press("Enter");
			await verify(stage);
		}

		// A permitted long project name must not hide the focused heading under the summary.
		const summaryName = reader.locator(".terms-summary strong");
		const savedName = await summaryName.textContent();
		await summaryName.evaluate((element) => {
			element.textContent =
				"A longer fictional client onboarding and follow-up project with agreed deliverables and acceptance checks for the team".padEnd(
					120,
					".",
				);
		});
		const stageButton = reader.locator(`[data-terms-stage-button="${stage}"]`);
		await stageButton.focus();
		await stageButton.press("Enter");
		await verify(stage);
		await summaryName.evaluate((element, name) => {
			element.textContent = name;
		}, savedName);
		await stageButton.focus();
		await stageButton.press("Enter");
		await verify(stage);
		// Expand every material term, then verify restoration and continued keyboard access.
		const all = reader.locator("[data-terms-full]");
		await all.focus();
		await all.press("Enter");

		const expanded = await reader.evaluate((element) => ({
			shown: [...element.querySelectorAll("[data-terms-stage]")].every(
				(stage) => !stage.hidden,
			),
			open: [...element.querySelectorAll("details")].every(
				(details) => details.open,
			),
			focused:
				document.activeElement ===
				element.querySelector("[data-terms-full-heading]"),
			signing: Boolean(
				element.querySelector(
					"form,[name=consent],[name=authority],[name=intent]",
				),
			),
		}));

		if (
			!expanded.shown ||
			!expanded.open ||
			!expanded.focused ||
			expanded.signing
		)
			throw new Error(
				`Full terms review is incomplete or changes consent: ${JSON.stringify(expanded)}`,
			);

		if (!full) {
			await all.focus();
			await all.press("Enter");
			await verify(stage);
		}

		if (mutations.length)
			throw new Error(
				`Reading terms must not submit mutations: ${mutations.join(", ")}`,
			);
		// The generated SOW number and hash are fixed for the image (see fixDisplayedAgreementIds).
		await page.evaluate(fixDisplayedAgreementIds);
		// Reset focus-induced scroll before the harness captures a tall element/full page.
		// Otherwise sticky summaries are frozen halfway down a full-page screenshot.
		await page.evaluate(() => window.scrollTo(0, 0));
		// Locator screenshots of a reader taller than the viewport center the element.
		// Freeze sticky geometry for that camera pass, after testing the live behavior.
		await page.addStyleTag({
			content:
				"[data-terms-reader] .terms-summary { position: static !important; }",
		});
	} finally {
		page.off("request", watch);
	}
}
