// The offer board's reply reader and its lanes under the living brief's rules (docs/plans/2026-11-offer-board.md).
import { describe, expect, it } from "vitest";
import { OFFER_INSTRUCTIONS } from "../../src/server/offer-board-model";
import {
	type ReplyCard,
	applyReplyIn,
	bringBackIn,
	editCardIn,
	emptyBoard,
	keepCard,
	lastAction,
	markStep,
	pricesOrLinks,
	sendRequest,
	setAside,
	undoIn,
	useCard,
} from "~/lib/brief-board";
import {
	OFFER_CONTENT_MAX,
	OFFER_CONTEXT_MAX,
	OFFER_LANES,
	OFFER_LANE_CONFIG,
	type OfferContextCard,
	type OfferLane,
	fitOfferCards,
	offerLaneLimits,
	pricingKind,
	readOfferReply,
} from "~/lib/offer-board";

const milestone = {
	lane: "milestones",
	text: "Design direction",
	deliverables: ["Page list", "Homepage design"],
	acceptance: ["Approve the homepage"],
	daysLow: 2,
	daysHigh: 3.5,
};

describe("reading the offer board's reply", () => {
	it("keeps cards within their limits and drops prices, costs, links and milestones without their detail", () => {
		const reply = readOfferReply({
			cards: [
				{
					lane: "outcome",
					text: "A five-page site for the studio",
					reason: "Pages named",
				},
				milestone,
				{ lane: "milestones", text: "Build" },
				{ ...milestone, text: "Too long", daysHigh: 61 },
				{ ...milestone, text: "Backwards", daysLow: 4, daysHigh: 3 },
				{ ...milestone, text: "Quarter days", daysLow: 0.25 },
				{
					...milestone,
					text: "Paid",
					deliverables: ["Hosting at $20 a month"],
				},
				{ lane: "exclusions", text: "Hosting at $20 a month" },
				{ lane: "drivers", text: "See example.com for the style" },
				{ lane: "timing", text: "About 4 weeks from the start date" },
				{ lane: "nowhere", text: "x" },
			],
			size: "small",
			sizeReason: "A few pages",
			figureUsd: 3000,
			figureReason: "Within the range",
		});

		expect(reply?.cards.map((card) => [card.lane, card.text])).toEqual([
			["outcome", "A five-page site for the studio"],
			["milestones", "Design direction"],
			["timing", "About 4 weeks from the start date"],
		]);
		expect(reply?.cards[1].detail).toEqual({
			deliverables: ["Page list", "Homepage design"],
			acceptance: ["Approve the homepage"],
			daysLow: 2,
			daysHigh: 3.5,
		});
		expect(reply).toMatchObject({ size: "small", figureUsd: 3000 });
	});

	it("reads the route's answer, whose milestone detail is nested", () => {
		const { lane, text, ...detail } = milestone;

		const reply = readOfferReply({
			cards: [{ lane, text, reason: "", detail }],
		});

		expect(reply?.cards[0].detail?.daysHigh).toBe(3.5);
	});

	it("keeps a size and figure only when they are one of the sizes and whole dollars", () => {
		expect(
			readOfferReply({ cards: [], size: "huge", figureUsd: 12.5 }),
		).toMatchObject({
			size: null,
			figureUsd: null,
		});
		expect(readOfferReply({ cards: "no" })).toBeNull();
	});

	it("prices only the brief's three kinds", () => {
		expect(
			["website", "webapp", "workflow", "idea", 3].map(pricingKind),
		).toEqual(["website", "webapp", "workflow", null, null]);
	});
});

