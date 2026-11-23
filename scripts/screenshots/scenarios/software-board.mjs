// The living brief's outline (docs/plans/2026-11-living-brief.md) on a fictional website brief, at both widths: each of its
// three lane screens, the same screens by hand (the outline's AI turned off), going back to edit an answer and seeing what
// changed in a lane, the review with "New since you last looked", the skipped outline, and the owner's readback. The route is answered locally by the scripted interpreter
// (../brief-board-script.mjs), a little late, as the model would be; no model is called and nothing is sent.
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

/** A suggested question and a note that each end their own sentence, for the messages that quote a card. */
const QUESTION = "Who will add new show dates?";
const NOTE = "Fans hear new songs first.";

/** Each lane screen's question, as the website path shows it. The purpose has no screen. */
const HEADINGS = {
	audience: "Who is it for?",
	parts: "Which pages does it need?",
	questions: "What’s still undecided?",
};

const LANES = Object.keys(HEADINGS);

/** What the website path's by-hand screens say: each lane's hint and example answer, as the design gives them. */
const BY_HAND = {
	audience: {
		hint: "List the people you want the site to reach. It keeps the design aimed at them.",
		placeholder: "Fans who want show dates",
	},
	questions: {
		hint: "List anything you haven’t settled yet. It’s fine to leave this empty.",
		placeholder: "Do we sell tickets on the site?",
	},
};

/** Polls `check` until it is true, so a slow reply or a settling card fails with a name rather than a bare timeout. */
async function until(page, what, check, timeout = 20000) {
	const end = Date.now() + timeout;

	while (!(await check())) {
		if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
		await page.waitForTimeout(100);
	}
}

/**
 * Opens the brief at the website's first question with the outline's route answered locally, 400 ms late. `state.gate`,
 * when set to a promise, holds every reply until it settles; `state.requests` and `state.replies` count what the route
 * received and answered.
 */
async function open(page) {
	const state = { requests: 0, replies: 0, gate: null };

	await page.route("**/api/software/brief/pass", (route) =>
		route.fulfill({ json: { ok: true } }),
	);
	await page.route("**/api/software/brief/suggest", (route) =>
		route.fulfill({ json: { suggestion: "" } }),
	);
	await page.route("**/api/software/brief/board", async (route) => {
		const body = route.request().postData() ?? "{}";

		state.requests++;
		await new Promise((resolve) => setTimeout(resolve, 400));

		if (state.gate) await state.gate;
		await route.fulfill({ json: scriptedReply(body) });
		state.replies++;
	});
	await stubTurnstile(page);
	await page.addInitScript(() => {
		localStorage.removeItem("software-brief-draft");
		localStorage.removeItem("software-brief-board");
		localStorage.removeItem("software-suggestions");
	});
	await page.reload();
	await page.waitForFunction(() => !!window.turnstile);

	return state;
}

/**
 * Puts the caret at the end of a text box and focuses it. A click can land mid-text on a phone, and the End shortcut is not
 * the same key on every platform, so the caret is set directly: what is typed next is appended.
 */
const toEnd = (box) =>
	box.evaluate((node) => {
		node.focus();
		node.setSelectionRange(node.value.length, node.value.length);
	});

/** Types `text` into the first question and waits for the reply it asks for. */
async function write(page, state, text, replies = 1) {
	const box = page.locator('[data-step="1"] textarea');

	await toEnd(box);
	await box.pressSequentially(text, { delay: 2 });
	await until(page, `reply ${replies}`, async () => state.replies >= replies);
	await page.waitForTimeout(300);
}

const next = async (page, times = 1) => {
	for (let i = 0; i < times; i++) await page.locator("[data-next]").click();
};

const back = async (page, times = 1) => {
	for (let i = 0; i < times; i++) await page.locator("[data-back]").click();
};

