// The living brief's board (docs/plans/2026-11-living-brief.md) on a fictional website brief, at both widths: cards
// arriving while the visitor writes, the visitor's choices, a reply held while they are in the board, the review with
// the outline, the plain form, and the owner's readback. The board's route is answered locally by the scripted
// interpreter (../brief-board-script.mjs), a little late, as the model would be; no model is called and nothing is sent.
import { scriptedReply } from "../brief-board-script.mjs";
import { stubTurnstile } from "../turnstile-stub.mjs";

const PURPOSE =
	"A home for my band on the web. Fans should hear new music, see upcoming shows near them and join the mailing list. Venues need a quick way to book us.";

const MORE = " We also sell merch at shows and want photos from tour.";

const OUTLINE = [
	{
		lane: "purpose",
		text: "A home for my band on the web",
		origin: "answers",
		quote: "A home for my band on the web",
	},
	{
		lane: "audience",
		text: "Fans",
		origin: "answers",
		quote: "Fans should hear new music",
	},
	{ lane: "parts", text: "Shows", origin: "kept", quote: undefined },
	{
		lane: "parts",
		text: "Music",
		origin: "answers",
		quote: "hear new music, see upcoming",
	},
	{ lane: "parts", text: "Press kit", origin: "wrote" },
	{
		lane: "questions",
		text: "Do you sell tickets on the site, or link to a ticket seller?",
		origin: "kept",
		answer: "We link to a ticket seller.",
	},
].map(({ quote, ...item }) => (quote ? { ...item, quote } : item));

/** A suggested question and a note that each end their own sentence, for the board's messages that quote a card. */
const QUESTION = "Who will add new show dates?";
const NOTE = "Fans hear new songs first.";

/**
 * Each message that quotes a card (Kept, Set aside, Brought back, Removed, Undid) ends its sentence once: no period
 * after a quote that already ends in "?" or ".", and one after a quote that does not. Every action is undone, so the
 * board keeps the same cards. The Undid message that also names the cards Undo withdrew is not reached here.
 */
async function quotesEndOnce(page) {
	const live = page.locator("[data-board-live]");
	const aside = page.locator("[data-board-aside]");

	const said = async (expected) => {
		const text = await live.textContent();

		if (text !== expected)
			throw new Error(
				`The board said ${JSON.stringify(text)}, not ${JSON.stringify(expected)}`,
			);
	};

	const press = async (name, expected) => {
		await page.getByRole("button", { name, exact: true }).click();
		await said(expected);
	};

	const undo = async (expected) => {
		await page.locator("[data-board-undo]").click();
		await said(expected);
	};

	// A suggested card: Keep, Not this and Bring back, each undone. `end` is what must follow its quote.
	const card = async (text, end) => {
		await press(`Keep: ${text}`, `Kept “${text}”${end}`);
		await undo(`Undid: kept “${text}”${end}`);
		await press(
			`Not this: ${text}`,
			`Set aside “${text}”${end} Undo or Bring back restores it.`,
		);

		if (!(await aside.evaluate((list) => list.open)))
			await page.locator("[data-board-aside-summary]").click();
		await press(`Bring back: ${text}`, `Brought back “${text}”${end}`);
		await undo(`Undid: brought back “${text}”${end}`);
		await undo(`Undid: set aside “${text}”${end}`);
	};

	// The visitor's own note: added with the lane's Add, removed, and both undone.
	const note = async (add, text, end) => {
		await page.getByRole("button", { name: add }).click();
		await page.keyboard.type(text);
		await page.keyboard.press("Enter");
		await press(
			`Remove: ${text}`,
			`Removed “${text}”${end} Undo brings it back.`,
		);
		await undo(`Undid: removed “${text}”${end}`);
		await undo(`Undid: added “${text}”${end}`);
	};

	await card("Shows", ".");
	await card(QUESTION, "");
	await note("Add a page", "Press kit", ".");
	await note(/^Add what it/, NOTE, "");
}