describe("the offer board's lanes under the board's rules", () => {
	const suggest = (
		lane: OfferLane,
		text: string,
		ref = "",
	): ReplyCard<OfferLane> => ({
		ref,
		lane,
		text,
		basis: "suggested",
		quote: "",
		reason: "",
	});

	it("never changes a card the owner used, and keeps each lane within its limit", () => {
		let [board, n] = sendRequest(emptyBoard<OfferLane>());
		board = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			[suggest("outcome", "A studio site")],
			n,
			"",
			false,
		).board;
		board = keepCard(board, "c1");
		[board, n] = sendRequest(board);

		const after = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			[
				suggest("outcome", "A different outcome", "c1"),
				...[
					"Logo",
					"Photos",
					"Page text",
					"Domain access",
					"Brand colours",
					"Booking calendar",
					"Mailing list export",
					"Venue contacts",
				].map((text) => suggest("inputs", text)),
			],
			n,
			"",
			false,
		).board;

		expect(after.cards.find((card) => card.id === "c1")).toMatchObject({
			text: "A studio site",
			status: "kept",
		});
		expect(after.cards.filter((card) => card.lane === "inputs")).toHaveLength(
			offerLaneLimits.inputs,
		);
	});

	it("withdraws an open card that names a price", () => {
		let [board, n] = sendRequest(emptyBoard<OfferLane>());
		board = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			[suggest("timing", "About 4 weeks")],
			n,
			"",
			false,
		).board;
		[board, n] = sendRequest(board);

		// The card is named, but a card that names a price no longer stands, so the name does not keep it.
		const after = applyReplyIn(
			OFFER_LANE_CONFIG,
			{
				...board,
				cards: board.cards.map((card) => ({ ...card, text: "$500 a week" })),
			},
			[],
			n,
			"",
			false,
			["c1"],
		);

		expect(after.withdrawn).toBe(1);
	});
});

describe("found in the offer board's first review", () => {
	const suggest = (lane: OfferLane, text: string): ReplyCard<OfferLane> => ({
		ref: "",
		lane,
		text,
		basis: "suggested",
		quote: "",
		reason: "",
	});

	const withCard = () => {
		const [board, n] = sendRequest(emptyBoard<OfferLane>());

		return applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			[suggest("outcome", "A studio site")],
			n,
			"",
			false,
		).board;
	};

	it("uses an open, an edited and a brought-back card, each as a step Undo names, and never a set-aside one", () => {
		const open = useCard(withCard(), "c1");

		expect(open.cards[0].status).toBe("kept");
		expect(lastAction(open)).toBe("used “A studio site”");

		const edited = useCard(
			editCardIn(OFFER_LANE_CONFIG, withCard(), "c1", "A pottery studio site"),
			"c1",
		);

		expect(edited.cards[0].status).toBe("kept");
		expect(edited.history).toHaveLength(2);

		const back = bringBackIn(
			OFFER_LANE_CONFIG,
			setAside(withCard(), "c1"),
			"c1",
		);

		expect(back.cards[0].status).toBe("kept");
		expect(useCard(back, "c1").history).toHaveLength(3);
		expect(undoIn(OFFER_LANE_CONFIG, useCard(back, "c1")).cards).toEqual(
			back.cards,
		);

		const aside = setAside(withCard(), "c1");

		expect(useCard(aside, "c1")).toBe(aside);
	});

	it("can show the model the whole board: every lane's cards fit in one request", () => {
		const total = OFFER_LANES.reduce(
			(sum, lane) => sum + offerLaneLimits[lane],
			0,
		);

		expect(total).toBeLessThanOrEqual(OFFER_CONTEXT_MAX);
	});

	it("fits a request to the route's limit by leaving out set-aside cards, then the owner's, never open ones", () => {
		const card = (
			ref: string,
			state: OfferContextCard["state"],
		): OfferContextCard => ({
			ref,
			lane: "inputs",
			text: "x".repeat(400),
			state,
		});

		const cards = [
			card("c1", "open"),
			card("c2", "yours"),
			card("c3", "yours"),
			card("c4", "avoid"),
			card("c5", "avoid"),
		];

		expect(fitOfferCards(cards, 1000)).toEqual(cards);
		expect(
			fitOfferCards(cards, OFFER_CONTENT_MAX - 1000).map((each) => each.ref),
		).toEqual(["c1", "c2"]);
		expect(
			fitOfferCards(cards, OFFER_CONTENT_MAX).map((each) => each.ref),
		).toEqual(["c1"]);
	});
});

