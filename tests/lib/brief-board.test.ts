import { describe, expect, it } from "vitest";
import {
	type Board,
	type BoardCard,
	type ReplyCard,
	OUTLINE_CHANGED,
	REPLY_MAX,
	addNote,
	answerCard,
	applyReply,
	boardContext,
	briefOutline,
	bringBack,
	commits,
	editCard,
	emptyBoard,
	fitContext,
	keepCard,
	laneLimits,
	lastAction,
	quotedFrom,
	readBoardAnswer,
	readBriefOutline,
	readReply,
	readSavedBoards,
	removeNote,
	sameIdea,
	savedBoards,
	sendRequest,
	setAside,
	undo,
} from "~/lib/brief-board";

const ANSWERS =
	"A home for my band. Fans should hear new music, see upcoming shows near them and join the mailing list.";

const said = (
	lane: ReplyCard["lane"],
	text: string,
	quote: string,
	ref = "",
): ReplyCard => ({
	ref,
	lane,
	text,
	basis: "said",
	quote,
	reason: "",
});

const suggested = (
	lane: ReplyCard["lane"],
	text: string,
	ref = "",
): ReplyCard => ({
	ref,
	lane,
	text,
	basis: "suggested",
	quote: "",
	reason: "A reason",
});

/** A board after request 1 was sent and its reply applied. */
function started(...cards: ReplyCard[]): Board {
	const [sent, n] = sendRequest(emptyBoard());

	return applyReply(sent, cards, n, ANSWERS, false).board;
}

const card = (board: Board, text: string): BoardCard => {
	const found = board.cards.find((c) => c.text === text);

	if (!found) throw new Error(`No card "${text}"`);

	return found;
};

describe("passages", () => {
	it("finds a passage whatever its case, spacing, quote marks and end punctuation", () => {
		expect(quotedFrom("see upcoming SHOWS near them.", ANSWERS)).toBe(true);
		expect(quotedFrom("“see  upcoming shows”", ANSWERS)).toBe(true);
		expect(quotedFrom("Fans should hear old music", ANSWERS)).toBe(false);
		expect(quotedFrom("a ", ANSWERS)).toBe(false);
		expect(quotedFrom("", ANSWERS)).toBe(false);
	});
});

describe("the same idea", () => {
	it.each([
		["Shows", "Shows page", true],
		["Show dates", "Shows", true],
		["Galleries", "Gallery", true],
		["Classes", "Class schedule", true],
		["Mailing list", "Newsletter sign-up", false],
		["Music", "Merch", false],
		["Contact", "Contact the band", true],
	])("%s and %s: %s", (a, b, same) => {
		expect(sameIdea(a, b)).toBe(same);
	});
});

describe("commitments and links", () => {
	it.each([
		"About $500",
		"500 dollars",
		"Ready in 2 weeks",
		"Done in a few days",
		"I will build it",
		"I’ll build it in React",
		"Guaranteed launch",
		"See example.com",
		"Email me@example.com",
		"https://example.org",
	])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"Pricing",
		"Booking",
		"Shows",
		"Who will add new show dates?",
		"Weekly classes",
	])("accepts %s", (text) => {
		expect(commits(text)).toBe(false);
	});
});

describe("reading a reply", () => {
	it("is null when the reply is not a list of cards", () => {
		expect(readReply(null, ANSWERS)).toBeNull();
		expect(readReply({ cards: "no" }, ANSWERS)).toBeNull();
		expect(readReply("text", ANSWERS)).toBeNull();
	});

	it("keeps the good cards and leaves out each bad one on its own", () => {
		const cards = readReply(
			{
				cards: [
					{
						lane: "parts",
						text: "  Shows ",
						basis: "said",
						quote: "upcoming shows near them",
					},
					{
						lane: "parts",
						text: "Tickets",
						basis: "said",
						quote: "buy tickets here",
					},
					{ lane: "parts", text: "Shop", basis: "said" },
					{ lane: "elsewhere", text: "X", basis: "suggested" },
					{
						lane: "parts",
						text: "Costs $300",
						basis: "suggested",
						reason: "x",
					},
					{ lane: "parts", text: "A".repeat(61), basis: "suggested" },
					{
						lane: "questions",
						text: "Who adds dates?",
						basis: "suggested",
						reason: "Ready in 2 weeks",
					},
					{
						lane: "questions",
						text: "Who adds dates?",
						basis: "suggested",
						reason: "Dates change",
						extra: 1,
					},
					7,
				],
			},
			ANSWERS,
		);

		expect(cards).toEqual([
			{
				ref: "",
				lane: "parts",
				text: "Shows",
				basis: "said",
				quote: "upcoming shows near them",
				reason: "",
			},
			{
				ref: "",
				lane: "questions",
				text: "Who adds dates?",
				basis: "suggested",
				quote: "",
				reason: "Dates change",
			},
		]);
	});

	it("reads at most twelve cards", () => {
		const many = Array.from({ length: 20 }, (_, i) => ({
			lane: "parts",
			text: `Page ${i}`,
			basis: "suggested",
		}));

		expect(readReply({ cards: many }, ANSWERS)).toHaveLength(REPLY_MAX);
	});

	it("reads the route's answer", () => {
		expect(readBoardAnswer({ ok: false, reason: "pass" })).toEqual({
			cards: undefined,
			refs: [],
			reason: "pass",
		});
		expect(
			readBoardAnswer({ ok: true, cards: [], refs: ["c2", "x", 3, "c9"] }),
		).toEqual({
			cards: { cards: [] },
			refs: ["c2", "c9"],
			reason: "",
		});
		expect(readBoardAnswer({ reason: "whatever" }).reason).toBe("");
		expect(readBoardAnswer("nope")).toEqual({
			cards: undefined,
			refs: [],
			reason: "",
		});
	});
});