/** From the first question: Next to a lane's screen, checking its question is the heading and has focus. */
async function toLane(page, lane) {
	await next(page, LANES.indexOf(lane) + 1);
	const screen = page.locator(`[data-lane-screen="${lane}"]`);
	const heading = screen.locator("h1");

	await heading.waitFor();

	if ((await heading.textContent()) !== HEADINGS[lane])
		throw new Error(`The ${lane} screen asks "${await heading.textContent()}"`);

	if (!(await heading.evaluate((node) => node === document.activeElement)))
		throw new Error(`The ${lane} screen's heading did not take focus`);
	// New cards rise in over 180 ms and keep an accent edge for 1.6 s; measure and capture once they have settled.
	await page.waitForFunction(
		() => !document.querySelector(".board-card.is-new"),
	);
}

/** The lane screen's one-line status, as a screen reader hears it. */
const statusOf = (page, lane) =>
	page.locator(`[data-lane-screen="${lane}"] [data-lane-status]`).textContent();

/** From wherever the visitor is: through the steps after the outline, to the review. */
async function toReview(page) {
	for (let i = 0; i < 20; i++) {
		const step = await page.evaluate(
			() =>
				document.querySelector("#software-inquiry [data-step]:not([hidden])")
					?.dataset.step,
		);

		if (step === "6") return;

		if (step === "7" || step === "4")
			await page.locator(`[data-step="${step}"] [data-skip]`).click();
		else {
			if (step === "8")
				await page.locator("[name=updates][value=self]").check();

			if (step === "5") {
				await page.locator("[name=name]").fill("Sam Example");
				await page.locator("[name=email]").fill("sam@example.com");
			}

			await next(page);
		}
	}

	throw new Error("The brief did not reach its review");
}

/**
 * Each message that quotes a card (Kept, Set aside, Brought back, Removed, Undid) ends its sentence once: no period
 * after a quote that already ends a sentence (checked here with "?" and "."), and one after a quote that does not
 * (checked with "Shows" and "Press kit"). Every action is undone, so the outline keeps the same cards. The Undo message
 * that also names the cards Undo withdrew is not reached here.
 */