describe("found by the automated review", () => {
	it.each(["USD 5,000 including launch support", "EUR 300 a month"])(
		"drops a card that names an amount after its currency's code: %s",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
			expect(
				readOfferReply({ cards: [{ lane: "exclusions", text, reason: "" }] })
					?.cards,
			).toEqual([]);
		},
	);
});

describe("found in the offer board's second review", () => {
	it("records a step that changes no card, for an action beside the board, which Undo then takes back", () => {
		let [board, n] = sendRequest(emptyBoard<OfferLane>());
		board = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			[
				{
					ref: "",
					lane: "milestones",
					text: "Design direction",
					basis: "suggested",
					quote: "",
					reason: "",
				},
			],
			n,
			"",
			false,
		).board;
		board = useCard(board, "c1");

		const marked = markStep(board, "c1", "set the fee of “Design direction”");

		expect(marked.cards).toEqual(board.cards);
		expect(lastAction(marked)).toBe("set the fee of “Design direction”");
		expect(undoIn(OFFER_LANE_CONFIG, marked).cards).toEqual(board.cards);
		expect(markStep(board, "c9", "nothing")).toBe(board);
	});
});

describe("found in the offer board's sixth review", () => {
	it.each([
		"Estimated 6 weeks from the start date",
		"Delivery estimate: 4 to 6 weeks after kickoff",
		"Estimated 16 weeks",
		"Each payment integration costs 2 to 3 extra days",
		"Quote 3 shipping carriers at checkout",
		"Estimated 5 pages",
		"Estimated 1,500 pages of archive",
		"Import up to 2,000 products",
		"A catalog of a few hundred items",
		"Choose a low-cost host",
		"Connect the RS 232 scale to the till",
	])("keeps %s: a duration or a count is not money", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});

	it.each([
		"Hosting at 20 € a month",
		"A deposit of 1.500 € before the start",
		"Domain renewal, 15 CHF a year",
		"A 5k USD shop",
		"Rs. 50,000 for the build",
		"50 000 kr in all",
		"A fee of 500",
		"It costs 500 a month",
		"Price: 1,500.",
		"A fee of 500 per milestone",
		"Fees 500 to 700",
		"Hosting at $20 a month",
		"USD 5,000 for the build",
		"5,000 dollars",
		"See clutch.co for more",
	])("drops %s: money, wherever its currency stands, or a link", (text) => {
		expect(pricesOrLinks(text)).toBe(true);
	});

	it("keeps a timing card in weeks, and drops a figure reason that names a bare domain", () => {
		const reply = readOfferReply({
			cards: [
				{
					lane: "timing",
					text: "Estimated 6 weeks from the start date",
					reason: "Two milestones",
				},
			],
			figureUsd: 4000,
			figureReason: "Clutch.co and goodfirms.co list similar sites near this",
		});

		expect(reply?.cards.map((card) => card.text)).toEqual([
			"Estimated 6 weeks from the start date",
		]);
		expect(reply?.figureReason).toBe("");
	});
});

