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
			reason: "pass",
		});
		expect(readBoardAnswer({ ok: true, cards: [] })).toEqual({
			cards: { cards: [] },
			reason: "",
		});
		expect(readBoardAnswer({ reason: "whatever" }).reason).toBe("");
		expect(readBoardAnswer("nope")).toEqual({ cards: undefined, reason: "" });
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

	it("adds and removes the visitor's notes, and Undo puts a removed note back where it was", () => {
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
			[{ lane: "parts", text: "Costs $500", origin: "kept" }],
			[{ lane: "parts", text: "Two\nlines", origin: "wrote" }],
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

	it("keeps each lane of the outline within its limit when Undo has filled it past, leaving out what the visitor does not own", () => {
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
		board = undo(board);

		expect(board.cards.filter((c) => c.lane === "audience")).toHaveLength(4);
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
