// The offer board against the real page (docs/plans/2026-11-offer-board.md): each bug the Quint model
// verification/offer-board.qnt keeps as a mutant is tried here on the owner's request page, and none may happen. Runs
// against the local preview (the Screenshots workflow starts it), signed in through the local Access issuer the
// screenshot harness uses, with the scripted stand-in model (scripts/screenshots/offer-board-script.mjs). It seeds its
// own fictional request and a made-up day value; no model is called and nothing is sent.
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createServer } = require("node:http");

const playwrightPath = process.env.PW_SKILL_DIR
	? path.join(process.env.PW_SKILL_DIR, "node_modules/playwright")
	: "playwright";

const { chromium } = require(playwrightPath);
const { SignJWT } = require("jose");

const targetUrl = process.env.TARGET_URL || "http://127.0.0.1:4321";
const artifactDir = process.env.PW_ARTIFACT_DIR || "/tmp";
const root = path.resolve(__dirname, "../..");
const REQUEST = "offer-board-check";

// The preview server holds the same local database, so a statement can meet its lock (CI saw SQLITE_BUSY once, in
// the first statement). Only that is tried again, up to five times; any other failure stops the check.
async function sql(command) {
	for (let attempt = 1; ; attempt++) {
		try {
			return execFileSync(
				process.execPath,
				[
					path.join(root, "node_modules/wrangler/bin/wrangler.js"),
					"d1",
					"execute",
					"MUSIC_DB",
					"--local",
					"--config",
					path.join(root, ".screenshots/wrangler.json"),
					"--persist-to",
					path.join(root, ".wrangler/state"),
					"--json",
					"--command",
					command,
				],
				{ encoding: "utf8", env: { ...process.env, CI: "1" } },
			);
		} catch (error) {
			const busy = /SQLITE_BUSY/.test(
				`${error.stderr ?? ""}${error.stdout ?? ""}`,
			);

			if (!busy || attempt === 5) throw error;
			console.log(`The local database is busy; trying again (${attempt}).`);
			await new Promise((done) => setTimeout(done, 1000 * attempt));
		}
	}
}

const details = {
	path: "website",
	purpose:
		"A home for my band on the web. Fans should hear new music, see upcoming shows near them and join the mailing list. Venues need a quick way to book us.",
	currentUrl: "",
	existing: "",
	updates: "self",
	company: "",
	timing: "flexible",
	timingDate: "",
	budgetNote: "",
	clientCopyStatus: "sent",
};

const failures = [];

function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);

	if (!ok) failures.push(name);
}