describe("found in the offer board's seventh review", () => {
	it.each([
		"A fixed fee of 4,800 covers design and build",
		"Budget of 5,000 for the first version",
		"Estimated cost 6,500 including launch support",
		"Quoted at 3,000 for three pages",
		"Price 2,400 for the first milestone",
		"Fee 3,000 plus VAT",
		"Fee: 1,500 (half on signing)",
		"Budget 10,000 or less",
		"Hosting costs 25/month after handoff",
		"Homepage design (fee 1,200 on approval)",
		"Presupuesto estimado: 3.000 dólares",
		"Orçamento de 5.000 reais",
		"Kosten: 5.000",
		"Prix : 3 000",
		"Цена 50 000 руб.",
		"Koszt 20 000 zł",
		"Fiyat 50.000 TL",
		"₺50.000",
		"₪20,000",
		"50,000 pesos",
		"5.000 R$",
		"Precio: 2.500",
		"Preis 4.000 netto",
	])(
		"drops %s: a large amount after a money word, or money in another language",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Estimated 120 hours",
		"Budget 2 rounds of revisions",
		"Import 3 CAD file types",
		"Convert drawings from 2 CAD formats to PDF",
		"Estimated 6, up to 8 weeks from the start date",
		"Estimated: 4, possibly 5 weeks",
		"Estimated 5k users at launch",
		"Price 5k products",
		"Quote 5k items",
		"Estimated 1,200 product pages",
		"Unas 6 semanas desde el inicio",
		"Plazo estimado: 4 a 6 semanas",
	])("keeps %s: a duration, a count or a file format", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});

	it("reads long text quickly", () => {
		const long =
			"Estimated 6 weeks for design, build and launch with a fee of review ".repeat(
				150,
			);

		const start = performance.now();

		pricesOrLinks(long);
		expect(performance.now() - start).toBeLessThan(500);
	});

	// Digit groups after "a" or "the" made one form of the test try every position (the twenty-ninth review: 2.7 s).
	it.each([
		"1" + " 000".repeat(1250),
		"a 1" + " 000".repeat(1250),
		"the fee 1" + ",000".repeat(1250),
	])("reads long digit groups quickly", (long) => {
		const start = performance.now();

		pricesOrLinks(long);
		expect(performance.now() - start).toBeLessThan(1000);
	});
});

describe("found in the offer board's eighth review", () => {
	it.each([
		"Costs 1,500 every month",
		"Fee 3,000 every month for hosting",
		"Fee 3,000 next month",
		"Fee 2,400 this year",
		"Fee 3,000 first month",
		"Cost 1,500 every sprint",
		"Budget of 4,500 across milestones",
		"Pauschal 5.000,- €",
		"Hosting 20,- € im Monat",
		"5.000,- EUR",
		"2 000 рублей",
		"2 000 рубля",
		"Хостинг 300 евро",
		"500 долларов",
	])("drops %s", (text) => {
		expect(pricesOrLinks(text)).toBe(true);
	});

	it.each([
		"Cada integración de pago tiene un costo de 2 a 3 días extra",
		"Cada integração de pagamento tem um custo de 2 a 3 dias extras",
		"Costo de 2 a 3 días por integración",
		"Estimated 200+ product pages",
		"Estimated 1,500+ products to import",
	])("keeps %s", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's ninth review", () => {
	it.each([
		"Fee 1,500.00 for the build",
		"The fee is 4,500.00.",
		"Costs 1,200.00 per month",
		"Quote 10,000.00 total",
		"Budget of 12,500.50",
		"Preis: 1.500,00",
		"Precio: 2.500,00 por la integración",
		"Hosting, billed separately at a fee of 1,200.00 a year",
	])("drops %s: a large amount with cents after a money word", (text) => {
		expect(pricesOrLinks(text)).toBe(true);
	});

	it("keeps a count with a thousands separator after a money word", () => {
		expect(pricesOrLinks("Estimated 1,500 rows of history")).toBe(false);
	});
});

describe("found in the offer board's fourteenth review", () => {
	it.each([
		"The budget is about 5,000",
		"A fee of around 4,800",
		"Quote of about 2,500",
		"Estimate is approximately 6,000",
		"Price: about 4,800",
		"Budget: roughly 5,000",
		"Budget is about 5k",
		"Kosten von ca. 2.000",
		"Presupuesto de aproximadamente 3.000",
		"The fee is about 50.",
		"A fee of about 25/month",
	])(
		"drops %s: two connectors, or a colon then a connector, before the amount",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Estimate is about 6 weeks",
		"Fee is about 120 hours of work",
		"Estimated about 1,500 pages",
		"Estimated: 4, possibly 5 weeks",
		"Cost of about 3 days per integration",
	])("keeps %s: a duration or a count after the connectors", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});

	it("leaves out a deliverable that repeats an earlier one, as the offer editor compares them", () => {
		const reply = readOfferReply({
			cards: [
				{
					...milestone,
					deliverables: ["Homepage design", "homepage  design", "Page list"],
				},
			],
		});

		expect(reply?.cards[0].detail?.deliverables).toEqual([
			"Homepage design",
			"Page list",
		]);
	});
});