export default {
	title: "Living brief board",
	async run({ capture, sql }) {
		sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES ('screenshot-board','software','website','Sam Example','sam@example.com','A home for my band on the web.',
      '${JSON.stringify({ path: "website", purpose: PURPOSE, currentUrl: "", existing: "", updates: "self", company: "", timing: "flexible", timingDate: "", budgetNote: "", clientCopyStatus: "sent", outline: OUTLINE }).replaceAll("'", "''")}',
      'new','','2026-11-15T12:00:00.000Z','2026-11-15T12:00:00.000Z','00000000-0000-4000-8000-000000000042')`);
		const steps = [];

		for (const viewport of ["desktop", "phone"]) {
			/** Opens the brief at the website's first question with the board's route answered locally, 400 ms late. */
			const open = async (page) => {
				await page.route("**/api/software/brief/pass", (route) =>
					route.fulfill({ json: { ok: true } }),
				);
				await page.route("**/api/software/brief/suggest", (route) =>
					route.fulfill({ json: { suggestion: "" } }),
				);
				await page.route("**/api/software/brief/board", async (route) => {
					const body = route.request().postData() ?? "{}";

					await new Promise((resolve) => setTimeout(resolve, 400));
					await route.fulfill({ json: scriptedReply(body) });
				});
				await stubTurnstile(page);
				await page.addInitScript(() => {
					localStorage.removeItem("software-brief-draft");
					localStorage.removeItem("software-brief-board");
					localStorage.removeItem("software-suggestions");
				});
				await page.reload();
				await page.waitForFunction(() => !!window.turnstile);
			};

			const write = async (page, text) => {
				const box = page.locator('[data-step="1"] textarea');

				await box.click();
				await box.pressSequentially(text, { delay: 2 });
				await page.waitForFunction(
					() =>
						document
							.querySelector("[data-board-status]")
							?.textContent?.startsWith("Up to date"),
					undefined,
					{ timeout: 20000 },
				);
				// New cards rise in over 180 ms and keep an accent edge for 1.6 s; measure and capture once they have settled.
				await page.waitForFunction(
					() => !document.querySelector(".board-card.is-new"),
				);
			};

			const choose = async (page) => {
				await page.getByRole("button", { name: "Keep: Shows" }).click();
				await page.getByRole("button", { name: "Not this: Contact" }).click();
				await page
					.getByRole("button", { name: /^Answer: Do you sell tickets/ })
					.click();
				await page.keyboard.type("We link to a ticket seller.");
				await page.keyboard.press("Enter");
				await page.getByRole("button", { name: "Add a page" }).click();
				await page.keyboard.type("Press kit");
				await page.keyboard.press("Enter");
			};

			const shot = async (name, caption, prepare, extra = {}) =>
				steps.push({
					title: `${caption}, ${viewport}`,
					images: [
						{
							file: await capture({
								file: `software-board-${name}-${viewport}.png`,
								path: "/software/start?path=website",
								viewport,
								prepare,
								...extra,
							}),
							caption,
						},
					],
				});

			await shot(
				"writing",
				"Cards arrive while the visitor writes",
				async (page) => {
					await open(page);
					await write(page, PURPOSE);

					if ((await page.locator(".board-card").count()) < 5)
						throw new Error("The board did not fill in while writing");
				},
			);

			await shot(
				"chosen",
				"Kept, set aside, answered and added by the visitor",
				async (page) => {
					await open(page);
					await write(page, PURPOSE);
					await choose(page);

					if (!(await page.locator("[data-board-aside]").isVisible()))
						throw new Error("The set-aside list did not appear");
				},
			);

			await shot(
				"held",
				"A reply held while the visitor is in the board",
				async (page) => {
					await open(page);
					await write(page, PURPOSE);
					const edit = page.getByRole("button", { name: "Edit: Music" });

					await edit.focus();
					const before = await edit.boundingBox();

					await page
						.locator('[data-step="1"] textarea')
						.evaluate((box, more) => {
							box.value += more;
							box.dispatchEvent(new Event("input", { bubbles: true }));
						}, MORE);
					await edit.focus();
					await page.locator("[data-board-held]").waitFor({ timeout: 20000 });
					const after = await edit.boundingBox();

					if (JSON.stringify(before) !== JSON.stringify(after))
						throw new Error("A held reply moved the focused control");
				},
			);

			await shot(
				"review",
				"The outline in the review, before sending",
				async (page) => {
					await open(page);
					await write(page, PURPOSE);
					await choose(page);
					await page.locator("[data-next]").click();
					await page.locator('[data-step="7"] [data-skip]').click();
					await page.locator("[name=updates][value=self]").check();
					await page.locator("[data-next]").click();
					await page.locator("[data-next]").click();
					await page.locator('[data-step="4"] [data-skip]').click();
					await page.locator("[name=name]").fill("Sam Example");
					await page.locator("[name=email]").fill("sam@example.com");
					await page.locator("[data-next]").click();
					await page.locator('[data-step="6"]:visible').waitFor();
					const review = await page.locator("[data-review]").innerText();

					if (!review.includes("Brief outline") || review.includes("Contact ·"))
						throw new Error(
							"The review does not show the outline as it will be sent",
						);
				},
			);

			await shot(
				"plain",
				"The plain form, with the board hidden",
				async (page) => {
					await open(page);
					await write(page, PURPOSE);

					// The check runs in this step because the plain form hides the board before the capture: it leaves focus in
					// the board and redraws the cards it brought back with the new-card edge, which a visible board would show.
					// Desktop only: the messages are the same at every width.
					if (viewport === "desktop") await quotesEndOnce(page);
					await page
						.getByRole("button", { name: "Use the plain form" })
						.click();

					if (await page.locator("[data-brief-board]").isVisible())
						throw new Error("The board stayed visible on the plain form");
				},
			);

			// Choices made while a request is in flight win over its reply. Desktop only: the rule is the same at every width.
			if (viewport === "desktop")
				await shot(
					"stale",
					"Choices made while a reply was on its way",
					async (page) => {
						await open(page);
						await write(page, PURPOSE);
						const held = [];

						await page.unroute("**/api/software/brief/board");
						await page.route("**/api/software/brief/board", (route) =>
							held.push(route),
						);
						await page
							.locator('[data-step="1"] textarea')
							.pressSequentially(MORE, { delay: 2 });
						await page.waitForFunction(
							() =>
								document.querySelector("[data-board-status]")?.textContent ===
								"Reading your answers…",
							undefined,
							{ timeout: 20000 },
						);
						await page
							.getByRole("button", { name: "Not this: Contact" })
							.click();
						await page.getByRole("button", { name: "Keep: Shows" }).click();
						// Leave the board (pointer and focus), or the reply is rightly held until the visitor does.
						await page.mouse.move(5, 5);
						await page.locator('[data-step="1"] textarea').focus();

						// The reply was made before those choices: it offers Contact again, in other words, and rewords Shows.
						const reply = scriptedReply(held[0].request().postData() ?? "{}");

						reply.cards = reply.cards.map((card) =>
							card.text === "Shows" ? { ...card, text: "Tour dates" } : card,
						);
						// First, so the reply stays within its twelve cards.
						reply.cards.unshift(
							{
								lane: "parts",
								text: "Contact page",
								basis: "suggested",
								reason: "Venues need it",
							},
							{
								lane: "questions",
								text: "Who will run the merch table?",
								basis: "suggested",
								reason: "You sell merch at shows",
							},
						);
						// The choices above ask again (the board sends the visitor's choices too); the model answers alike.
						await page.unroute("**/api/software/brief/board");
						await page.route("**/api/software/brief/board", (route) =>
							route.fulfill({ json: reply }),
						);

						// Only one request is ever in flight, so held[0] is the reply made before the choices.
						await held[0].fulfill({ json: reply });
						await page.waitForFunction(() =>
							document
								.querySelector("[data-board-status]")
								?.textContent?.startsWith("Up to date"),
						);

						const texts = await page
							.locator(".board-card [data-card-text]")
							.allTextContents();

						if (!texts.includes("Who will run the merch table?"))
							throw new Error(
								"The reply was not applied, so it proves nothing",
							);

						if (
							texts.some((text) => /Contact|Tour dates/.test(text)) ||
							!texts.includes("Shows")
						)
							throw new Error(
								`A stale reply overrode the visitor: ${texts.join(", ")}`,
							);
					},
				);

			steps.push({
				title: `Owner readback with the outline, ${viewport}`,
				images: [
					{
						file: await capture({
							file: `software-board-owner-${viewport}.png`,
							path: "/owner/requests/screenshot-board",
							viewport,
							owner: true,
						}),
						caption: "Fictional brief with its outline, as the owner reads it",
					},
				],
			});
		}

		return steps;
	},
};