async function quotesEndOnce(page) {
	const live = page.locator("[data-board-live]");
	const screen = page.locator("[data-lane-screen]:not([hidden])");

	// The live region is set a moment after it is cleared, so a repeated message is read again.
	const said = async (expected) => {
		await page
			.waitForFunction(
				(want) =>
					document.querySelector("[data-board-live]")?.textContent === want,
				expected,
				{ timeout: 1000 },
			)
			.catch(() => {});
		const text = await live.textContent();

		if (text !== expected)
			throw new Error(
				`The outline said ${JSON.stringify(text)}, not ${JSON.stringify(expected)}`,
			);
	};

	const press = async (name, expected) => {
		await page.getByRole("button", { name, exact: true }).click();
		await said(expected);
	};

	const undo = async (expected) => {
		await screen.locator("[data-board-undo]").click();
		await said(expected);
	};

	// A card from the reply (read from the answers or suggested): Keep, Not this and Bring back, each undone. `end` is
	// what must follow its quote.
	const card = async (text, end) => {
		await press(`Keep: ${text}`, `Kept “${text}”${end}`);
		await undo(`Undid: kept “${text}”${end}`);
		await press(
			`Not this: ${text}`,
			`Set aside “${text}”${end} Undo or Bring back restores it.`,
		);

		if (
			!(await screen.locator("[data-lane-aside]").evaluate((list) => list.open))
		)
			await screen.locator("[data-lane-aside-summary]").click();
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

	await toLane(page, "parts");
	await card("Shows", ".");
	await note("Add a page", "Press kit", ".");
	await next(page);
	await card(QUESTION, "");
	await back(page, 2);
	await note(/^Add who it/, NOTE, "");
}

export default {
	title: "Living brief outline",
	async run({ capture, sql }) {
		sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES ('screenshot-board','software','website','Sam Example','sam@example.com','A home for my band on the web.',
      '${JSON.stringify({ path: "website", purpose: PURPOSE, currentUrl: "", existing: "", updates: "self", company: "", timing: "flexible", timingDate: "", budgetNote: "", clientCopyStatus: "sent", outline: OUTLINE }).replaceAll("'", "''")}',
      'new','','2026-11-15T12:00:00.000Z','2026-11-15T12:00:00.000Z','00000000-0000-4000-8000-000000000042')`);
		const steps = [];

		for (const viewport of ["desktop", "phone"]) {
			const shot = async (name, caption, prepare) =>
				steps.push({
					title: `${caption}, ${viewport}`,
					images: [
						{
							file: await capture({
								file: `software-board-${name}-${viewport}.png`,
								path: "/software/start?path=website",
								viewport,
								prepare,
							}),
							caption,
						},
					],
				});

			// Each lane screen, with the cards the scripted reply read from the answers.
			for (const lane of LANES)
				await shot(
					`lane-${lane}`,
					`The outline's ${lane} screen, with its cards`,
					async (page) => {
						const state = await open(page);

						await write(page, state, PURPOSE);
						await toLane(page, lane);

						if ((await page.locator(".board-card").count()) < 5)
							throw new Error("The outline did not fill in while writing");

						if (lane === "parts") {
							await page.getByRole("button", { name: "Keep: Shows" }).click();
							await page
								.getByRole("button", { name: "Not this: Contact" })
								.click();
							await page.getByRole("button", { name: "Add a page" }).click();
							await page.keyboard.type("Press kit");
							await page.keyboard.press("Enter");

							if (
								!(await page
									.locator('[data-lane-screen="parts"] [data-lane-aside]')
									.isVisible())
							)
								throw new Error("The set-aside list did not appear");

							// The note just added is inside the list's visible box, not scrolled out of sight.
							await page.waitForTimeout(100);

							const inView = await page.evaluate(() => {
								const region = document.querySelector(
									'[data-lane-screen="parts"] [data-lane-region]',
								);

								const note = [
									...document.querySelectorAll(
										'[data-lane-screen="parts"] .board-card',
									),
								].find((node) => node.textContent?.includes("Press kit"));

								if (!region || !note) return false;
								const a = region.getBoundingClientRect();
								const b = note.getBoundingClientRect();

								return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
							});

							if (!inView)
								throw new Error("The note the visitor added is out of sight");
						}

						// Move the pointer off the controls, so no hover style is captured.
						await page.mouse.move(0, 0);
					},
				);

			// The same screens by hand: the outline's AI turned off under the first answer, so each lane is an ordinary question.
			const byHand = async (page, lane) => {
				await open(page);
				await page.locator('[data-step="1"] [data-suggestions-toggle]').click();
				await page.locator('[data-step="1"] textarea').fill(PURPOSE);
				await toLane(page, lane);
				const screen = page.locator(`[data-lane-screen="${lane}"]`);
				const text = await screen.innerText();

				if (!text.includes(BY_HAND[lane].hint))
					throw new Error(`The ${lane} screen does not show its by-hand hint`);

				if (
					(await screen
						.locator("[data-lane-input]")
						.getAttribute("placeholder")) !== BY_HAND[lane].placeholder
				)
					throw new Error(`The ${lane} screen has the wrong example`);

				if (!(await screen.locator("[data-lane-input]").isVisible()))
					throw new Error("The answer field is not open");

				// The label stays the field's name for screen readers, drawn as a one pixel clip.
				const label = await screen
					.locator("[data-lane-editor-label]")
					.boundingBox();

				if (!label || label.width > 1 || label.height > 1)
					throw new Error("The by-hand field shows a label above it");

				// Add is the outlined button on the field's row, to its right (or below at full width on a narrow row).
				const add = screen.locator("[data-lane-save]");
				const field = await screen.locator("[data-lane-input]").boundingBox();
				const button = await add.boundingBox();

				if (
					!(await add.evaluate((node) =>
						node.classList.contains("site-button-outline"),
					))
				)
					throw new Error("Add is not the outlined button");

				if (!field || !button || button.height < 44)
					throw new Error("Add is missing or under 44px");

				const beside =
					Math.abs(
						button.y + button.height / 2 - (field.y + field.height / 2),
					) < field.height;

				if (!beside && button.y < field.y + field.height)
					throw new Error("Add is neither beside the field nor below it");

				if (
					await screen
						.getByRole("button", { name: "Skip these, no AI outline" })
						.isVisible()
				)
					throw new Error("A by-hand screen offers the AI skip");

				if (await screen.locator("[data-board-undo]").isVisible())
					throw new Error("Undo shows with nothing to undo");

				if ((await statusOf(page, lane)) !== "")
					throw new Error("The by-hand status line is not empty");

				return screen;
			};

			await shot(
				"byhand-audience",
				"The audience screen by hand: hint, open field with an example, Add",
				async (page) => {
					await byHand(page, "audience");
					await page.mouse.move(0, 0);
				},
			);

			await shot(
				"byhand-audience-notes",
				"The audience screen by hand after two notes: no Your note label, Undo shown",
				async (page) => {
					const screen = await byHand(page, "audience");
					const input = screen.locator("[data-lane-input]");

					for (const note of [
						"Fans who want show dates",
						"Venues that book us",
					]) {
						await input.fill(note);
						await input.press("Enter");

						if ((await input.inputValue()) !== "")
							throw new Error("The field was not cleared after Add");

						if (
							!(await input.evaluate((node) => node === document.activeElement))
						)
							throw new Error("Focus left the field after Add");
					}

					if ((await screen.locator(".board-card").count()) !== 2)
						throw new Error("The two notes are not listed");

					// A note is a row: no box, Edit and Remove to the right of its text.
					const row = screen.locator(".board-card").first();

					if (
						(await row.evaluate(
							(node) => getComputedStyle(node).borderTopWidth,
						)) !== "0px"
					)
						throw new Error("A note is boxed");

					const words = await row.locator("[data-card-text]").boundingBox();

					const edit = await row
						.getByRole("button", { name: /^Edit/ })
						.boundingBox();

					const remove = await row
						.getByRole("button", { name: /^Remove/ })
						.boundingBox();

					if (
						!words ||
						!edit ||
						!remove ||
						edit.height < 44 ||
						remove.height < 44
					)
						throw new Error("A note's actions are missing or under 44px");

					if (
						page.viewportSize().width >= 768 &&
						edit.x < words.x + words.width - 1
					)
						throw new Error("Edit is not to the right of the note's text");

					if ((await screen.innerText()).includes("Your note"))
						throw new Error("A lane of the visitor's own notes says Your note");

					if (!(await screen.locator("[data-board-undo]").isVisible()))
						throw new Error("Undo is not shown after a note");
					await page.mouse.move(0, 0);
				},
			);

			await shot(
				"byhand-questions",
				"The questions screen by hand: hint, open field with an example, Add",
				async (page) => {
					await byHand(page, "questions");
					await page.mouse.move(0, 0);
				},
			);

			// Words left in the by-hand field are added when the visitor leaves by Next, and show on the review.
			await shot(
				"byhand-leave-field",
				"The review after leaving the audience screen with a note still typed",
				async (page) => {
					const screen = await byHand(page, "audience");
					const input = screen.locator("[data-lane-input]");

					await input.fill("Bookers at small venues");
					await next(page);

					if ((await input.inputValue()) !== "")
						throw new Error("The typed note stayed in the field");

					await back(page);

					if (
						!(await screen.locator(".board-card").first().innerText()).includes(
							"Bookers at small venues",
						)
					)
						throw new Error("The typed note was not added on Next");

					await toReview(page);

					if (
						!(await page.locator("[data-review]").innerText()).includes(
							"Bookers at small venues",
						)
					)
						throw new Error("The typed note is not on the review");
					await page.mouse.move(0, 0);
				},
			);

			// With the AI on, words left in the open "Add" editor are added when the visitor leaves by Next.
			await shot(
				"ai-leave-editor",
				"The audience screen after leaving with a note still typed in Add",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await toLane(page, "audience");
					const screen = page.locator('[data-lane-screen="audience"]');

					await screen.locator("[data-lane-add]").click();
					await screen
						.locator("[data-lane-input]")
						.fill("Bookers at small venues");
					await next(page);
					await back(page);

					if (
						!(await screen.locator("[data-lane-cards]").innerText()).includes(
							"Bookers at small venues",
						)
					)
						throw new Error("The note typed in Add was not added on Next");
					await page.mouse.move(0, 0);
				},
			);

			// A lane with no cards left: the visitor set aside every card, so the hint says to add their own or go on.
			await shot(
				"lane-empty",
				"A lane with no cards: Add your own, or go on",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await toLane(page, "audience");
					const screen = page.locator('[data-lane-screen="audience"]');
					const asides = screen.getByRole("button", { name: /^Not this: / });

					for (let i = 0; i < 10 && (await asides.count()) > 0; i++)
						await asides.first().click();

					if ((await screen.locator(".board-card").count()) > 0)
						throw new Error("The audience screen still lists cards");

					// The lane's request for what the visitor just did settles first, so the status line is empty.
					await until(
						page,
						"the lane's status to settle",
						async () => !(await statusOf(page, "audience")).includes("Reading"),
					);

					if (!(await screen.innerText()).includes("Add your own, or go on."))
						throw new Error("The empty lane does not say to add your own");
					await page.mouse.move(0, 0);
				},
			);

			// Going back to edit an answer: the lane that gained cards says what changed, and nothing moved while it was open.
			await shot(
				"edited",
				"Back to edit an answer: the pages screen says what is new",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await next(page, 3);
					await back(page, 3);
					await write(page, state, MORE, 2);
					await next(page, 2);
					await page
						.locator('[data-lane-screen="parts"] .board-card')
						.first()
						.waitFor();
					const line = await statusOf(page, "parts");

					if (!/new since you last looked/.test(line))
						throw new Error(`The pages screen says "${line}"`);
					await page.waitForFunction(
						() => !document.querySelector(".board-card.is-new"),
					);
					await page.mouse.move(0, 0);
				},
			);

			// A reply that lands after the visitor has left a lane: the review lists what the lane never showed them.
			await shot(
				"review",
				"The review, with the outline and what is new since the visitor last looked",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await next(page, 4);
					await back(page, 4);
					let release = () => {};

					state.gate = new Promise((resolve) => (release = resolve));
					const box = page.locator('[data-step="1"] textarea');

					await toEnd(box);
					await box.pressSequentially(MORE, { delay: 2 });
					// The request goes out from the first lane screen, and the visitor is past every lane before it is answered.
					await next(page);
					await until(page, "the request", async () => state.requests >= 2);
					await next(page, 3);
					await toReview(page);
					release();
					await until(page, "the new group in the review", async () =>
						(await page.locator("[data-review]").innerText()).includes(
							"New since you last looked",
						),
					);

					const review = await page.locator("[data-review]").innerText();

					if (!review.includes("Brief outline") || review.includes("Contact ·"))
						throw new Error(
							"The review does not show the outline as it will be sent",
						);

					if (!/Pages: (Shop|Photos)/.test(review))
						throw new Error(`The review lists no new page: ${review}`);
					await page.mouse.move(0, 0);
				},
			);

			// Skip never blocks: with a full lane and words in the Add editor, the visitor still lands past the lanes.
			await shot(
				"skip-full-lane",
				"The review after skipping from a full audience lane with words typed in Add",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await toLane(page, "audience");
					const screen = page.locator('[data-lane-screen="audience"]');
					const input = screen.locator("[data-lane-input]");

					// Fill the lane (the scripted reply may have left room for fewer than three notes).
					for (let n = 1; n <= 3 && !(await input.isVisible()); n++) {
						await screen.locator("[data-lane-add]").click();

						if (!(await input.isVisible())) break;
						await input.fill(`Note ${n}`);
						await input.press("Enter");
					}

					// One card aside makes room to open Add; bringing it back fills the lane under the open editor.
					await screen
						.getByRole("button", { name: /^Not this:/ })
						.first()
						.click();
					await screen.locator("[data-lane-add]").click();
					await input.fill("Bookers at small venues");
					await screen.locator("[data-lane-aside-summary]").click();
					await screen
						.getByRole("button", { name: /^Bring back:/ })
						.first()
						.click();
					await screen
						.getByRole("button", { name: "Skip these, no AI outline" })
						.click();
					await toReview(page);

					if (
						!(await page
							.getByRole("button", { name: "Add the outline back" })
							.isVisible())
					)
						throw new Error("Skip from a full lane did not reach the review");
					await page.mouse.move(0, 0);
				},
			);

			// "Skip these, no AI outline": the four screens leave the plan, no outline is sent, and the review can bring it back.
			await shot(
				"skipped",
				"The review after skipping the outline, with Add the outline back",
				async (page) => {
					const state = await open(page);

					await write(page, state, PURPOSE);
					await toLane(page, "parts");
					await page
						.getByRole("button", { name: "Skip these, no AI outline" })
						.click();
					await toReview(page);

					const review = await page.locator("[data-review]").innerText();

					if (review.includes("Brief outline"))
						throw new Error("A skipped outline is listed in the review");

					if (
						!(await page
							.getByRole("button", { name: "Add the outline back" })
							.isVisible())
					)
						throw new Error("The review does not offer the outline back");

					if (
						(await page.locator(".brief-dots li:not([hidden])").count()) !== 8
					)
						throw new Error(
							"The dots did not drop to the plan without the outline",
						);
					await page.mouse.move(0, 0);
				},
			);

			// The messages that quote a card, on the lane screens. Desktop only: they are the same at every width.
			if (viewport === "desktop")
				await shot(
					"quotes",
					"Messages that quote a card end their sentence once",
					async (page) => {
						const state = await open(page);

						await write(page, state, PURPOSE);
						await quotesEndOnce(page);
						await page.mouse.move(0, 0);
					},
				);

			// Choices made while a request is in flight win over its reply. Desktop only: the rule is the same at every width.
			if (viewport === "desktop")
				await shot(
					"stale",
					"Choices made while a reply was on its way",
					async (page) => {
						const state = await open(page);

						await write(page, state, PURPOSE);
						const held = [];

						await page.unroute("**/api/software/brief/board");
						await page.route("**/api/software/brief/board", (route) =>
							held.push(route),
						);
						const first = page.locator('[data-step="1"] textarea');

						await toEnd(first);
						await first.pressSequentially(MORE, { delay: 2 });
						await next(page, 2);
						await until(
							page,
							"a request in flight",
							async () => held.length > 0,
						);
						await page
							.getByRole("button", { name: "Not this: Contact" })
							.click();
						await page.getByRole("button", { name: "Keep: Shows" }).click();

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
						// The choices above ask again (the outline sends the visitor's choices too); the model answers alike.
						await page.unroute("**/api/software/brief/board");
						await page.route("**/api/software/brief/board", (route) =>
							route.fulfill({ json: reply }),
						);

						// Only one request is ever in flight, so held[0] is the reply made before the choices.
						await held[0].fulfill({ json: reply });
						await until(page, "the reply to apply", async () =>
							(
								await page
									.locator(".board-card [data-card-text]")
									.allTextContents()
							).includes("Who will run the merch table?"),
						);

						const texts = await page
							.locator(".board-card [data-card-text]")
							.allTextContents();

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