describe("found in the offer board's nineteenth review", () => {
	it.each([
		"El presupuesto del cliente ronda los 5 mil dólares",
		"Hosting costs about 2 thousand dollars a year",
		"Orçamento de cerca de 30 mil reais",
		"Das Budget liegt bei etwa 8 Tausend Euro",
		"Около 300 тысяч рублей",
		"Yaklaşık 10 bin TL",
		"30 tys. zł",
		"Budget: 5 mil USD",
		"Budget around 1.5 million dollars",
		"Unos 5 millones de pesos",
		"Environ 2 millions d’euros",
		"Budget around 5 thousand",
		"About five thousand dollars",
		"A few thousand dollars for hosting",
	])(
		"drops %s: a scale word or a spelled sum before its currency, or after a money word",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Estimated 5 thousand users a month",
		"Import 2 million rows of history",
		"Estimated 3 mil orders",
		"Five thousand subscribers on the list",
		"Up to 10 bin products",
		"About 4 weeks from the start date",
	])("keeps %s: a count or a duration", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's twentieth review", () => {
	it.each([
		"Sixty thousand dollars for the build",
		"Ninety thousand euros",
		"Eighty thousand pounds",
		"Fifteen hundred dollars a month",
		"Twelve hundred dollars upfront",
		"Two hundred thousand dollars",
		"A hundred thousand dollars in all",
		"Twenty-five thousand dollars",
		"Budget of 5 to 10 thousand",
		"Budget of 5-10 thousand",
		"Fee 2 to 3 thousand",
		"Presupuesto de 5 a 10 mil",
		"Orçamento de 20 a 30 mil",
		"Budget 2 Mio.",
	])(
		"drops %s: a spelled sum, a range ending in a scale word, or a dotted scale",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Estimated 2 Mio. pages",
		"Estimated 2 Mio. Seiten",
		"Estimated 10 tys. stron",
		"Estimated 3 млн. страниц",
		"Estimated 10 тыс. страниц",
		"Estimated 1 000 000 pages",
		"Estimated 2 500 000 users",
		"Estimated 5 to 10 thousand users",
	])(
		"keeps %s: a count after a dotted scale, a space-grouped amount or a range",
		(text) => {
			expect(pricesOrLinks(text)).toBe(false);
		},
	);

	it("drops a count before a short scale word that is also an English word (a listed limit)", () => {
		expect(pricesOrLinks("Quote 4 mil poly bags")).toBe(true);
	});
});

