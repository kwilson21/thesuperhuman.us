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
		// Put the field back, so leaving the page raises no unsaved-changes warning.
		await contingency.fill(contingencyBefore);
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
		await timing.locator("[data-card-input]").press("Enter");
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
			"the whole-project range is never filled below the offer's total",
			(await page.locator('[name="rangeLow"]').inputValue()) === "" &&
				/must start at the offer total/.test(
					await page.locator("[data-offer-status]").textContent(),
				),
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

		const heldLabel = await page.locator("[data-offer-held]").textContent();

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

		const rewordedLabel = await page.locator("[data-offer-held]").textContent();

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