describe("applying a reply", () => {
	it("adds new cards at the end of their lane", () => {
		const board = started(
			said("parts", "Shows", "upcoming shows near them"),
			suggested("parts", "Contact"),
			said("audience", "Fans", "Fans should hear new music"),
		);

		expect(board.cards.map((c) => [c.id, c.text, c.status, c.since])).toEqual([
			["c1", "Shows", "proposed", 1],
			["c2", "Contact", "proposed", 1],
			["c3", "Fans", "proposed", 1],
		]);
		expect(board.applied).toBe(1);
	});

	it("never applies an older reply, or any reply while paused", () => {
		let board = emptyBoard();
		let one: number, two: number;
		[board, one] = sendRequest(board);
		[board, two] = sendRequest(board);
		board = applyReply(
			board,
			[suggested("parts", "Contact")],
			two,
			ANSWERS,
			false,
		).board;

		expect(
			applyReply(board, [suggested("parts", "Shop")], one, ANSWERS, false)
				.board,
		).toBe(board);
		expect(applyReply(board, [], 3, ANSWERS, true).board).toBe(board);
	});

	it("leaves every owned card alone, by ref or by the same idea", () => {
		let board = started(
			suggested("parts", "Contact"),
			suggested("parts", "Shop"),
			suggested("parts", "Photos"),
		);

		board = keepCard(board, card(board, "Contact").id);
		board = editCard(board, card(board, "Shop").id, "Merch store");
		board = setAside(board, card(board, "Photos").id);
		board = addNote(board, "parts", "Press kit");
		const [sent, n] = sendRequest(board);

		const after = applyReply(
			sent,
			[
				suggested("parts", "Contact us", "c1"),
				suggested("parts", "Store", "c2"),
				suggested("parts", "Photo gallery"),
				suggested("parts", "Press kit page"),
			],
			n,
			ANSWERS,
			false,
		);

		expect(after.board.cards).toEqual(sent.cards);
		expect(after.added + after.updated + after.withdrawn).toBe(0);
	});

	it("updates and withdraws the unowned cards its request showed", () => {
		const board = started(
			suggested("parts", "Contact"),
			suggested("parts", "Shop"),
		);

		const [sent, n] = sendRequest(board);

		const after = applyReply(
			sent,
			[suggested("parts", "Contact form", "c1")],
			n,
			ANSWERS,
			false,
		);

		expect(after.board.cards.map((c) => c.text)).toEqual(["Contact form"]);
		expect(after).toMatchObject({ updated: 1, withdrawn: 1, added: 0 });
	});

	it("does not touch a card Undo made unowned after the request was sent", () => {
		let board = started(suggested("parts", "Contact"));
		let n: number;
		[board, n] = sendRequest(board);
		board = setAside(board, "c1");
		board = undo(board);

		const after = applyReply(board, [], n, ANSWERS, false);

		expect(after.board.cards.map((c) => [c.text, c.status])).toEqual([
			["Contact", "proposed"],
		]);
		expect(after.withdrawn).toBe(0);
	});

	it("checks a passage against the answers as they are now, not as they were sent", () => {
		const board = started(said("parts", "Shows", "upcoming shows near them"));
		const [sent, n] = sendRequest(board);
		const now = "A home for my band.";

		const after = applyReply(
			sent,
			[
				said("parts", "Shows", "upcoming shows near them", "c1"),
				said("parts", "Music", "hear new music"),
			],
			n,
			now,
			false,
		);

		expect(after.board.cards).toEqual([]);
		expect(after.withdrawn).toBe(1);
	});

	it("keeps each lane within its limit", () => {
		const replies = Array.from({ length: 12 }, (_, i) =>
			suggested("parts", `Page ${String.fromCharCode(65 + i)}`),
		);

		expect(started(...replies).cards).toHaveLength(laneLimits.parts);
	});
});