describe("found in the offer board's twenty-first review", () => {
	it.each([
		"Fee 1500 100% upfront",
		"Budget 2500 100% on signing",
		"Fee 1500.00 100% upfront",
		"Budget 5 thousand 100% upfront",
		"Budget 5k 100% upfront",
		"Fee 3000 100 percent upfront",
		"Fee 1200 300 for hosting",
		"Kosten 1500 100 % bei Auftrag",
		"Precio 2500 100% por adelantado",
		"Kosten 1.500,00 100 % bei Auftrag",
	])("drops %s: an amount then another number is still money", (text) => {
		expect(pricesOrLinks(text)).toBe(true);
	});

	it.each([
		"Estimated 1 000 000 pages",
		"Estimated 2 500 000 users",
		"Estimated 120 500 users",
	])("keeps %s: a space-grouped count", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's twenty-second review", () => {
	it.each([
		"Fee 1,500 200 pages",
		"Budget 2,000 300 pages",
		"Fee 1.500 300 pages",
		"Quote 4,500 150 pages",
		"Fee 1,200 150 hours of support",
	])(
		"drops %s: a comma or dot grouped amount does not continue as a space-grouped count",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);
});

describe("found in the offer board's twenty-seventh review", () => {
	it.each([
		"A deposit of 1,500 before work starts",
		"Payment of 2,500 due at launch, the rest in two weeks",
		"Budget between 2,000 and 4,000 limits the page count",
		"Hosting, at a rate of 25 per month, paid by the client",
		"A five-page site for a total of 4,500, built in four weeks.",
		"Invoice 1,200 on approval",
		"Total 4,500",
		"Charge 5,000 at launch",
		"Retainer 1,200 monthly",
		"Budget from 2,000 to 4,000",
	])(
		"drops %s: a money word the test did not list, or a range by between or from",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Total 120 products in the catalogue",
		"Estimate from 3 to 4 weeks",
		"Charge 2 rounds of revisions to the next milestone",
		"A conversion rate of 30% on the booking form",
		"Payment in two milestones, half before each starts",
	])("keeps %s: a count, a duration or a rate that is not money", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's twenty-eighth review", () => {
	it.each([
		"A budget of 5,000 and 8 weeks to launch",
		"Fee 4,500 and 6 weeks of work",
		"Price 2,400 and 2 rounds of revisions",
		"A fixed fee of 4,800 and 2 revision rounds",
		"Fees are 1,500 per milestone",
		"The fee will be about 4,500",
		"Budget was 5,000",
		"Costs range from 2,000 to 4,000",
		"Budget totals 4,500",
		"A 4,500 fee covers design and build",
		"The 1,200 deposit is due on signing",
		"El presupuesto es de 5.000",
		"Le coût est de 3 000",
		"Il prezzo è di 3.000",
		"O orçamento é de 5.000",
		"Die Kosten betragen 5.000",
		"Der Preis liegt bei 3.000",
		"A day rate of 600",
		"Fee between 20 and 30 per page",
	])(
		"drops %s: money joined by and, after a verb, or before its money word",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Milestones total 3",
		"Pages in total: 12.",
		"Screens in total: 8",
		"Two releases at a rate of 1 per week.",
		"Estimated between 1,500 and 2,000 pages",
		"Import 3,000 invoices from the old system",
		"Price is 3 pages long",
		"The fee will cover 3 rounds",
		"Rate limits of 60 per minute",
	])("keeps %s: a count after total, rate or a verb", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's twenty-ninth review", () => {
	it.each([
		"Changes after launch, billed at an hourly rate of 95.",
		"Hourly rate: 85",
		"Support after handoff at a day rate of 90.",
		"Rate 95.00 for extra rounds",
		"Total 95.00",
		"Rate of 95 per page",
		"Extra changes at a rate of 95.",
		"A 4,500-dollar fee",
		"A 5,000-euro budget",
		"A 4,500 flat fee",
		"The 2,500 launch fee",
		"Payments of 2,500 due at launch",
	])("drops %s: a rate, cents or an amount before its money word", (text) => {
		expect(pricesOrLinks(text)).toBe(true);
	});

	it.each([
		"Invoices are about 40 a month, all sent by hand",
		"Invoices are 1,200 a year",
		"Payments are 25 per week",
		"Deposits come 3 a week",
		"Estimated between roughly 120 and 160 hours",
		"Estimated between about 1,500 and 2,000 pages",
		"Import the 2026 budget from the spreadsheet",
		"Track spend against the FY2027 budget",
		"Migrate 2,000 fee records",
		"Migrate the 2,000 fee records",
		"Match 1,200 deposit transactions",
		"Payments to 1,500 suppliers",
		"A conversion rate of 30 per cent",
		"Send 1,500 invoices a month",
	])("keeps %s: a count, a year or a range of hours", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});
});

