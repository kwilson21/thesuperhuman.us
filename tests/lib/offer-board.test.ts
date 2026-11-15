// The offer board's reply reader and its lanes under the living brief's rules (docs/plans/2026-11-offer-board.md).
import { describe, expect, it } from "vitest";
import {
	type ReplyCard,
	applyReplyIn,
	emptyBoard,
	keepCard,
	sendRequest,
} from "~/lib/brief-board";
import {
	OFFER_LANE_CONFIG,
	type OfferLane,
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