describe("the visitor's actions", () => {
	it("keeps, edits, answers, sets aside and brings back, each undoable", () => {
		let board = started(
			suggested("parts", "Contact"),
			suggested("questions", "Who adds dates?"),
		);

		board = keepCard(board, "c1");
		expect(card(board, "Contact").status).toBe("kept");
		board = editCard(board, "c1", "  Contact   page ");
		expect(card(board, "Contact page").status).toBe("edited");
		board = answerCard(board, "c2", "Me");
		expect(card(board, "Who adds dates?")).toMatchObject({
			status: "kept",
			answer: "Me",
		});
		board = setAside(board, "c1");
		expect(board.cards[0].status).toBe("dismissed");
		board = bringBack(board, "c1");
		// It was edited before it was set aside, so it comes back as the visitor's words.
		expect(board.cards[0].status).toBe("edited");
		expect(lastAction(board)).toBe("brought back “Contact page”");

		for (let i = 0; i < 5; i++) board = undo(board);

		expect(board.cards.map((c) => [c.text, c.status, c.answer])).toEqual([
			["Contact", "proposed", ""],
			["Who adds dates?", "proposed", ""],
		]);
		expect(lastAction(board)).toBeNull();
		expect(undo(board)).toBe(board);
	});

	it("adds and removes the visitor's notes; Undo restores a removed note, and a reply does not offer it back", () => {
		let board = addNote(emptyBoard(), "parts", "Press kit");
		board = addNote(board, "parts", "Lyrics");
		expect(board.cards.map((c) => [c.id, c.status])).toEqual([
			["c1", "wrote"],
			["c2", "wrote"],
		]);
		expect(setAside(board, "c1")).toBe(board);
		board = editCard(board, "c1", "EPK");
		expect(board.cards[0]).toMatchObject({ text: "EPK", status: "wrote" });
		board = removeNote(board, "c1");
		expect(board.cards.map((c) => c.text)).toEqual(["Lyrics"]);
		// Gone as far as the visitor is concerned: not saved, not sent, and not offered back.
		expect(boardContext(board).map((c) => c.text)).toEqual(["Lyrics"]);
		expect(
			JSON.stringify(
				savedBoards({
					boards: { website: board },
					paused: false,
					plain: false,
				}),
			),
		).not.toContain("EPK");
		expect(
			applyReply(board, [suggested("parts", "EPK")], 1, ANSWERS, false).added,
		).toBe(0);
		board = undo(board);
		expect(board.cards.map((c) => c.text)).toEqual(["EPK", "Lyrics"]);
		board = undo(board);
		board = undo(board);
		expect(board.cards.map((c) => c.text)).toEqual(["Press kit"]);
	});

	it("refuses an empty note, a full lane and bringing back into a full lane", () => {
		expect(addNote(emptyBoard(), "parts", "   ")).toEqual(emptyBoard());
		let board = emptyBoard();

		for (let i = 0; i < laneLimits.purpose; i++)
			board = addNote(board, "purpose", `Purpose ${i}`);
		expect(addNote(board, "purpose", "One more")).toBe(board);

		let full = started(suggested("purpose", "For fans"));
		full = setAside(full, "c1");
		full = addNote(full, "purpose", "First");
		full = addNote(full, "purpose", "Second");
		expect(bringBack(full, "c1")).toBe(full);
	});
});