describe("found in the offer board's thirtieth review", () => {
	it.each([
		"A 2,000 non-refundable deposit",
		"A 4,500 one-time fee",
		"Take a 1,500 one-off fee for setup",
		"A 500 set-up fee",
		"A 1,500 up-front deposit",
		"A 4,500 fixed-price fee",
	])(
		"drops %s: a hyphenated word between the amount and its money word",
		(text) => {
			expect(pricesOrLinks(text)).toBe(true);
		},
	);

	it.each([
		"Migrate the 2,000 fee records",
		"Import the 2026 budget from the spreadsheet",
		"Match 1,200 deposit transactions",
	])("keeps %s", (text) => {
		expect(pricesOrLinks(text)).toBe(false);
	});

	// The reader tests the AI's reasons only at a bounded length (both tests were quadratic on long runs).
	it.each([
		["sizeReason", "-.".repeat(40000)],
		["figureReason", "-.".repeat(40000)],
		["sizeReason", `1${" 000".repeat(20000)}`],
	])("reads a long %s quickly", (key, text) => {
		const start = performance.now();

		readOfferReply({ cards: [], [key]: text });
		expect(performance.now() - start).toBeLessThan(1000);
	});
});

describe("found in the offer board's thirty-first review", () => {
	it("keeps a card whose reason is too long to show, without the reason", () => {
		const reply = readOfferReply({
			cards: [
				{
					lane: "milestones",
					text: "Design direction",
					reason: "Because ".repeat(30),
					deliverables: ["A homepage design"],
					acceptance: ["The band approves the homepage"],
					daysLow: 2,
					daysHigh: 3,
				},
			],
		});

		expect(reply?.cards).toHaveLength(1);
		expect(reply?.cards[0]?.reason).toBe("");
	});
});

describe("found in the offer board's thirty-second review", () => {
	const hosting = (reason: string, ref = "") =>
		readOfferReply({
			cards: [{ ref, lane: "inputs", text: "Hosting access", reason }],
		})?.cards ?? [];

	it("drops a card whose long reason names money or a link, shown or not", () => {
		expect(
			hosting(
				`${"Because the client needs it. ".repeat(6)}It costs $5,000 per year.`,
			),
		).toHaveLength(0);
		expect(
			hosting(
				`See https://example.com/hosting ${"for the details. ".repeat(10)}`,
			),
		).toHaveLength(0);
	});

	it("keeps a card whose reason is far too long to show, without the reason", () => {
		const cards = hosting("Because the client needs it. ".repeat(20));

		expect(cards).toHaveLength(1);
		expect(cards[0]?.reason).toBe("");
	});

	it("reads a ref the board never gave as none, and keeps the card", () => {
		const cards = hosting("The client gives it", "new-outcome-1");

		expect(cards).toHaveLength(1);
		expect(cards[0]?.ref).toBe("");
		expect(hosting("The client gives it", "c12")[0]?.ref).toBe("c12");
	});

	it("tells the model each milestone's days run from 0.5 to 60 and a new card's ref is empty", () => {
		expect(OFFER_INSTRUCTIONS).toContain("each from 0.5 to 60");
		expect(OFFER_INSTRUCTIONS).toContain("A new card has an empty ref.");
	});
});

describe("found in the offer board's thirty-third review", () => {
	const reasonOf = (reason: string) =>
		readOfferReply({
			cards: [{ lane: "inputs", text: "Hosting access", reason }],
		})?.cards ?? [];

	it("measures a reason after collapsing its spaces, so a long one is never shown cut", () => {
		const cards = reasonOf(
			`Needed early.${" ".repeat(250)}${"The client must give the hosting login before the build starts. ".repeat(3)}`,
		);

		expect(cards).toHaveLength(1);
		expect(cards[0]?.reason).toBe("");
	});

	it("drops a card whose reason names money after a long run of new lines", () => {
		expect(
			reasonOf(`Similar sites:${"\n".repeat(330)}about 5,000 dollars`),
		).toHaveLength(0);
	});
});