(async () => {
	const { loadOrCreateAccessKey } = await import(
		path.join(root, "scripts/screenshots/access-key.mjs")
	);

	const { ACCESS_ISSUER, ACCESS_AUDIENCE, OWNER_EMAIL } = await import(
		path.join(root, "scripts/screenshots/config.mjs")
	);

	const { scriptedOfferReply } = await import(
		path.join(root, "scripts/screenshots/offer-board-script.mjs")
	);

	await sql(
		`DELETE FROM software_offers WHERE request_id='${REQUEST}'; DELETE FROM owner_requests WHERE id='${REQUEST}'`,
	);
	await sql(
		`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at) VALUES ('${REQUEST}','software','website','Sam Example','sam@example.com','A home for my band on the web.','${JSON.stringify(details).replaceAll("'", "''")}','new','','2026-11-15T12:00:00.000Z','2026-11-15T12:00:00.000Z')`,
	);

	const { kid, privateKey, jwk } = await loadOrCreateAccessKey(
		path.join(root, ".screenshots/access-key.json"),
	);

	const issuer = createServer((_, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ keys: [jwk] }));
	});

	await new Promise((done) =>
		issuer.listen(Number(new URL(ACCESS_ISSUER).port), "127.0.0.1", done),
	);

	const token = await new SignJWT({ email: OWNER_EMAIL })
		.setProtectedHeader({ alg: "RS256", kid })
		.setIssuer(ACCESS_ISSUER)
		.setAudience(ACCESS_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(privateKey);

	const browser = await chromium.launch({ headless: true });

	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
		extraHTTPHeaders: { "cf-access-jwt-assertion": token },
	});

	const errors = [];

	page.on("pageerror", (error) => errors.push(error.message));

	try {
		// A made-up day value, so the fee buttons show. The research is left as it is.
		await page.goto(new URL("/owner/pricing", targetUrl).href);

		const version = Number(
			await page.locator('[data-part="values"]').getAttribute("data-version"),
		);

		const saved = await page.evaluate(
			async (expectedVersion) =>
				(
					await fetch("/api/owner/pricing", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "values",
							dayValue: 400,
							contingencyPercent: 10,
							expectedVersion,
						}),
					})
				).status,
			version,
		);

		check(
			"a made-up day value is saved for the check",
			saved === 200,
			`${saved}`,
		);

		// The research table scrolls in its own box: /owner/pricing never scrolls sideways on a phone. Research is saved for the
		// check only when none is stored (in CI there is none; the figures are made up).
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(new URL("/owner/pricing", targetUrl).href);

		if ((await page.locator("[data-pricing-research]").count()) === 0) {
			const researchVersion = Number(
				await page.locator('[data-part="market"]').getAttribute("data-version"),
			);

			const stored = await page.evaluate(
				async (expectedVersion) =>
					(
						await fetch("/api/owner/pricing", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								action: "market",
								expectedVersion,
								market: {
									researchedOn: "2026-11-15",
									ranges: [
										{
											kind: "website",
											size: "small",
											definition:
												"Made up for the check: a range whose definition is long enough to wrap in its cell",
											lowUsd: 1000,
											highUsd: 2000,
											sourceIds: [1],
										},
									],
									caveats: ["Made up for the check."],
									sources: [
										{
											id: 1,
											title:
												"A made-up source for the check, with a title long enough to wrap on a phone",
											url: "https://example.org/made-up",
											published: "2026-11-01",
											kind: "other",
										},
									],
								},
							}),
						})
					).status,
				researchVersion,
			);

			check(
				"made-up research is saved for the check",
				stored === 200,
				`${stored}`,
			);
			await page.reload();
		}

		const pricingWidths = await page.evaluate(() => [
			document.documentElement.scrollWidth,
			document.documentElement.clientWidth,
		]);

		check(
			"the research table never makes /owner/pricing scroll sideways on a phone",
			pricingWidths[0] <= pricingWidths[1],
			pricingWidths.join(" in "),
		);
		await page.setViewportSize({ width: 1280, height: 800 });

		// retry-after-lost (verification/pricing-save.qnt): after a save whose answer was lost, the page asks for a reload
		// and sends nothing more until then.
		await page.reload();
		let pricingPosts = 0;

		await page.route("**/api/owner/pricing", (route) => {
			pricingPosts += 1;

			return route.abort("timedout");
		});

		const values = page.locator('[data-part="values"]');

		await values.getByRole("button", { name: "Save", exact: true }).click();
		await page.waitForFunction(() =>
			/Reload the page/.test(
				document.querySelector('[data-part="values"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		await values.getByRole("button", { name: "Save", exact: true }).click();
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();
		await page.waitForTimeout(300);
		check(
			"retry-after-lost: after a lost answer the pricing page sends nothing until it is reloaded",
			pricingPosts === 1 &&
				/Reload the page before saving again/.test(
					await values.locator("[data-pricing-status]").textContent(),
				),
			`${pricingPosts} sent`,
		);

		// After a lost answer, a press with a refused value asks for the reload before any field is checked or marked.
		const lostContingency = values.locator('[name="contingencyPercent"]');
		const lostBefore = await lostContingency.inputValue();

		await lostContingency.fill("150");
		await values.getByRole("button", { name: "Save", exact: true }).click();
		check(
			"after a lost answer, a press asks for the reload and marks no field",
			(await lostContingency.getAttribute("aria-invalid")) === null &&
				/Reload the page before saving again/.test(
					await values.locator("[data-pricing-status]").textContent(),
				),
		);
		await lostContingency.fill(lostBefore);
		await page.unroute("**/api/owner/pricing");

		// Clear research while the other form has unsaved changes: no reload, so the box and the research it showed go.
		await page.reload();

		const clearVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", (route) =>
			route.fulfill({ json: { ok: true, version: clearVersion + 1 } }),
		);
		page.once("dialog", (dialog) => dialog.accept());
		const contingency = values.locator('[name="contingencyPercent"]');
		const contingencyBefore = await contingency.inputValue();

		await contingency.fill(contingencyBefore === "12" ? "13" : "12");
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();
		await page.waitForFunction(() =>
			/Research cleared/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);

		const research = page.locator("[data-pricing-research]");

		check(
			"a clear without a reload empties the research box and hides the research it showed",
			(await page.locator("[data-pricing-market]").inputValue()) === "" &&
				((await research.count()) === 0 || (await research.isHidden())),
		);
		check(
			"a clear without a reload leaves focus on Save research and says there is no research",
			(await page.evaluate(() => document.activeElement?.textContent)) ===
				"Save research" &&
				(await page.locator("[data-pricing-empty]").isVisible()),
		);

		// Research saved without a reload: the empty line goes and Clear research is offered again.
		await page
			.locator("[data-pricing-market]")
			.fill(JSON.stringify({ researchedOn: "2026-11-01", ranges: [] }));
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Save research" })
			.click();
		await page.waitForFunction(() =>
			/^Saved\./.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"research saved without a reload hides the empty line and offers Clear research",
			(await page.locator("[data-pricing-empty]").isHidden()) &&
				(await page
					.locator('[data-part="market"]')
					.getByRole("button", { name: "Clear research" })
					.isVisible()),
		);
		// Put the field back, so leaving the page raises no unsaved-changes warning.
		await contingency.fill(contingencyBefore);
		await page.unroute("**/api/owner/pricing");

		// The values form checks its two numbers itself: nothing is sent, the field is marked and named, and focus goes to it.
		await page.reload();
		let valuePosts = 0;

		await page.route("**/api/owner/pricing", (route) => {
			valuePosts += 1;

			return route.abort();
		});
		await contingency.fill("150");
		await values.getByRole("button", { name: "Save", exact: true }).click();
		check(
			"an out-of-range contingency is refused on the page, marked, described and focused",
			valuePosts === 0 &&
				(await contingency.getAttribute("aria-invalid")) === "true" &&
				/pricing-values-status/.test(
					(await contingency.getAttribute("aria-describedby")) ?? "",
				) &&
				(await page.evaluate(() =>
					document.activeElement?.getAttribute("name"),
				)) === "contingencyPercent" &&
				/whole number from 0 to 100/.test(
					await values.locator("[data-pricing-status]").textContent(),
				),
		);
		await contingency.fill(contingencyBefore);
		check(
			"typing in a refused value field clears its mark",
			(await contingency.getAttribute("aria-invalid")) === null &&
				(await contingency.getAttribute("aria-describedby")) ===
					"pricing-contingency-hint",
		);
		await page.unroute("**/api/owner/pricing");

		// A clear whose answer arrives after the owner moved to another field leaves focus where they put it.
		await page.reload();

		const slowVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({ json: { ok: true, version: slowVersion + 1 } });
		});
		await contingency.fill(contingencyBefore === "12" ? "13" : "12");
		page.once("dialog", (dialog) => dialog.accept());
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();
		await contingency.focus();
		await page.waitForFunction(() =>
			/Research cleared/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"a clear answered after the owner moved to another field leaves focus there",
			(await page.evaluate(() =>
				document.activeElement?.getAttribute("name"),
			)) === "contingencyPercent",
		);
		await contingency.fill(contingencyBefore);
		await page.unroute("**/api/owner/pricing");

		// Clear research names unsaved text in the research box before it goes; dismissing sends nothing.
		await page.reload();
		let clearPosts = 0;

		await page.route("**/api/owner/pricing", (route) => {
			clearPosts += 1;

			return route.abort();
		});

		const box = page.locator("[data-pricing-market]");
		const boxBefore = await box.inputValue();
		let asked = "";

		await box.fill(`${boxBefore} `);
		page.once("dialog", (dialog) => {
			asked = dialog.message();

			return dialog.dismiss();
		});
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();
		await page.waitForTimeout(200);
		check(
			"Clear research warns that unsaved text in the research box will be lost",
			/not saved and will be lost/.test(asked) && clearPosts === 0,
			asked,
		);
		await box.fill(boxBefore);
		await page.unroute("**/api/owner/pricing");

		// A save marks saved only what it sent: text typed while it was on its way is kept, said, and still counts as
		// unsaved, so the leave-page warning still protects it.
		await page.reload();

		const raceVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({ json: { ok: true, version: raceVersion + 1 } });
		});

		const dayField = values.locator('[name="dayValue"]');
		const dayStored = await dayField.inputValue();
		const sentDay = dayStored === "450" ? "475" : "450";

		await dayField.fill(sentDay);
		await values.getByRole("button", { name: "Save", exact: true }).click();
		await dayField.focus();
		await page.keyboard.press("End");
		await page.keyboard.type("9");
		await page.waitForFunction(() =>
			/^Saved/.test(
				document.querySelector('[data-part="values"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"text typed while a save is on its way is kept, said, and still counts as unsaved",
			(await dayField.inputValue()) === `${sentDay}9` &&
				(await dayField.evaluate((element) => element.defaultValue)) ===
					sentDay &&
				/You changed it since/.test(
					await values.locator("[data-pricing-status]").textContent(),
				),
			await values.locator("[data-pricing-status]").textContent(),
		);
		await page.unroute("**/api/owner/pricing");

		// A clear keeps text typed in the research box while it was on its way, and says it is not saved.
		await page.reload();

		const keepVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({ json: { ok: true, version: keepVersion + 1 } });
		});
		await contingency.fill(contingencyBefore === "12" ? "13" : "12");
		page.once("dialog", (dialog) => dialog.accept());
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();

		const clearingSaid = await page
			.locator('[data-part="market"] [data-pricing-status]')
			.textContent();

		await box.focus();
		await page.keyboard.press("Control+End");
		await page.keyboard.type(" note");
		await page.waitForFunction(() =>
			/Research cleared/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"a clear says Clearing, then keeps text typed in the box meanwhile and says it is not saved",
			clearingSaid === "Clearing…" &&
				(await box.inputValue()).endsWith(" note") &&
				/is not saved/.test(
					await page
						.locator('[data-part="market"] [data-pricing-status]')
						.textContent(),
				),
			clearingSaid,
		);
		// Leave nothing unsaved, so leaving the page raises no warning.
		await box.fill("");
		await contingency.fill(contingencyBefore);
		await page.unroute("**/api/owner/pricing");

		// A box emptied while a clear was on its way holds nothing unsaved, and the message says only that it cleared.
		await page.reload();

		const emptiedVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({
				json: { ok: true, version: emptiedVersion + 1 },
			});
		});
		await contingency.fill(contingencyBefore === "12" ? "13" : "12");
		page.once("dialog", (dialog) => dialog.accept());
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Clear research" })
			.click();
		await box.focus();
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");
		await page.waitForFunction(() =>
			/Research cleared/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			'a box emptied while a clear was on its way gets only "Research cleared."',
			(await page
				.locator('[data-part="market"] [data-pricing-status]')
				.textContent()) === "Research cleared.",
		);
		await contingency.fill(contingencyBefore);
		await page.unroute("**/api/owner/pricing");

		// A research save with the other form clean, and text typed in the box while it is on its way, does not reload over
		// that text (a reload would bring back the stored research without it), and still says to reload for the ranges.
		await page.reload();

		const noReloadVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({
				json: { ok: true, version: noReloadVersion + 1 },
			});
		});
		await page.evaluate(() => {
			window.__beforeSave = true;
		});
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Save research" })
			.click();
		await box.focus();
		await page.keyboard.press("Control+End");
		await page.keyboard.type(" note");
		await page.waitForFunction(() =>
			/^Saved the research as it was/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		await page.waitForTimeout(500);
		check(
			"a research save does not reload over text typed in the box meanwhile, and still says to reload",
			(await page.evaluate(() => window.__beforeSave === true)) &&
				(await box.inputValue()).endsWith(" note") &&
				/reload the page to see the new ranges/.test(
					await page
						.locator('[data-part="market"] [data-pricing-status]')
						.textContent(),
				),
		);
		// Leave nothing unsaved, so leaving the page raises no warning.
		await box.evaluate((element) => {
			element.value = element.defaultValue;
		});
		await page.unroute("**/api/owner/pricing");

		// A press while a save is on its way is refused before the fields are checked, so no field is marked for it.
		await page.reload();

		const busyVersion = Number(await values.getAttribute("data-version"));

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({ json: { ok: true, version: busyVersion + 1 } });
		});
		await values.getByRole("button", { name: "Save", exact: true }).click();

		// The pressed button keeps focus while it waits, and its ring keeps full strength: shown busy by colour, not opacity.
		const busyButton = await values
			.getByRole("button", { name: "Save", exact: true })
			.evaluate((button) => [
				button.getAttribute("aria-disabled"),
				getComputedStyle(button).opacity,
				document.activeElement === button,
			]);

		await contingency.focus();
		await page.keyboard.press("Control+a");
		await page.keyboard.type("150");
		await page.keyboard.press("Enter");

		const busySaid = await values
			.locator("[data-pricing-status]")
			.textContent();

		const busyMarked = await contingency.getAttribute("aria-invalid");

		await page.waitForFunction(() =>
			/^Saved/.test(
				document.querySelector('[data-part="values"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"a button waiting on its save keeps focus at full opacity",
			busyButton[0] === "true" && busyButton[1] === "1" && busyButton[2],
			busyButton.join(" / "),
		);
		check(
			"a press while a save is on its way says so and marks no field",
			/on its way/i.test(busySaid) && busyMarked === null,
			`${busySaid} / ${busyMarked}`,
		);
		await contingency.fill(contingencyBefore);
		await page.unroute("**/api/owner/pricing");

		// In a contrast theme the busy state still shows: the system's colour for inactive text.
		await page.emulateMedia({ forcedColors: "active" });

		const forcedLooks = await page.evaluate(() =>
			[
				...document.querySelectorAll(
					'[data-pricing-form] button[type="submit"], [data-pricing-clear]',
				),
			].map((button) => {
				const rest = getComputedStyle(button).color;

				button.setAttribute("aria-disabled", "true");

				const busy = getComputedStyle(button).color;

				button.removeAttribute("aria-disabled");

				return [button.textContent, rest, busy];
			}),
		);

		await page.emulateMedia({ forcedColors: "none" });
		check(
			"in a contrast theme every busy button looks different from one at rest",
			forcedLooks.length === 3 &&
				forcedLooks.every(([, rest, busy]) => rest !== busy),
			forcedLooks.map((look) => look.join(" ")).join("; "),
		);

		// A research refusal answered after the box changed is about what was sent: the box is not marked, and the reason
		// says so.
		await page.reload();
		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({
				status: 400,
				json: { ok: false, error: "The research file is missing its ranges." },
			});
		});
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Save research" })
			.click();
		await box.focus();
		await page.keyboard.press("Control+End");
		await page.keyboard.type(" ");
		await page.waitForFunction(() =>
			/missing its ranges/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		const refusedSince = (await box.getAttribute("aria-invalid")) !== "true";

		check(
			"a research refusal answered after the box changed leaves the box unmarked and says why",
			refusedSince &&
				/you changed the box since/.test(
					await page
						.locator('[data-part="market"] [data-pricing-status]')
						.textContent(),
				),
		);
		await box.evaluate((element) => {
			element.value = element.defaultValue;
		});
		await page.unroute("**/api/owner/pricing");

		// The same refusal for the box as it was sent marks the box, with the reason beside it.
		await page.reload();
		await page.route("**/api/owner/pricing", (route) =>
			route.fulfill({
				status: 400,
				json: { ok: false, error: "The research file is missing its ranges." },
			}),
		);
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Save research" })
			.click();
		await page.waitForFunction(() =>
			/missing its ranges/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"a research refusal for the box as sent marks the box",
			(await box.getAttribute("aria-invalid")) === "true",
		);
		await page.unroute("**/api/owner/pricing");

		// A press during a save does not erase a refusal: the refusal comes back when the save answers, so a marked field
		// never points at an empty line.
		await page.reload();

		const keptVersion = Number(await values.getAttribute("data-version"));
		const keptDay = values.locator('[name="dayValue"]');
		const keptDayBefore = await keptDay.inputValue();

		await keptDay.fill("12.5");
		await values.getByRole("button", { name: "Save", exact: true }).click();

		const refusal = await values.locator("[data-pricing-status]").textContent();

		await page.route("**/api/owner/pricing", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			return route.fulfill({ json: { ok: true, version: keptVersion + 1 } });
		});
		await page
			.locator('[data-part="market"]')
			.getByRole("button", { name: "Save research" })
			.click();
		await values.getByRole("button", { name: "Save", exact: true }).click({
			force: true,
		});

		const busyLine = await values
			.locator("[data-pricing-status]")
			.textContent();

		await page.waitForFunction(() =>
			/^Saved/.test(
				document.querySelector('[data-part="market"] [data-pricing-status]')
					?.textContent ?? "",
			),
		);
		check(
			"a press during a save keeps the refusal it covered, and brings it back when the save answers",
			/whole dollars/.test(refusal) &&
				/on its way/.test(busyLine) &&
				(await values.locator("[data-pricing-status]").textContent()) ===
					refusal &&
				(await keptDay.getAttribute("aria-invalid")) === "true",
			await values.locator("[data-pricing-status]").textContent(),
		);
		await keptDay.fill(keptDayBefore);
		await page.unroute("**/api/owner/pricing");

		const queue = [];

		await page.route("**/api/owner/requests/*/offer-board", (route) =>
			queue.push(route),
		);

		const next = async (ms = 15000) => {
			for (let i = 0; i < ms / 100 && !queue.length; i++)
				await page.waitForTimeout(100);

			return queue.shift();
		};

		const release = (route, reply) =>
			route.fulfill({
				json: reply ?? scriptedOfferReply(route.request().postData()),
			});

		const card = (lane, n = 0) =>
			page.locator(`[data-offer-lane="${lane}"] .offer-card`).nth(n);

		const value = (name, scope = page) =>
			scope.locator(`[name="${name}"]`).first().inputValue();

		const undo = () => page.locator("[data-offer-undo]").click();
		const rows = page.locator("[data-milestone]");

		await page.goto(new URL(`/owner/requests/${REQUEST}`, targetUrl).href);
		await page
			.getByRole("button", { name: "Suggest an offer with AI" })
			.click();
		await release(await next());
		await page.waitForFunction(() =>
			document
				.querySelector("[data-offer-status]")
				?.textContent?.startsWith("Up to date"),
		);
		await page.mouse.move(2, 2);

		// restore-always: Undo of a Use keeps what the owner typed since.
		await card("outcome")
			.getByRole("button", { name: /^Use as outcome/ })
			.click();
		const used = await value("outcome");

		await page.locator('[name="outcome"]').fill(`${used} and sells merch`);
		await undo();
		check(
			"restore-always: Undo keeps an outcome the owner changed since",
			(await value("outcome")) === `${used} and sells merch`,
		);
		await page.locator('[name="outcome"]').fill("");

		// The same rule for a one-per-line field: only the line Use added goes.
		await card("inputs")
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		const inputs = page.locator('[name="clientInputs"]');

		await inputs.fill(`${await inputs.inputValue()}\nThe band's logo`);
		await undo();
		check(
			"Undo removes only the line Use added",
			(await inputs.inputValue()) === "The band's logo",
		);

		// name-only-empty: deliverables typed in a row without a name are not written over.
		await rows
			.first()
			.locator('[name="deliverables"]')
			.fill("Our own deliverable");
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		check(
			"name-only-empty: Use keeps deliverables typed in a row without a name",
			(await rows.first().locator('[name="deliverables"]').inputValue()) ===
				"Our own deliverable" && (await rows.count()) === 2,
		);

		// no-row-removal: Undo removes the row Use added.
		await undo();
		check(
			"no-row-removal: Undo removes the row Use added",
			(await rows.count()) === 1,
		);
		await rows.first().locator('[name="deliverables"]').fill("");

		// stale-used-in: after Undo, a milestone never takes another milestone's row.
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await undo();
		await card("milestones", 1)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();

		const names = await rows.evaluateAll((all) =>
			all.map((row) => row.querySelector('[name="milestoneName"]').value),
		);

		check(
			"stale-used-in: a milestone never takes another milestone's row",
			names.includes("Build and launch") && names.includes("Design direction"),
			names.join(" | "),
		);

		// fee-is-use: Set its fee fills the fee and nothing else. The first row holds "Build and launch" now.
		const first = rows.first();
		const firstName = await value("milestoneName", first);

		await first.locator('[name="deliverables"]').fill("Our own deliverables");

		const feeButton = page.getByRole("button", {
			name: new RegExp(`^Set its fee to .*: ${firstName}$`),
		});

		await feeButton.click();
		check(
			"fee-is-use: Set its fee fills only the fee",
			Number(await value("fee", first)) > 0 &&
				(await first.locator('[name="deliverables"]').inputValue()) ===
					"Our own deliverables",
		);
		await undo();
		await undo();

		// keep-only-proposed: an edited card can be used, and that Use can be undone.
		const timing = card("timing");

		await timing.getByRole("button", { name: /^Edit/ }).click();
		await timing
			.locator("[data-card-input]")
			.fill("About five weeks once the songs are in.");
		// Enter saves without passing focus through the Save button on its way to the card's Edit.
		await page.evaluate(() => {
			window.__focused = [];
			document.addEventListener("focusin", (event) =>
				window.__focused.push(event.target.textContent?.trim() ?? ""),
			);
		});
		await timing.locator("[data-card-input]").press("Enter");
		check(
			"Enter in a card editor saves without focusing Save on the way",
			!(await page.evaluate(() => window.__focused)).some((text) =>
				/^Save/.test(text),
			),
			(await page.evaluate(() => window.__focused)).join(" | "),
		);
		await timing.getByRole("button", { name: /^Use as timing/ }).click();
		const usedTiming = await value("timing");

		await undo();
		check(
			"keep-only-proposed: an edited card's Use fills the field and Undo empties it",
			usedTiming === "About five weeks once the songs are in." &&
				(await value("timing")) === "",
		);

		// detail-ignores-since: a reply sent before Undo reopened a card does not change its detail.
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await page.getByRole("button", { name: "Suggest again" }).click();
		const inFlight = await next();

		await undo();
		const reply = scriptedOfferReply(inFlight.request().postData());

		reply.cards = reply.cards.map((each) =>
			each.text === "Design direction"
				? {
						...each,
						ref: "",
						detail: { ...each.detail, daysLow: 9, daysHigh: 12 },
					}
				: each,
		);
		await page.mouse.move(2, 2);
		await release(inFlight, reply);
		await page.waitForTimeout(500);

		const days = await card("milestones", 0)
			.locator("[data-card-detail]")
			.textContent();

		check(
			"detail-ignores-since: a reply sent before Undo leaves the reopened card's days",
			/2 to 3 working days/.test(days) && !/9 to 12/.test(days),
		);

		// key-by-length: past the 40-step history, Undo never empties a field another step filled.
		await card("outcome")
			.getByRole("button", { name: /^Use as outcome/ })
			.click();
		const outcome = await value("outcome");

		const question = await card("questions")
			.locator("[data-card-text]")
			.textContent();

		for (let i = 0; i < 21; i++) {
			await card("questions")
				.getByRole("button", { name: /^Not this/ })
				.click();
			await page.locator("[data-offer-aside]").evaluate((element) => {
				element.open = true;
			});
			await page
				.getByRole("button", { name: `Bring back: ${question}` })
				.click();
		}

		for (
			let i = 0;
			i < 40 && !(await page.locator("[data-offer-undo]").isDisabled());
			i++
		)
			await undo();
		check(
			"key-by-length: Undo past the history's limit never empties a field another step filled",
			(await value("outcome")) === outcome,
		);

		// The second review's bugs, each on a fresh page so one case's rows never stand in another's way.
		const fresh = async () => {
			await page.goto(new URL(`/owner/requests/${REQUEST}`, targetUrl).href);
			await page
				.getByRole("button", { name: "Suggest an offer with AI" })
				.click();
			await release(await next());
			await page.waitForFunction(() =>
				document
					.querySelector("[data-offer-status]")
					?.textContent?.startsWith("Up to date"),
			);
			await page.mouse.move(2, 2);
		};

		// The day-value estimate counts milestones in the offer, not one only edited.
		await fresh();
		const build = card("milestones", 1);

		await build.getByRole("button", { name: /^Edit/ }).click();
		await build.locator("[data-card-input]").fill("Build and launch the site");
		await build.locator("[data-card-input]").press("Enter");

		const dayRow = await page.locator("[data-price-day]").textContent();

		check(
			"an edited milestone is not counted as used in the day-value estimate",
			/2 suggested milestones/.test(dayRow),
			dayRow.slice(0, 80),
		);

		// four-fields-only: Undo keeps a row Use added when the owner typed in its checkpoint.
		await fresh();
		await rows
			.first()
			.locator('[name="deliverables"]')
			.fill("Our own deliverable");
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();

		const added = rows.nth(1);

		await added.locator('[name="hasCheckpoint"]').check();
		await added.locator('[name="checkpointLabel"]').fill("Direction approved");
		await undo();
		check(
			"four-fields-only: Undo keeps a row whose checkpoint the owner filled in",
			(await rows.count()) === 2 &&
				(await value("checkpointLabel", rows.nth(1))) === "Direction approved",
		);

		// fee-no-step: Undo after Set its fee puts the fee back, and the next Undo empties the row.
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await page
			.getByRole("button", { name: /^Set its fee to .*: Design direction$/ })
			.click();

		const feeSet = await value("fee", rows.first());

		await undo();

		const feeAfter = await value("fee", rows.first());

		await undo();
		check(
			"fee-no-step: Undo puts the fee back, then the milestone",
			Number(feeSet) > 0 &&
				feeAfter === "" &&
				(await value("milestoneName", rows.first())) === "" &&
				(await rows.count()) === 1,
			`${feeSet} -> ${feeAfter}`,
		);

		// fee-any-row: once another milestone takes the row, Set its fee is not offered for the first.
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();

		for (const name of ["milestoneName", "deliverables", "acceptance"])
			await rows.first().locator(`[name="${name}"]`).fill("");

		await card("milestones", 1)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		check(
			"fee-any-row: a milestone whose row now holds another offers no fee",
			(await page
				.getByRole("button", { name: /^Set its fee to .*: Design direction$/ })
				.count()) === 0 &&
				(await value("milestoneName", rows.first())) === "Build and launch",
		);

		// The third review's bugs.
		// Use never throws away words typed in the card's open editor.
		await fresh();

		const outcomeCard = card("outcome");

		const outcomeText = await outcomeCard
			.locator("[data-card-text]")
			.textContent();

		await outcomeCard.getByRole("button", { name: /^Edit/ }).click();
		await outcomeCard
			.locator("[data-card-input]")
			.fill("A home for the band, with the shows first.");
		await outcomeCard.getByRole("button", { name: /^Use as outcome/ }).click();
		check(
			"Use with unsaved words in the card's editor keeps them and fills nothing",
			(await value("outcome")) === "" &&
				(await outcomeCard.locator("[data-card-input]").inputValue()) ===
					"A home for the band, with the shows first." &&
				(await outcomeCard.locator("[data-card-error]").isVisible()) &&
				(await outcomeCard
					.locator("[data-card-input]")
					.getAttribute("aria-invalid")) === "true",
			outcomeText.slice(0, 40),
		);

		// A reply waits while a card's editor is open, even with focus and the mouse elsewhere. This reply changes the
		// card being edited, so applying it would lose the words typed there.
		await page.getByRole("button", { name: "Suggest again" }).click();
		await page.mouse.move(2, 2);
		const changing = await next();
		const changed = scriptedOfferReply(changing.request().postData());

		changed.cards = changed.cards.map((each) =>
			each.lane === "outcome"
				? {
						...each,
						text: "A website for the band that sells merch and books shows",
					}
				: each,
		);
		await release(changing, changed);
		await page.waitForTimeout(500);
		check(
			"a reply waits while a card's editor is open",
			(await page.locator("[data-offer-held]").isVisible()) &&
				(await outcomeCard.locator("[data-card-input]").inputValue()) ===
					"A home for the band, with the shows first.",
		);
		await outcomeCard.getByRole("button", { name: "Cancel" }).click();

		// A partly typed number in a row Use added reads as typed: Undo keeps the row.
		await fresh();
		await rows
			.first()
			.locator('[name="deliverables"]')
			.fill("Our own deliverable");
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await rows.nth(1).locator('[name="fee"]').click();
		await page.keyboard.type("1e");
		await undo();
		// Undo empties the fields Use wrote and keeps the row with the owner's typing in it.
		check(
			"a partly typed fee keeps the row Use added",
			(await rows.count()) === 2 &&
				(await rows
					.nth(1)
					.locator('[name="fee"]')
					.evaluate((input) => input.validity.badInput)),
			`${await rows.count()} rows`,
		);

		// The fourth review's bugs.
		// A reply that changes only a milestone's days waits while the owner is among the cards.
		await fresh();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const daysOnly = await next();

		await card("milestones", 0).hover();

		const longer = scriptedOfferReply(daysOnly.request().postData());

		longer.cards = longer.cards.map((each) =>
			each.text === "Design direction"
				? { ...each, detail: { ...each.detail, daysLow: 6, daysHigh: 9 } }
				: each,
		);
		await release(daysOnly, longer);
		await page.waitForTimeout(500);
		check(
			"a reply that changes only a milestone's days waits while the owner is among the cards",
			(await page.locator("[data-offer-held]").isVisible()) &&
				/2 to 3 working days/.test(
					await card("milestones", 0)
						.locator("[data-card-detail]")
						.textContent(),
				),
		);
		await page.mouse.move(2, 2);

		// Set its fee is offered only while the row's fee differs from it.
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add with a fee/ })
			.click();

		const setDesignFee = page.getByRole("button", {
			name: /^Set its fee to .*: Design direction$/,
		});

		const offeredAtOnce = await setDesignFee.count();

		await rows.first().locator('[name="fee"]').fill("999");
		check(
			"Set its fee is offered only while the row's fee differs from it",
			offeredAtOnce === 0 && (await setDesignFee.count()) === 1,
			`${offeredAtOnce} then ${await setDesignFee.count()}`,
		);

		// Show updates never drops words typed in an open card editor.
		await fresh();

		const summaryCard = card("summary");

		await summaryCard.getByRole("button", { name: /^Edit/ }).click();
		await summaryCard
			.locator("[data-card-input]")
			.fill("My own summary, typed and not yet saved.");
		await page.getByRole("button", { name: "Suggest again" }).click();
		await page.mouse.move(2, 2);

		const replacing = await next();
		const replaced = scriptedOfferReply(replacing.request().postData());

		replaced.cards = replaced.cards.map((each) =>
			each.lane === "summary"
				? {
						...each,
						text: "Fans and venues find what they need in a few steps.",
					}
				: each,
		);
		await release(replacing, replaced);
		await page.waitForTimeout(500);
		await page.locator("[data-offer-held]").click();
		check(
			"Show updates never drops words typed in an open card editor",
			(await summaryCard.locator("[data-card-input]").inputValue()) ===
				"My own summary, typed and not yet saved." &&
				(await summaryCard.locator("[data-card-error]").isVisible()) &&
				(await page.locator("[data-offer-held]").isVisible()),
		);

		if (await summaryCard.locator("[data-card-editor]").isVisible())
			await summaryCard.getByRole("button", { name: "Cancel" }).click();

		// Undo never withdraws a card whose editor holds unsaved words (the Timing lane holds two).
		await fresh();

		const timingCard = (text) =>
			page.locator('[data-offer-lane="timing"] .offer-card', { hasText: text });

		const withTiming = (pending, texts) => {
			const sent = JSON.parse(pending.request().postData());
			const answer = scriptedOfferReply(pending.request().postData());

			for (const text of texts)
				answer.cards.push({
					ref: sent.cards.find((each) => each.text === text)?.ref ?? "",
					lane: "timing",
					text,
					reason: "",
					detail: null,
				});

			return answer;
		};

		const second = "About 5 weeks, with one round of changes.";
		const third = "About 6 weeks if the photos come late.";

		await page.getByRole("button", { name: "Suggest again" }).click();
		await page.mouse.move(2, 2);
		let pending = await next();

		await release(pending, withTiming(pending, [second]));
		await timingCard(second).waitFor();
		await timingCard("About 4 weeks")
			.getByRole("button", { name: /^Not this/ })
			.click();
		await page.getByRole("button", { name: "Suggest again" }).click();
		await page.mouse.move(2, 2);
		pending = await next();
		await release(pending, withTiming(pending, [second, third]));
		await timingCard(third).waitFor();
		await timingCard(third).getByRole("button", { name: /^Edit/ }).click();
		await timingCard(third)
			.locator("[data-card-input]")
			.fill("About six weeks, photos permitting.");
		await undo();
		const stillThere = (await timingCard(third).count()) === 1;

		check(
			"Undo never withdraws a card whose editor holds unsaved words",
			stillThere &&
				(await timingCard(third).locator("[data-card-input]").inputValue()) ===
					"About six weeks, photos permitting." &&
				(await timingCard(third).locator("[data-card-error]").isVisible()),
		);

		if (stillThere)
			await timingCard(third).getByRole("button", { name: "Cancel" }).click();

		// The fifth review's bugs.
		// Undo of a Bring back never loses words typed in that card's editor.
		await fresh();

		const outcomeWords = await card("outcome")
			.locator("[data-card-text]")
			.textContent();

		await card("outcome")
			.getByRole("button", { name: /^Not this/ })
			.click();
		await page.locator("[data-offer-aside]").evaluate((element) => {
			element.open = true;
		});
		await page
			.getByRole("button", { name: `Bring back: ${outcomeWords}` })
			.click();
		await card("outcome").getByRole("button", { name: /^Edit/ }).click();
		await card("outcome")
			.locator("[data-card-input]")
			.fill("A band site that books shows, in our words.");
		await undo();

		const broughtBack = (await card("outcome").count()) === 1;

		check(
			"Undo of a Bring back never loses words typed in that card's editor",
			broughtBack &&
				(await card("outcome").locator("[data-card-input]").inputValue()) ===
					"A band site that books shows, in our words." &&
				(await card("outcome").locator("[data-card-error]").isVisible()),
		);
		check(
			"a refused Undo leaves focus on the field that needs attention, not on Undo",
			broughtBack &&
				(await card("outcome")
					.locator("[data-card-input]")
					.evaluate((input) => document.activeElement === input)),
		);

		if (broughtBack)
			await card("outcome").getByRole("button", { name: "Cancel" }).click();

		// A row holding only a partly typed fee is not empty: Add with a fee adds a row instead.
		await fresh();
		await rows.first().locator('[name="fee"]').click();
		await page.keyboard.type("1e");
		await card("milestones", 0)
			.getByRole("button", { name: /^Add with a fee/ })
			.click();
		check(
			"Add with a fee never writes over a partly typed fee",
			(await rows.count()) === 2 &&
				(await rows
					.first()
					.locator('[name="fee"]')
					.evaluate((input) => input.validity.badInput)) &&
				(await value("milestoneName", rows.nth(1))) === "Design direction",
			`${await rows.count()} rows`,
		);

		// The whole-project range is never filled below the offer's total, which the offer editor refuses.
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add with a fee/ })
			.click();
		await card("milestones", 1)
			.getByRole("button", { name: /^Add with a fee/ })
			.click();
		await page
			.locator("[data-price-day]")
			.getByRole("button", { name: /^Use as the whole-project range/ })
			.click();
		check(
			"the whole-project range is never filled below the offer's total, and says why beside the button, in view",
			(await page.locator('[name="rangeLow"]').inputValue()) === "" &&
				/must start at the offer total/.test(
					await page.locator("[data-price-said]").textContent(),
				) &&
				(await page.locator("[data-price-said]").evaluate((line) => {
					const box = line.getBoundingClientRect();

					return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
				})),
		);

		// The sixth review's bug: Edit pressed again, or Not this, never drops words typed in the card's open editor.
		await fresh();

		const editing = card("summary");

		await editing.getByRole("button", { name: /^Edit/ }).click();
		await editing
			.locator("[data-card-input]")
			.fill("Our own summary, not saved yet.");
		await editing.getByRole("button", { name: /^Edit/ }).click();

		const afterEdit = await editing.locator("[data-card-input]").inputValue();

		await editing.getByRole("button", { name: /^Not this/ }).click();

		const stillEditing = (await card("summary").count()) === 1;

		check(
			"Edit pressed again, or Not this, never drops words typed in the card's open editor",
			afterEdit === "Our own summary, not saved yet." &&
				stillEditing &&
				(await card("summary").locator("[data-card-input]").inputValue()) ===
					"Our own summary, not saved yet." &&
				(await card("summary").locator("[data-card-error]").isVisible()),
			afterEdit,
		);

		if (stillEditing)
			await card("summary").getByRole("button", { name: "Cancel" }).click();

		// The seventh review's bugs: Undo names Keep for what it did, and an edit that changes nothing is not a step.
		await fresh();
		await card("drivers").getByRole("button", { name: /^Keep/ }).click();

		const afterKeep = await page
			.locator("[data-offer-undo]")
			.getAttribute("aria-label");

		await card("summary").getByRole("button", { name: /^Edit/ }).click();
		await card("summary").locator("[data-card-input]").press("Enter");
		check(
			"Undo names Keep, and an unchanged edit is not a step",
			/^Undo: kept /.test(afterKeep ?? "") &&
				(await page.locator("[data-offer-status]").textContent()) ===
					"No change to the card." &&
				(await page.locator("[data-offer-undo]").getAttribute("aria-label")) ===
					afterKeep,
			afterKeep ?? "",
		);

		// The ninth review's bug: a reply that adds one milestone is one update, not two.
		await fresh();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const addingOne = await next();

		await card("outcome").hover();

		const oneMore = scriptedOfferReply(addingOne.request().postData());

		oneMore.cards.push({
			ref: "",
			lane: "milestones",
			text: "Content migration",
			reason: "Old posts move over",
			detail: {
				deliverables: ["Old posts moved to the new site"],
				acceptance: ["Open any old post on the new site"],
				daysLow: 1,
				daysHigh: 2,
			},
		});
		await release(addingOne, oneMore);
		await page.waitForTimeout(500);

		const heldLabel = await page.locator("[data-held-label]").textContent();

		check(
			"a reply that adds one milestone is held as one update",
			heldLabel === "Show 1 update",
			heldLabel ?? "",
		);
		await page.mouse.move(2, 2);

		// The tenth review's bug: a milestone reworded and given new days is one update, not two.
		await fresh();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const rewording = await next();

		await card("outcome").hover();

		const reworded = scriptedOfferReply(rewording.request().postData());

		reworded.cards = reworded.cards.map((each) =>
			each.text === "Design direction"
				? {
						...each,
						reason: "Smaller first",
						detail: { ...each.detail, daysLow: 4, daysHigh: 6 },
					}
				: each,
		);
		await release(rewording, reworded);
		await page.waitForTimeout(500);

		const rewordedLabel = await page.locator("[data-held-label]").textContent();

		check(
			"a milestone reworded and given new days is held as one update",
			rewordedLabel === "Show 1 update",
			rewordedLabel ?? "",
		);
		await page.mouse.move(2, 2);

		// The tenth interface review's bug: at phone width a held reply moves nothing (its button keeps its place).
		await page.setViewportSize({ width: 320, height: 844 });
		await fresh();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const narrow = await next();

		await card("outcome").hover();

		// Measured in the page, not the viewport: Chrome's scroll anchoring can keep a moved card still on screen.
		const pageTop = () =>
			card("outcome").evaluate(
				(element) => element.getBoundingClientRect().top + window.scrollY,
			);

		const outcomeTop = await pageTop();
		const moving = scriptedOfferReply(narrow.request().postData());

		moving.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		await release(narrow, moving);
		await page.waitForTimeout(500);
		check(
			"at 320 px a held reply moves no card",
			(await page.locator("[data-offer-held]").isVisible()) &&
				Math.abs((await pageTop()) - outcomeTop) < 1,
			`${outcomeTop} -> ${await pageTop()}`,
		);
		await page.mouse.move(2, 2);
		await page.setViewportSize({ width: 1280, height: 800 });

		// retry-on-fail: after a failure the board asks again only when the owner presses Suggest.
		await page.getByRole("button", { name: "Suggest again" }).click();
		(await next()).fulfill({
			status: 503,
			json: { ok: false, error: "The AI is busy right now." },
		});
		await page.waitForTimeout(400);
		await page.locator('[name="summary"]').fill("Something new to ask about.");
		await page.waitForTimeout(14000);
		check(
			"retry-on-fail: no request follows a failure on its own",
			queue.length === 0,
		);

		// A reply never scrolls the page: Chromium's scroll anchoring would follow a card inside the cards' box and move the
		// prices the owner is reading off screen (the twenty-sixth review).
		await page.goto(new URL(`/owner/requests/${REQUEST}`, targetUrl).href);
		await page.mouse.move(2, 2);
		await page.evaluate(() => {
			const heading = document.querySelector("#offer-pricing-title");

			window.scrollBy(
				0,
				heading.getBoundingClientRect().top - innerHeight * 0.3,
			);
			document
				.querySelector("[data-offer-ask]")
				?.focus({ preventScroll: true });
		});

		const headingTop = () =>
			page.evaluate(
				() =>
					document.querySelector("#offer-pricing-title").getBoundingClientRect()
						.top,
			);

		const readingAt = await headingTop();

		await page.keyboard.press("Enter");
		await release(await next());
		await page.waitForFunction(() =>
			document
				.querySelector("[data-offer-status]")
				?.textContent?.startsWith("Up to date"),
		);
		check(
			"a reply never scrolls the page away from the prices the owner is reading",
			Math.abs((await headingTop()) - readingAt) < 5,
			`${readingAt} -> ${await headingTop()}`,
		);

		// A reply held while focus is among the cards lands before a mouse press on Suggest, so the request that press
		// sends carries the held card (the twenty-fourth review: a press in progress kept it waiting until after).
		await fresh();
		await card("outcome")
			.getByRole("button", { name: /^Use as outcome/ })
			.click();
		await page.mouse.move(2, 2);

		const waiting = await next(20000);
		const heldReply = scriptedOfferReply(waiting.request().postData());

		heldReply.cards.push({
			ref: "",
			lane: "questions",
			text: "Will the band sell tickets on the site?",
			reason: "",
			detail: null,
		});
		await release(waiting, heldReply);
		await page.waitForFunction(
			() =>
				!document.querySelector("[data-offer-held]")?.hasAttribute("data-idle"),
		);
		await page.getByRole("button", { name: "Suggest again" }).click();

		const pressedRequest = await next();

		check(
			"a held reply lands before a mouse press on Suggest, so its request carries the held card",
			Boolean(
				pressedRequest
					?.request()
					.postData()
					?.includes("Will the band sell tickets on the site?"),
			),
		);

		if (pressedRequest) await release(pressedRequest);

		// A finger on the cards holds a reply until they have been still for a moment, so nothing moves under it (the
		// twenty-seventh review: a touch scroll did not count, and cards jumped up to 314 px under the finger). Touch is
		// emulated on this page for the check only.
		await page.setViewportSize({ width: 390, height: 844 });
		await fresh();

		const touch = await page.context().newCDPSession(page);

		await touch.send("Emulation.setTouchEmulationEnabled", {
			enabled: true,
			maxTouchPoints: 1,
		});
		await page.evaluate(() =>
			document
				.querySelector("#offer-board-title")
				.scrollIntoView({ block: "start" }),
		);
		await page.getByRole("button", { name: "Suggest again" }).click();

		const underFinger = await next();
		const scroller = await page.locator("[data-offer-scroll]").boundingBox();

		const finger = {
			x: scroller.x + 120,
			y: scroller.y + scroller.height - 120,
		};

		await touch.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [finger],
		});

		for (let step = 1; step <= 6; step++) {
			await touch.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: finger.x, y: finger.y - step * 25 }],
			});
			await page.waitForTimeout(40);
		}

		const milestoneTop = () =>
			card("milestones").evaluate(
				(element) => element.getBoundingClientRect().top,
			);

		const isHeld = () =>
			page
				.locator("[data-offer-held]")
				.evaluate((element) => !element.hasAttribute("data-idle"));

		const fingerTop = await milestoneTop();
		const moreCards = scriptedOfferReply(underFinger.request().postData());

		moreCards.cards.unshift({
			ref: "",
			lane: "outcome",
			text: "A band website that sells out shows and keeps fans coming back",
			reason: "",
			detail: null,
		});
		await release(underFinger, moreCards);
		// The finger rests, still down, past the 3 seconds a lifted finger holds a reply for (the twenty-eighth review).
		await page.waitForTimeout(3500);

		const heldUnderFinger =
			(await isHeld()) && Math.abs((await milestoneTop()) - fingerTop) < 1;

		await touch.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await page.waitForTimeout(3500);
		check(
			"a finger on the cards holds a reply while it is down, which lands once they have been still for 3 seconds",
			heldUnderFinger && !(await isHeld()),
			`${fingerTop} -> ${await milestoneTop()}`,
		);
		await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
		await touch.detach();
		await page.setViewportSize({ width: 1280, height: 800 });

		// A field below the board keeps its place while the owner types in it and a reply redraws the prices above it (the
		// twenty-seventh review: the offer editor's Summary jumped 22 to 44 px between two typed words).
		await fresh();
		await page.evaluate(() => {
			const field = document.querySelector('[name="summary"]');

			window.scrollBy(0, field.getBoundingClientRect().top - 440);
		});
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");

		const following = await next(20000);

		await page.keyboard.type(" and find");

		const fieldTop = () =>
			page
				.locator('[name="summary"]')
				.first()
				.evaluate((element) => element.getBoundingClientRect().top);

		const typingTop = await fieldTop();
		const longerReason = scriptedOfferReply(following.request().postData());

		longerReason.sizeReason =
			"Four pages, a booking form that emails the band, and a mailing list sign-up";
		await release(following, longerReason);
		await page.waitForTimeout(600);
		await page.keyboard.type(" shows");
		check(
			"a field below the board keeps its place while a reply redraws the prices above it",
			Math.abs((await fieldTop()) - typingTop) < 1,
			`${typingTop} -> ${await fieldTop()}`,
		);

		// The same without scroll anchoring (as in Safari), at phone width, where the status line also changes height after
		// the redraw (the twenty-eighth review: the field moved 22 px when the line shrank).
		await page.setViewportSize({ width: 390, height: 844 });
		await fresh();
		await page.addStyleTag({
			content: "* { overflow-anchor: none !important; }",
		});
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await card("milestones", 0)
			.getByRole("button", { name: /^Not this/ })
			.click();
		await page.mouse.move(2, 2);

		const longLine = await page.locator("[data-offer-status]").textContent();

		await page.evaluate(() => {
			const field = document.querySelector('[name="summary"]');

			window.scrollBy(0, field.getBoundingClientRect().top - 440);
		});
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");

		const unanchored = await next(20000);
		const unanchoredTop = await fieldTop();
		const extraQuestion = scriptedOfferReply(unanchored.request().postData());

		extraQuestion.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		await release(unanchored, extraQuestion);
		await page.waitForTimeout(600);
		check(
			"without scroll anchoring, a field below the board keeps its place through the redraw and the status line",
			Math.abs((await fieldTop()) - unanchoredTop) < 1,
			`${longLine} | ${unanchoredTop} -> ${await fieldTop()} | ${await page.locator("[data-offer-status]").textContent()}`,
		);
		await page.setViewportSize({ width: 1280, height: 800 });

		// The day-value row follows the editor's milestone rows: removing a used milestone's row (the editor's Remove fires
		// no input event) takes its days out at once, and renaming a row keeps them (the twenty-eighth review: the row kept
		// the removed milestone, and a rename dropped one).
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await card("milestones", 1)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await page.mouse.move(2, 2);

		await rows
			.first()
			.locator('[name="milestoneName"]')
			.fill("Our own name for it");

		const renamed = await page.locator("[data-price-day]").textContent();
		const afterRename = await next(20000);

		if (afterRename) await release(afterRename);

		await page.waitForFunction(() =>
			document
				.querySelector("[data-offer-status]")
				?.textContent?.startsWith("Up to date"),
		);
		await rows.last().locator("[data-remove-milestone]").click();

		const removed = await page.locator("[data-price-day]").textContent();

		check(
			"the day-value row keeps a renamed milestone and drops a removed one at once",
			/for 2 used milestones/.test(renamed) &&
				/for 1 used milestone\b/.test(removed),
			`${renamed} | ${removed}`,
		);

		// A row the owner emptied by hand and another milestone filled counts once (the twenty-ninth review: the day-value
		// row added the first milestone's days to the second's).
		await fresh();
		await card("milestones", 0)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();
		await page.mouse.move(2, 2);

		for (const name of ["milestoneName", "deliverables", "acceptance", "fee"])
			await rows.first().locator(`[name="${name}"]`).fill("");

		const emptiedRow = await page.locator("[data-price-day]").textContent();
		const emptied = await next(20000);

		if (emptied) await release(emptied);

		await page.waitForFunction(() =>
			document
				.querySelector("[data-offer-status]")
				?.textContent?.startsWith("Up to date"),
		);
		await card("milestones", 1)
			.getByRole("button", { name: /^Add to the offer/ })
			.click();

		const refilled = await page.locator("[data-price-day]").textContent();

		check(
			"a row emptied by hand stops counting, and filled by another milestone counts one",
			!/used milestone/.test(emptiedRow) &&
				(await rows.count()) === 1 &&
				/for 1 used milestone\b/.test(refilled),
			`${emptiedRow} | ${refilled}`,
		);

		// "Show N updates" keeps its size whatever it says, so the header never gains or loses a row when it appears (the
		// twenty-ninth review: at 340 px the idle label took a second row the shorter one did not need, and the cards moved
		// 54 px under the pointer; at 400 px the same with the first reply held).
		const scrollerTop = () =>
			page
				.locator("[data-offer-scroll]")
				.evaluate(
					(element) => element.getBoundingClientRect().top + window.scrollY,
				);

		await page.setViewportSize({ width: 340, height: 844 });
		await fresh();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const at340 = await next();

		await card("outcome").hover();

		const top340 = await scrollerTop();
		const held340 = scriptedOfferReply(at340.request().postData());

		held340.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		await release(at340, held340);
		await page.waitForTimeout(500);

		const moved340 = (await scrollerTop()) - top340;
		const shown340 = await page.locator("[data-offer-held]").isVisible();

		await page.mouse.move(2, 2);
		await page.setViewportSize({ width: 400, height: 844 });
		await page.goto(new URL(`/owner/requests/${REQUEST}`, targetUrl).href);
		await page
			.getByRole("button", { name: "Suggest an offer with AI" })
			.click();

		const at400 = await next();

		await page.locator("[data-offer-scroll]").hover();

		const top400 = await scrollerTop();

		await release(at400);
		await page.waitForTimeout(500);
		check(
			"Show N updates appears without moving the cards at 340 and 400 px",
			shown340 &&
				Math.abs(moved340) < 1 &&
				(await page.locator("[data-offer-held]").isVisible()) &&
				Math.abs((await scrollerTop()) - top400) < 1,
			`${moved340} ${(await scrollerTop()) - top400}`,
		);
		await page.mouse.move(2, 2);
		await page.setViewportSize({ width: 1280, height: 800 });

		// Without scroll anchoring (as in Safari), with the board wholly above the screen and nothing focused, a reply moves
		// nothing below it (the twenty-ninth review: the editor's milestones moved 44 px).
		await fresh();
		await page.addStyleTag({
			content: "* { overflow-anchor: none !important; }",
		});
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");
		await page.evaluate(() => {
			document.activeElement.blur();
			window.scrollBy(
				0,
				document.querySelector("[data-offer-board]").getBoundingClientRect()
					.bottom + 10,
			);
		});

		const below = await next(20000);

		const belowTop = () =>
			page
				.locator('[name="summary"]')
				.first()
				.evaluate((element) => element.getBoundingClientRect().top);

		const belowAt = await belowTop();
		const grown = scriptedOfferReply(below.request().postData());

		grown.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		grown.sizeReason =
			"Four pages, a booking form that emails the band, and a mailing list sign-up";
		await release(below, grown);
		await page.waitForTimeout(600);
		check(
			"without scroll anchoring, a reply moves nothing below a board that is above the screen",
			Math.abs((await belowTop()) - belowAt) < 1,
			`${belowAt} -> ${await belowTop()}`,
		);

		// A reply never scrolls the page to keep a focused field that is out of view: someone reading the board above it
		// keeps their place (the twenty-eighth review: the board jumped up by the price rows' growth).
		await fresh();
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");
		await page.mouse.move(2, 2);
		await page.evaluate(() =>
			document
				.querySelector("#offer-board-title")
				.scrollIntoView({ block: "start" }),
		);

		const headingAt = () =>
			page.evaluate(
				() =>
					document.querySelector("#offer-board-title").getBoundingClientRect()
						.top,
			);

		const summaryHidden = await page.evaluate(
			() =>
				document.querySelector('[name="summary"]').getBoundingClientRect()
					.top >= window.innerHeight,
		);

		const readingTop = await headingAt();
		const unseen = await next(20000);
		const growing = scriptedOfferReply(unseen.request().postData());

		growing.sizeReason =
			"Four pages, a booking form that emails the band, and a mailing list sign-up";
		await release(unseen, growing);
		await page.waitForTimeout(600);
		check(
			"a reply never scrolls the page to keep a focused field that is out of view",
			summaryHidden && Math.abs((await headingAt()) - readingTop) < 1,
			`${summaryHidden} ${readingTop} -> ${await headingAt()}`,
		);

		// A focused field beside the board (the right-hand column) keeps its place when the board, scrolled above the
		// screen, grows (the thirtieth review: the decline message moved 43 px).
		await page.setViewportSize({ width: 1280, height: 600 });
		await fresh();
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");
		await page.locator("#software-decline").click();
		await page.keyboard.type("Thank you for");
		await page.mouse.move(2, 2);
		await page.evaluate(() =>
			window.scrollBy(
				0,
				document.querySelector("[data-offer-board]").getBoundingClientRect()
					.bottom + 5,
			),
		);

		const besideTop = () =>
			page
				.locator("#software-decline")
				.evaluate((element) => element.getBoundingClientRect().top);

		const besideSeen = await page.evaluate(() => {
			const box = document
				.querySelector("#software-decline")
				.getBoundingClientRect();

			return box.bottom > 0 && box.top < window.innerHeight;
		});

		const besideReply = await next(20000);
		const besideAt = await besideTop();
		const taller = scriptedOfferReply(besideReply.request().postData());

		taller.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		taller.sizeReason =
			"Four pages, a booking form that emails the band, and a mailing list sign-up";
		await release(besideReply, taller);
		await page.waitForTimeout(600);
		check(
			"a focused field beside the board keeps its place when the board above the screen grows",
			besideSeen && Math.abs((await besideTop()) - besideAt) < 1,
			`${besideSeen} ${besideAt} -> ${await besideTop()}`,
		);
		await page.setViewportSize({ width: 1280, height: 800 });

		// At 200% text the owner header never scrolls sideways (the thirtieth review: Pricing widened the widths at which it
		// did, pushing the link or the owner's address off screen).
		await page.goto(new URL("/owner/pricing", targetUrl).href);
		await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

		const sideways = [];

		for (const width of [720, 870, 1000, 1100, 1160]) {
			await page.setViewportSize({ width, height: 800 });

			if (
				await page.evaluate(() =>
					[...document.querySelectorAll(".owner-header *")].some(
						(element) =>
							element.getBoundingClientRect().right >
							document.documentElement.clientWidth + 1,
					),
				)
			)
				sideways.push(width);
		}

		check(
			"at 200% text the owner header never scrolls sideways",
			sideways.length === 0,
			sideways.join(", "),
		);
		await page.setViewportSize({ width: 1280, height: 800 });

		// "Show N updates" never leaves an untouched open editor with its card's old words, so Save cannot write them back as
		// the owner's edit (the thirty-first review).
		await fresh();
		await card("outcome").getByRole("button", { name: /^Edit/ }).click();
		await page.getByRole("button", { name: "Suggest again" }).click();

		const rewordRequest = await next();
		const rewordReply = scriptedOfferReply(rewordRequest.request().postData());

		rewordReply.cards[0].text = "A band website that books more shows";
		await release(rewordRequest, rewordReply);
		await page.waitForTimeout(400);
		await page.locator("[data-offer-held]").click();

		const followed = await card("outcome")
			.locator("[data-card-input]")
			.inputValue();

		check(
			"Show N updates gives an untouched open editor its card's new words",
			followed === "A band website that books more shows",
			followed,
		);

		// A click on plain text focuses the page's main column, which holds the board: it is no field to keep, so with the
		// board above the screen nothing below it moves (the thirty-first review: the editor moved 43 px).
		await fresh();
		await page.locator('[name="summary"]').first().click();
		await page.keyboard.type("Fans hear new music");
		await page.evaluate(() => {
			window.scrollBy(
				0,
				document.querySelector("[data-offer-board]").getBoundingClientRect()
					.bottom + 10,
			);
			document.querySelector("#owner-main").focus({ preventScroll: true });
		});

		const mainFocused = await page.evaluate(
			() => document.activeElement?.id === "owner-main",
		);

		const underMain = await next(20000);

		const editorTop = () =>
			page
				.locator('[name="summary"]')
				.first()
				.evaluate((element) => element.getBoundingClientRect().top);

		const editorAt = await editorTop();
		const longerMarket = scriptedOfferReply(underMain.request().postData());

		longerMarket.sizeReason =
			"Four pages, a booking form that emails the band, and a mailing list sign-up";
		longerMarket.cards.push({
			ref: "",
			lane: "questions",
			text: "Does the band sell merch at shows?",
			reason: "",
			detail: null,
		});
		await release(underMain, longerMarket);
		await page.waitForTimeout(600);
		check(
			"with the page's main column focused, a reply moves nothing below a board above the screen",
			mainFocused && Math.abs((await editorTop()) - editorAt) < 1,
			`${mainFocused} ${editorAt} -> ${await editorTop()}`,
		);

		// At the page's limit the board says it no longer follows the draft, the first time the draft moves on.
		await page.goto(new URL(`/owner/requests/${REQUEST}`, targetUrl).href);
		await page
			.getByRole("button", { name: "Suggest an offer with AI" })
			.click();
		await release(await next());

		for (let press = 1; press < 12; press++) {
			await page.waitForFunction(() =>
				document
					.querySelector("[data-offer-status]")
					?.textContent?.startsWith("Up to date"),
			);
			await page.getByRole("button", { name: "Suggest again" }).click();
			await release(await next());
		}

		await page.waitForFunction(() =>
			document
				.querySelector("[data-offer-status]")
				?.textContent?.startsWith("Up to date"),
		);
		await page.mouse.move(2, 2);
		await page.locator('[name="summary"]').fill("A late change to the draft.");
		await page.waitForTimeout(500);
		check(
			"at the page's limit the board says it no longer follows the draft",
			/no longer follows your draft/.test(
				await page.locator("[data-offer-status]").textContent(),
			) && queue.length === 0,
			await page.locator("[data-offer-status]").textContent(),
		);
		check("no page errors", errors.length === 0, errors.join("; "));
	} catch (error) {
		await page
			.screenshot({
				path: path.join(artifactDir, "_failure-offer-board.png"),
				fullPage: true,
			})
			.catch(() => {});

		throw error;
	} finally {
		await browser.close();
		issuer.close();
	}

	if (failures.length) throw new Error(`Failed: ${failures.join("; ")}`);
	console.log("offer board browser checks: PASS");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