describe("the outline sent with the brief", () => {
	it("sends what was read from the answers and what the visitor owns, never an unkept suggestion", () => {
		let board = started(
			said("parts", "Shows", "upcoming shows near them"),
			suggested("parts", "Contact"),
			suggested("parts", "Shop"),
			suggested("parts", "Photos"),
			suggested("questions", "Who adds dates?"),
			said("purpose", "A home for a band", "A home for my band"),
		);

		board = keepCard(board, card(board, "Contact").id);
		board = editCard(board, card(board, "Shop").id, "Merch");
		board = answerCard(board, card(board, "Who adds dates?").id, "Me");
		board = setAside(board, card(board, "A home for a band").id);
		board = addNote(board, "audience", "Venues");

		expect(briefOutline(board, ANSWERS)).toEqual([
			{ lane: "audience", text: "Venues", origin: "wrote" },
			{
				lane: "parts",
				text: "Shows",
				origin: "answers",
				quote: "upcoming shows near them",
			},
			{ lane: "parts", text: "Contact", origin: "kept" },
			{ lane: "parts", text: "Merch", origin: "edited" },
			{
				lane: "questions",
				text: "Who adds dates?",
				origin: "kept",
				answer: "Me",
			},
		]);
	});

	it("drops a passage that left the answers: an unowned card is not sent, a kept one is sent as kept", () => {
		let board = started(
			said("parts", "Shows", "upcoming shows near them"),
			said("parts", "Music", "hear new music"),
		);

		board = keepCard(board, "c2");

		expect(briefOutline(board, "Something else entirely.")).toEqual([
			{ lane: "parts", text: "Music", origin: "kept" },
		]);
	});

	it("is read back on the server, and refused when it does not match the answers", () => {
		const outline = [
			{
				lane: "parts",
				text: "Shows",
				origin: "answers",
				quote: "upcoming shows near them",
			},
			{
				lane: "questions",
				text: "Who adds dates?",
				origin: "kept",
				answer: "Me",
			},
			{ lane: "parts", text: "Costs $500", origin: "wrote" },
		];

		expect(readBriefOutline(outline, ANSWERS)).toEqual({
			ok: true,
			value: outline,
		});
		// A character outside the basic plane is a pair of surrogates, not a lone one.
		expect(
			readBriefOutline(
				[{ lane: "parts", text: "Gigs 🎸", origin: "wrote" }],
				ANSWERS,
			),
		).toEqual({
			ok: true,
			value: [{ lane: "parts", text: "Gigs 🎸", origin: "wrote" }],
		});
		expect(readBriefOutline(undefined, ANSWERS)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(readBriefOutline([], ANSWERS)).toEqual({
			ok: true,
			value: undefined,
		});

		for (const bad of [
			[{ ...outline[0], quote: "not in the answers" }],
			[{ lane: "parts", text: "Shows", origin: "answers" }],
			[
				{
					lane: "parts",
					text: "Shows",
					origin: "kept",
					quote: "upcoming shows near them",
				},
			],
			[{ lane: "parts", text: "Shows", origin: "kept", answer: "Yes" }],
			// The model's words, read from the answers or kept, carry no commitment; edited and written cards are the visitor's.
			[
				{
					lane: "parts",
					text: "Costs $500",
					origin: "answers",
					quote: "upcoming shows near them",
				},
			],
			[{ lane: "parts", text: "Costs $500", origin: "kept" }],
			[{ lane: "parts", text: "Two\nlines", origin: "wrote" }],
			// A lone surrogate is refused like a control character, in the text, the passage and the answer.
			[{ lane: "parts", text: "Shows\ud800", origin: "wrote" }],
			[{ ...outline[0], quote: "upcoming shows near them\udc00" }],
			[{ ...outline[1], answer: "Me\ud800" }],
			[{ lane: "parts", text: "", origin: "wrote" }],
			[{ lane: "nowhere", text: "X", origin: "wrote" }],
			Array.from({ length: 3 }, (_, i) => ({
				lane: "purpose",
				text: `P${i}`,
				origin: "wrote",
			})),
			"nope",
		])
			expect(readBriefOutline(bad, ANSWERS)).toEqual({
				ok: false,
				error: OUTLINE_CHANGED,
			});
	});
});

describe("what the model is shown", () => {
	it("shows open cards first, then the visitor's, then set-aside ones, with answers", () => {
		let board = started(
			suggested("parts", "Contact"),
			suggested("questions", "Who adds dates?"),
			suggested("parts", "Shop"),
		);

		board = setAside(board, "c1");
		board = answerCard(board, "c2", "Me");

		expect(boardContext(board)).toEqual([
			{ ref: "c3", lane: "parts", text: "Shop", state: "open" },
			{
				ref: "c2",
				lane: "questions",
				text: "Who adds dates? (answer: Me)",
				state: "yours",
			},
			{ ref: "c1", lane: "parts", text: "Contact", state: "avoid" },
		]);
	});
});

describe("the saved boards", () => {
	it("round-trip, with nothing in flight and nothing to undo", () => {
		let board = started(
			suggested("parts", "Contact"),
			said("parts", "Shows", "upcoming shows near them"),
		);

		board = keepCard(board, "c1");

		const saved = JSON.parse(
			JSON.stringify(
				savedBoards({ boards: { website: board }, paused: true, plain: false }),
			),
		);

		const read = readSavedBoards(saved);

		expect(read.paused).toBe(true);
		expect(read.boards.website?.cards).toEqual(
			board.cards.map((c) => ({ ...c, since: 0 })),
		);
		expect(read.boards.website).toMatchObject({
			nextId: 3,
			sent: 0,
			applied: 0,
			history: [],
		});
	});

	it("read anything else as empty, and drop bad, repeated or overflowing cards", () => {
		expect(readSavedBoards("{")).toEqual({
			boards: {},
			paused: false,
			plain: false,
		});

		const good = {
			id: "c1",
			lane: "purpose",
			text: "One",
			status: "wrote",
			basis: "none",
			quote: "",
			reason: "",
			answer: "",
		};

		const read = readSavedBoards({
			boards: {
				webapp: {
					cards: [
						good,
						good,
						{ ...good, id: "c2", text: "Two" },
						{ ...good, id: "c3", text: "Three" },
						{ ...good, id: "x", text: "Bad id" },
						{ ...good, id: "c9", status: "unknown" },
					],
				},
				other: { cards: [good] },
			},
			paused: false,
			plain: true,
		});

		expect(read.plain).toBe(true);
		expect(Object.keys(read.boards)).toEqual(["webapp"]);
		expect(read.boards.webapp?.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
	});
});

describe("found in review", () => {
	it("needs three whole words for a passage, so a word or a fragment grounds nothing", () => {
		const answers =
			"We run a small dog grooming shop and book appointments by phone.";

		expect(quotedFrom("and", answers)).toBe(false);
		expect(quotedFrom("ook", answers)).toBe(false);
		expect(quotedFrom("grooming shop", answers)).toBe(false);
		expect(quotedFrom("og grooming sho", answers)).toBe(false);
		expect(quotedFrom("small dog grooming", answers)).toBe(true);
		expect(quotedFrom("Shop, and book", answers)).toBe(true);
		expect(
			readReply(
				{
					cards: [
						{
							lane: "audience",
							text: "Veterinary clinics",
							basis: "said",
							quote: "and",
						},
					],
				},
				answers,
			),
		).toEqual([]);
	});

	it("never rewords a card into an idea the visitor set aside or owns", () => {
		let board = started(
			suggested("parts", "Booking"),
			suggested("parts", "Price list"),
			suggested("parts", "Gallery"),
		);

		board = setAside(board, "c2");
		board = keepCard(board, "c3");
		let n: number;
		[board, n] = sendRequest(board);

		const after = applyReply(
			board,
			[
				suggested("parts", "Price list", "c1"),
				suggested("parts", "Photo gallery"),
			],
			n,
			ANSWERS,
			false,
		).board;

		expect(after.cards.map((c) => [c.id, c.text, c.status])).toEqual([
			["c1", "Booking", "proposed"],
			["c2", "Price list", "dismissed"],
			["c3", "Gallery", "kept"],
		]);

		// Without a ref, an item that says the same idea as an open card would reword it; not into a set-aside idea.
		let other = started(
			suggested("parts", "Booking"),
			suggested("parts", "Price list"),
		);

		other = setAside(other, "c2");
		let m: number;
		[other, m] = sendRequest(other);

		expect(
			applyReply(
				other,
				[suggested("parts", "Price list booking")],
				m,
				ANSWERS,
				false,
			).board.cards[0].text,
		).toBe("Booking");
	});

	it("brings an edited card back as edited, so the outline still says the words are the visitor's", () => {
		let board = started(suggested("parts", "Booking"));
		board = editCard(board, "c1", "Booking with a $20 deposit");
		board = setAside(board, "c1");
		board = bringBack(board, "c1");

		expect(board.cards[0].status).toBe("edited");
		const outline = briefOutline(board, ANSWERS);

		expect(outline).toEqual([
			{ lane: "parts", text: "Booking with a $20 deposit", origin: "edited" },
		]);
		expect(readBriefOutline(outline, ANSWERS)).toEqual({
			ok: true,
			value: outline,
		});
	});

	it("keeps each lane within its limit when Undo brings an owned card back to a lane a reply has since filled, withdrawing the reply's newest open card", () => {
		let board = emptyBoard();

		for (const note of ["Fans", "Venues", "Press"])
			board = addNote(board, "audience", note);
		board = removeNote(board, "c2");
		let n: number;
		[board, n] = sendRequest(board);
		board = applyReply(
			board,
			[said("audience", "Listeners", "hear new music")],
			n,
			ANSWERS,
			false,
		).board;
		expect(
			board.cards.filter(
				(c) => c.lane === "audience" && c.status !== "dismissed",
			),
		).toHaveLength(3);
		board = undo(board);

		expect(
			board.cards
				.filter((c) => c.lane === "audience")
				.map((c) => [c.text, c.status]),
		).toEqual([
			["Fans", "wrote"],
			["Venues", "wrote"],
			["Press", "wrote"],
		]);
		const outline = briefOutline(board, ANSWERS);

		expect(outline.map((item) => item.text)).toEqual([
			"Fans",
			"Venues",
			"Press",
		]);
		expect(readBriefOutline(outline, ANSWERS).ok).toBe(true);
	});

	it.each([
		"Launch by March 1",
		"Due 2027-01-15",
		"Live before Christmas",
		"Costs about a thousand dollars",
		"Fixed price, affordable",
		"Kazon can deliver it next month",
		"Ready next week",
		"Done by the end of the year",
	])("refuses the commitment %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"Pricing",
		"Price list",
		"Request a quote",
		"Budget planner",
		"Booking calendar",
		"Classes in May",
		"When do you need it by?",
	])("still accepts %s", (text) => {
		expect(commits(text)).toBe(false);
	});

	it("fits a request to its limit by leaving out set-aside cards, then the visitor's, never the open ones", () => {
		const card = (ref: string, state: "open" | "yours" | "avoid") => ({
			ref,
			lane: "parts" as const,
			text: "x".repeat(1000),
			state,
		});

		const cards = [
			card("c1", "open"),
			card("c2", "yours"),
			card("c3", "yours"),
			card("c4", "avoid"),
			card("c5", "avoid"),
		];

		expect(fitContext(cards, 3500).map((c) => c.ref)).toEqual([
			"c1",
			"c2",
			"c3",
		]);
		expect(fitContext(cards, 5500).map((c) => c.ref)).toEqual(["c1"]);
		expect(fitContext(cards, 6900).map((c) => c.ref)).toEqual(["c1"]);
		expect(fitContext(cards, 100)).toEqual(cards);
	});
});

describe("found in the second review", () => {
	it("withdraws before it adds, so a reply that rewords a full lane's open cards does not empty it", () => {
		let board = started(
			suggested("audience", "Fans"),
			suggested("audience", "Venues"),
			suggested("audience", "Press"),
		);

		let n: number;
		[board, n] = sendRequest(board);

		const after = applyReply(
			board,
			[suggested("audience", "Listeners"), suggested("audience", "Promoters")],
			n,
			ANSWERS,
			false,
		);

		expect(after.withdrawn).toBe(3);
		expect(after.added).toBe(2);
		expect(after.board.cards.map((c) => c.text)).toEqual([
			"Listeners",
			"Promoters",
		]);
	});

	it("leaves a card as it is when the reply names it but its new version is left out, while its passage is still there", () => {
		let board = started(said("parts", "Shows", "upcoming shows near them"));
		let n: number;
		[board, n] = sendRequest(board);

		// The model misquotes the card it names: that version is dropped, and the card stays.
		const misquoted = applyReply(
			board,
			[said("parts", "Shows", "upcoming gigs near them", "c1")],
			n,
			ANSWERS,
			false,
		);

		expect(misquoted.board.cards.map((c) => c.text)).toEqual(["Shows"]);

		// The server dropped the version (a commitment, say) and passed on only that it named c1.
		const dropped = applyReply(board, [], n, ANSWERS, false, ["c1"]);

		expect(dropped.board.cards.map((c) => c.text)).toEqual(["Shows"]);
		// A ref names nothing once the card's own passage has gone from the answers.
		expect(
			applyReply(board, [], n, "A home for my band.", false, ["c1"]).withdrawn,
		).toBe(1);
	});

	it("reads words with combining marks as whole words, and scripts without spaces by their characters", () => {
		const hindi = "हमें किताबें बेचने के लिए एक वेबसाइट चाहिए";

		expect(quotedFrom("किताबें", hindi)).toBe(false);
		expect(quotedFrom("किताबें बेचने के", hindi)).toBe(true);
		const chinese = "我们每周为成人和儿童开课，希望大家可以在网上报名。";

		expect(quotedFrom("每周为成人和儿童开课", chinese)).toBe(true);
		expect(quotedFrom("开课", chinese)).toBe(false);
		expect(quotedFrom("在网上报名", chinese)).toBe(true);
		expect(
			quotedFrom("ในการจองคลาสออนไลน์", "เราต้องการระบบในการจองคลาสออนไลน์"),
		).toBe(true);
	});

	it("quotes the visitor's own words, never characters the model added, and refuses a passage after a negation", () => {
		const answers =
			"We charge 50 for a class. We do not want online payments yet.";

		const [card] =
			readReply(
				{
					cards: [
						{
							lane: "parts",
							text: "Class fees",
							basis: "said",
							quote: "we charge $50 for",
						},
					],
				},
				answers,
			) ?? [];

		expect(card?.quote).toBe("We charge 50 for");
		expect(quotedFrom("want online payments", answers)).toBe(false);
		expect(quotedFrom("online payments yet", answers)).toBe(true);
	});

	it.each([
		"Budget around 5000",
		"Estimate: 3,000",
		"Under 1,000",
		"Costs 500",
		"＄500 build",
		"Around 5k",
		"Launch tomorrow",
		"Launch in Q3 2027",
		"Two-week sprint",
		"Done within a fortnight",
		"Listo en 3 semanas",
		"Lieferung in 2 Wochen",
		"費用は5万円",
		"See shop.de",
		"Visit band.shop",
	])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it("refuses a commitment whatever the answers say, and accepts things that only look like one", () => {
		// The filter is fixed (see commits): a card repeating "4 weeks" is left out, and the words stay in the answers.
		expect(commits("24 hours support")).toBe(true);
		expect(commits("Classes for 4 weeks")).toBe(true);
		expect(commits("4K video")).toBe(false);
		expect(commits("Built with Next.js")).toBe(false);
	});

	it("keeps the newest set-aside cards when it saves, so a long session's board survives a reload", () => {
		let board = addNote(emptyBoard(), "parts", "Press kit");

		for (let i = 0; i < 230; i++) {
			let n: number;
			[board, n] = sendRequest(board);
			board = applyReply(
				board,
				[suggested("parts", `Idea ${i} ${"x".repeat(i % 7)}`)],
				n,
				ANSWERS,
				false,
			).board;
			const open = board.cards.find((c) => c.status === "proposed");

			if (open) board = setAside(board, open.id);
		}

		const read = readSavedBoards(
			JSON.parse(
				JSON.stringify(
					savedBoards({
						boards: { website: board },
						paused: false,
						plain: false,
					}),
				),
			),
		);

		const cards = read.boards.website?.cards ?? [];

		expect(cards.find((c) => c.text === "Press kit")?.status).toBe("wrote");
		expect(cards.filter((c) => c.status === "dismissed")).toHaveLength(200);
	});
});

describe("found in the third review", () => {
	it("never adds a new idea that a card reworded in the same reply now says", () => {
		const board = started(suggested("parts", "Gallery"));
		const [sent, n] = sendRequest(board);

		const after = applyReply(
			sent,
			[
				suggested("parts", "Class booking"),
				suggested("parts", "Class bookings", "c1"),
			],
			n,
			ANSWERS,
			false,
		).board;

		const texts = after.cards.map((c) => c.text);

		expect(
			texts.filter((text) => sameIdea(text, "Class booking")),
		).toHaveLength(1);
	});

	it.each([
		["Budget around $50k", "A $5 coffee for every visitor."],
		["Price: $9,999", "Our plan is $99/month."],
		["Built in 2 weeks", "Classes run for 12 weeks."],
		["Launch in 3 months", "We opened 13 months ago."],
	])("refuses %s, whatever the answers say", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"3週間で完成",
		"3ヶ月で公開",
		"3个月内完成",
		"3天内上线",
		"3개월이 걸립니다",
		"5万円で",
		"Replace the tool that costs $300 a month",
		"Move off www.oldsite.com",
	])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it("stops sending a card as read from the answers once the visitor changes the words it repeated, and still sends one they kept", () => {
		const before =
			"Our classes run weekly. We want online booking for classes.";

		const after = "Our classes run weekly. Customers call us to book.";

		let board = started();
		let n: number;
		[board, n] = sendRequest(board);
		board = applyReply(
			board,
			[
				said("parts", "Online booking", "We want online booking for classes"),
				said("audience", "Students", "Our classes run weekly"),
			],
			n,
			before,
			false,
		).board;
		expect(briefOutline(board, before)).toHaveLength(2);
		expect(briefOutline(board, after).map((item) => item.text)).toEqual([
			"Students",
		]);

		const kept = keepCard(board, "c1");
		const outline = briefOutline(kept, after);

		expect(outline.map((item) => [item.text, item.origin])).toEqual([
			["Students", "answers"],
			["Online booking", "kept"],
		]);
		expect(readBriefOutline(outline, after).ok).toBe(true);
	});

	it("reads a negation only within its sentence, and through a softening word", () => {
		const answers = "Do we have a website now? No. Customers call us to book.";

		expect(quotedFrom("Customers call us to book", answers)).toBe(true);
		expect(
			quotedFrom(
				"want online payments",
				"We don't really want online payments.",
			),
		).toBe(false);
	});

	it.each([
		"Send 3 messages",
		"Show 2 diagrams",
		"Track 10 journeys",
		"A B.Sc in design",
		"Export orders.csv",
	])("accepts %s, which only looks like a duration or a link", (text) => {
		expect(commits(text)).toBe(false);
	});

	it("leaves a card in its lane when the model puts it in another, rather than copying or moving it", () => {
		let board = started(suggested("parts", "Booking"));
		let n: number;
		[board, n] = sendRequest(board);

		const after = applyReply(
			board,
			[suggested("audience", "Booking", "c1")],
			n,
			ANSWERS,
			false,
		).board;

		expect(after.cards.map((c) => [c.lane, c.text])).toEqual([
			["parts", "Booking"],
		]);
	});

	it("withdraws open suggestions before cards read from the answers when Undo fills a lane", () => {
		let board = addNote(emptyBoard(), "audience", "Fans");
		board = addNote(board, "audience", "Venues");
		board = removeNote(board, "c2");
		let n: number;
		[board, n] = sendRequest(board);
		board = applyReply(
			board,
			[
				said("audience", "Listeners", "Fans should hear new music"),
				suggested("audience", "Promoters"),
			],
			n,
			ANSWERS,
			false,
		).board;
		expect(board.cards.map((c) => c.text)).toEqual([
			"Fans",
			"Listeners",
			"Promoters",
		]);

		board = undo(board);

		expect(board.cards.map((c) => c.text)).toEqual([
			"Fans",
			"Venues",
			"Listeners",
		]);
	});

	it.each(["See shop.de", "example.com", "band.xyz/tour"])(
		"still refuses the link %s",
		(text) => {
			expect(commits(text)).toBe(true);
		},
	);
});

describe("found in the fourth review", () => {
	it("keeps a removed note's idea out of its own lane only, rewordings included, until Undo brings the note back", () => {
		let board = addNote(emptyBoard(), "parts", "Booking");
		board = removeNote(board, "c1");
		let n: number;
		[board, n] = sendRequest(board);
		board = applyReply(
			board,
			[
				suggested("parts", "Gift cards"),
				suggested("questions", "Who handles booking changes today?"),
				suggested("parts", "Booking"),
			],
			n,
			ANSWERS,
			false,
		).board;
		expect(board.cards.map((c) => c.text)).toEqual([
			"Gift cards",
			"Who handles booking changes today?",
		]);

		// A reply may not reword another open card into the removed idea.
		[board, n] = sendRequest(board);

		const reworded = applyReply(
			board,
			[
				{ ...suggested("parts", "Booking"), ref: "c2" },
				{
					...suggested("questions", "Who handles booking changes today?"),
					ref: "c3",
				},
			],
			n,
			ANSWERS,
			false,
		).board;

		expect(reworded.cards.map((c) => c.text)).toEqual([
			"Gift cards",
			"Who handles booking changes today?",
		]);

		const back = undo(addNote(emptyBoard(), "parts", "Online booking"));

		expect(back.removed ?? []).toEqual([]);

		const restored = undo(
			removeNote(addNote(emptyBoard(), "parts", "Online booking"), "c1"),
		);

		expect(restored.removed).toEqual([]);
		expect(restored.cards.map((c) => c.text)).toEqual(["Online booking"]);
	});

	it("leaves a card where it was when the reply moves it to a full lane", () => {
		let board = addNote(emptyBoard(), "purpose", "One");
		board = addNote(board, "purpose", "Two");
		let n: number;
		[board, n] = sendRequest(board);
		board = applyReply(
			board,
			[suggested("parts", "Track attendance")],
			n,
			ANSWERS,
			false,
		).board;
		[board, n] = sendRequest(board);

		const after = applyReply(
			board,
			[{ ...suggested("purpose", "Track attendance"), ref: "c3" }],
			n,
			ANSWERS,
			false,
		);

		expect(after.board.cards.map((c) => [c.lane, c.text])).toEqual([
			["purpose", "One"],
			["purpose", "Two"],
			["parts", "Track attendance"],
		]);
		expect(after.withdrawn).toBe(0);
	});
});

describe("found in the fifth review", () => {
	it("restores one removed note per Undo, so an earlier removal of the same words still stands", () => {
		let board = removeNote(addNote(emptyBoard(), "parts", "Booking"), "c1");
		board = removeNote(addNote(board, "parts", "Booking"), "c2");
		expect(board.removed).toHaveLength(2);
		board = undo(board);
		expect(board.removed).toEqual([{ lane: "parts", text: "Booking" }]);
	});

	it("keeps a card the reply names from another lane only while it still stands", () => {
		let board = started(
			said("purpose", "Small business owners", "Fans should hear new music"),
		);

		let n: number;
		[board, n] = sendRequest(board);

		const moved = {
			...said("audience", "Fans", "Fans should hear new music"),
			ref: "c1",
		};

		expect(
			applyReply(board, [moved], n, ANSWERS, false).board.cards,
		).toHaveLength(1);
		expect(
			applyReply(board, [moved], n, "A home for my band.", false).withdrawn,
		).toBe(1);
	});

	it.each(["創業10周年記念サイト", "10주년 기념", "3원칙", "Step 1 주문 접수"])(
		"accepts %s, which only looks like a duration or a price",
		(text) => {
			expect(commits(text)).toBe(false);
		},
	);

	it.each([
		"3주 동안",
		"10만 원",
		"5천만원",
		"5千元",
		"予算10万",
		"3ヵ月で",
		"24時間対応",
	])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});
});

describe("found in the sixth review", () => {
	it("still names the card in the reply card's own lane that says its idea, when its ref points at another lane", () => {
		let board = started(
			suggested("parts", "Local fans"),
			suggested("audience", "Local fans nearby"),
		);

		let n: number;
		[board, n] = sendRequest(board);

		const after = applyReply(
			board,
			[{ ...suggested("audience", "Local fans"), ref: "c1" }],
			n,
			ANSWERS,
			false,
		);

		expect(after.withdrawn).toBe(0);
		expect(after.board.cards.map((c) => [c.lane, c.text])).toEqual([
			["parts", "Local fans"],
			["audience", "Local fans"],
		]);
	});

	it("prunes a removed note only when Undo brings that note back", () => {
		let board = removeNote(addNote(emptyBoard(), "parts", "Booking"), "c1");
		board = addNote(board, "parts", "Booking");
		board = editCard(board, "c2", "Gallery");
		board = undo(board);
		expect(board.removed).toEqual([{ lane: "parts", text: "Booking" }]);
	});

	it.each([
		"1주일 안에",
		"2주일만에 완성",
		"3주간의 개발",
		"3주가 걸려요",
		"10만원은",
		"100만원의 예산",
		"5만원도",
		"預算10萬",
	])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each(["支持4块硬盘", "首页分3块内容", "1時間目の授業"])(
		"accepts %s",
		(text) => {
			expect(commits(text)).toBe(false);
		},
	);

	it("does not read back a set-aside card whose words commit, unless the visitor reworded it", () => {
		const read = readSavedBoards({
			boards: {
				website: {
					cards: [
						{
							id: "c1",
							lane: "parts",
							text: "Launch page by spring",
							status: "dismissed",
							basis: "suggested",
							quote: "",
							reason: "",
							answer: "",
						},
						{
							id: "c2",
							lane: "parts",
							text: "Launch page by spring",
							status: "dismissed",
							basis: "suggested",
							quote: "",
							reason: "",
							answer: "",
							edited: true,
						},
						{
							id: "c3",
							lane: "parts",
							text: "Shows",
							status: "proposed",
							basis: "suggested",
							quote: "",
							reason: "Ready in 2 weeks",
							answer: "",
						},
					],
				},
			},
		});

		expect(read.boards.website?.cards.map((c) => [c.id, c.reason])).toEqual([
			["c2", ""],
			["c3", ""],
		]);
	});
});

describe("found in the seventh review", () => {
	it.each(["100块钱", "大概500块钱", "3時間目安"])("refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"1일차 코스",
		"여행 2일차 일정",
		"1주차 강의 자료",
		"3년차 이상 마케터",
		"B2 주차장 안내",
		"支持4块硬盘",
	])("accepts %s", (text) => {
		expect(commits(text)).toBe(false);
	});
});

describe("found in the eighth review", () => {
	it.each([
		"일정이 2주 차이 납니다",
		"3주간 차질 없이",
		"1년 차이가 나요",
		"배송이 3일 차이",
		"첫 1주 차량 무료",
		"5일 차감",
	])("still refuses the spaced duration in %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each(["1주 차", "1주 차에 런칭", "3년 차인 디자이너", "2주 차부터"])(
		"accepts the ordinal %s",
		(text) => {
			expect(commits(text)).toBe(false);
		},
	);
});

describe("found in the ninth review", () => {
	it.each([
		"1주 차엔 기획",
		"1년 차와 3년 차 직원",
		"1주 차만 무료인가요?",
		"1주 차마다 리포트",
		"1주 차보다",
		"1주 차쯤",
		"1주 차랑",
		"1주 차하고",
		"개발 3년 차입니다",
		"3년 차예요",
		"3년 차라서",
		"3년 차지만",
		"3년 차였어요",
		"3년 차면",
	])("accepts the ordinal %s", (text) => {
		expect(commits(text)).toBe(false);
	});

	it.each([
		"2주간 차를 렌트",
		"1년간 차를 운행",
		"2주간 차에서 촬영",
		"3주간 차도 없이",
		"2주간 차",
		"2주간 차로 이동",
		"2주일간 차를",
	])("refuses the duration in %s", (text) => {
		expect(commits(text)).toBe(true);
	});
});

describe("found by the automated review", () => {
	it.each([
		"USD 5,000 including launch support",
		"EUR 300 a month",
		"about GBP 2k",
		"cad 900",
	])("refuses an amount after its currency's code: %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"A USB drive with the photos",
		"Euro-style booking form",
		"The CAD drawings",
	])("accepts words that only look like a currency: %s", (text) => {
		expect(commits(text)).toBe(false);
	});
});

describe("found in the tenth review", () => {
	it.each([
		"3년 차여서 경험이 많음",
		"입사 1년 차일 때 필요한 정보",
		"3년 차라면",
		"10년 차라는 경험",
		"3년 차니까",
		"1주 차나 2주 차에",
		"1주 차든 2주 차든",
		"3년 차죠",
		"1주 차밖에",
	])("accepts the ordinal %s", (text) => {
		expect(commits(text)).toBe(false);
	});

	it.each([
		"2주면 충분",
		"2주를 예상",
		"1년은 걸려요",
		"2주짜리 프로젝트",
		"3일밖에 안 걸려요",
		"2주로 단축",
		"2주에 걸쳐 진행",
		"3주미만",
		"3일까지",
		"1년 차입금",
		"3일 차라리",
	])("refuses the duration in %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"10주년 기념",
		"Step 1 주문 접수",
		"1주차를",
		"1일차부터",
		"4년제로",
	])("still accepts %s", (text) => {
		expect(commits(text)).toBe(false);
	});
});

describe("found in the eleventh review", () => {
	it.each([
		"CAD 3D modeling services",
		"Upload CAD 3D files",
		"CAD 2D drafting and 3D renders",
		"Windows 11 주로 사용",
		"React 18 주로 사용, 일부 Vue 3",
		"아이폰 15 주로 사용",
		"기기: 갤럭시 S24 주로, 일부 아이폰",
		"STEP 2 주로 모바일에서",
		"별점 5 주면 쿠폰 지급",
		"포인트 100 주나요",
		"1876년부터 이어온 전통",
		"1800년으로 거슬러",
	])("accepts %s again", (text) => {
		expect(commits(text)).toBe(false);
	});

	it.each([
		"USD 5,000",
		"EUR 300 a month",
		"about GBP 2k",
		"cad 900",
		"2주면 충분",
		"2주를 예상",
		"2주짜리 프로젝트",
		"2주에 걸쳐 진행",
		"3주미만",
		"3일까지",
		"3주 안에 완료",
	])("still refuses %s", (text) => {
		expect(commits(text)).toBe(true);
	});
});

describe("found in the twelfth review", () => {
	it.each([
		"FY2027년 상반기 출시",
		"CY2026년 하반기",
		"FY2027년까지 완료",
		"FY2027년부터",
	])("refuses the year in %s", (text) => {
		expect(commits(text)).toBe(true);
	});

	it.each([
		"1876년부터 이어온 전통",
		"1800년으로 거슬러",
		"5000년 역사의 전통",
	])("still accepts the history in %s", (text) => {
		expect(commits(text)).toBe(false);
	});
});
