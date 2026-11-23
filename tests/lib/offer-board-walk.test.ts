// The board's rules with the offer board's lanes and limits (OFFER_LANE_CONFIG), checked on the real code. The brief's
// walk (tests/lib/brief-board-walk.test.ts) stays in one lane with a high limit; the offer board's lanes hold two to six
// cards, so this walk reaches full lanes often. A seeded random walk mixes the owner's Use, Edit, Not this, Bring back and
// Undo with requests answered late, out of order and overlapping by an adversarial model: any lane, rewordings, refs to
// owned or set-aside cards, and text naming a price or a link. After every step the properties must hold.
import { describe, expect, it } from "vitest";
import {
	type Board,
	type ReplyCard,
	applyReplyIn,
	bringBackIn,
	editCardIn,
	emptyBoard,
	isOwned,
	pricesOrLinks,
	sameIdea,
	sendRequest,
	setAside,
	undoIn,
	useCard,
} from "~/lib/brief-board";
import {
	OFFER_LANES,
	OFFER_LANE_CONFIG,
	type OfferLane,
	offerLaneLimits,
	readOfferReply,
} from "~/lib/offer-board";

/** mulberry32: a small seeded generator, so a failure names the seed that reproduces it. */
function random(seed: number) {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Distinct words per lane, so two ideas are never taken for the same one; more ideas than a lane holds.
const IDEAS: Record<OfferLane, string[]> = {
	outcome: [
		"Bookings online",
		"Fans hear music",
		"Venues reach us",
		"Mailing growth",
	],
	summary: ["Four pages built", "Booking form included", "Shows calendar"],
	milestones: [
		"Design direction",
		"Build launch",
		"Mailing setup",
		"Shows import",
	],
	inputs: [
		"Logo files",
		"Song recordings",
		"Show dates",
		"Photos",
		"Venue contacts",
		"Bio text",
		"Domain access",
	],
	exclusions: [
		"Ticket sales",
		"Merch store",
		"Hosting",
		"Copywriting",
		"Photography",
		"Video",
		"Translations",
	],
	timing: ["Five weeks", "Starts Monday", "Quick turnaround"],
	questions: [
		"Who updates shows?",
		"Which mailing service?",
		"Own domain already?",
		"Booking by email?",
		"Photos ready?",
	],
	drivers: [
		"Content readiness",
		"Mailing integration",
		"Booking rules",
		"Design rounds",
		"Shows feed",
	],
};

type Request = { n: number; live: boolean };

function walk(seed: number, steps: number) {
	const next = random(seed);

	const pick = <T>(items: readonly T[]): T | undefined =>
		items.length ? items[Math.floor(next() * items.length)] : undefined;

	let board: Board<OfferLane> = emptyBoard<OfferLane>();
	const requests: Request[] = [];
	// Ghosts: ids the owner set aside and has not brought back, and the requests sent when Undo last reopened a card.
	const rejected = new Set<string>();
	const restoredAt = new Map<string, number>();
	const failures: string[] = [];

	const seen = {
		fullLane: 0,
		undoInFlight: 0,
		reofferBlocked: 0,
		ownedNamed: 0,
		olderDropped: 0,
		readerDropped: 0,
	};

	const fail = (step: number, what: string) =>
		failures.push(`seed ${seed}, step ${step}: ${what}`);

	for (let step = 0; step < steps; step++) {
		const roll = next();
		const before = board;

		if (roll < 0.12) {
			const target = pick(
				board.cards.filter(
					(c) => c.status !== "dismissed" && c.status !== "wrote",
				),
			);

			if (target) board = useCard(board, target.id);
		} else if (roll < 0.18) {
			const target = pick(board.cards.filter((c) => c.status !== "dismissed"));

			if (target)
				board = editCardIn(
					OFFER_LANE_CONFIG,
					board,
					target.id,
					`${target.text} revised`,
				);
		} else if (roll < 0.27) {
			const target = pick(
				board.cards.filter(
					(c) => c.status !== "dismissed" && c.status !== "wrote",
				),
			);

			if (target) {
				board = setAside(board, target.id);
				rejected.add(target.id);
			}
		} else if (roll < 0.31) {
			const target = pick(board.cards.filter((c) => c.status === "dismissed"));

			if (target) {
				board = bringBackIn(OFFER_LANE_CONFIG, board, target.id);

				if (board !== before) rejected.delete(target.id);
				else seen.fullLane++;
			}
		} else if (roll < 0.4) {
			board = undoIn(OFFER_LANE_CONFIG, board);

			for (const card of board.cards) {
				const was = before.cards.find((c) => c.id === card.id);

				if (card.status === "proposed" && was?.status !== "proposed") {
					restoredAt.set(card.id, board.sent);

					if (requests.some((r) => r.live)) seen.undoInFlight++;
				}

				if (was?.status === "dismissed" && card.status !== "dismissed")
					rejected.delete(card.id);

				if (card.status === "dismissed" && was?.status !== "dismissed")
					rejected.add(card.id);
			}
		} else if (roll < 0.55) {
			let n: number;
			[board, n] = sendRequest(board);
			requests.push({ n, live: true });
		} else {
			const request = pick(requests.filter((r) => r.live));

			if (!request) continue;
			request.live = false;

			// The adversary: any lane, any of its ideas or a rewording, sometimes a price or a link, a ref to any card or none.
			// Its answer goes through the page's own reader (readOfferReply), which drops prices and links, as the page does.
			const raw = OFFER_LANES.flatMap((lane) =>
				IDEAS[lane].flatMap((text) =>
					next() < 0.35
						? [
								{
									ref: next() < 0.3 ? (pick(board.cards)?.id ?? "") : "",
									lane,
									text:
										next() < 0.1
											? `${text} at $500`
											: next() < 0.05
												? `${text}, see example.com`
												: next() < 0.15
													? `${text} again`
													: text,
									reason: "",
									detail:
										lane === "milestones"
											? {
													deliverables: ["A page"],
													acceptance: ["Open it"],
													daysLow: 1,
													daysHigh: 2,
												}
											: null,
								},
							]
						: [],
				),
			);

			const read = readOfferReply({ cards: raw });

			const reply: ReplyCard<OfferLane>[] = (read?.cards ?? []).map((card) => ({
				ref: card.ref,
				lane: card.lane,
				text: card.text,
				basis: "suggested",
				quote: "",
				reason: card.reason,
			}));

			seen.readerDropped += raw.length - reply.length;

			const applied = applyReplyIn(
				OFFER_LANE_CONFIG,
				board,
				reply,
				request.n,
				"",
				false,
			).board;

			if (request.n <= board.applied) seen.olderDropped++;
			else
				for (const item of reply) {
					const named = board.cards.find(
						(c) =>
							c.id === item.ref ||
							(c.lane === item.lane && sameIdea(c.text, item.text)),
					);

					if (named?.status === "dismissed") seen.reofferBlocked++;
					else if (named && isOwned(named)) seen.ownedNamed++;
				}

			const changed = (id: string) =>
				JSON.stringify(board.cards.find((c) => c.id === id)) !==
				JSON.stringify(applied.cards.find((c) => c.id === id));

			// A reply never changes a card the owner used, kept, edited or set aside.
			for (const card of board.cards.filter(isOwned))
				if (changed(card.id))
					fail(step, `reply ${request.n} changed owned card ${card.id}`);

			// A reply never changes a card Undo reopened after its request was sent.
			for (const card of board.cards)
				if ((restoredAt.get(card.id) ?? -1) >= request.n && changed(card.id))
					fail(
						step,
						`reply ${request.n} changed card ${card.id}, reopened by Undo after it was sent`,
					);

			const added = applied.cards.filter(
				(c) => !board.cards.some((b) => b.id === c.id),
			);

			for (const card of added) {
				// No set-aside idea comes back, in its lane.
				if (
					board.cards.some(
						(b) =>
							b.status === "dismissed" &&
							b.lane === card.lane &&
							sameIdea(b.text, card.text),
					)
				)
					fail(
						step,
						`reply ${request.n} added "${card.text}", which the owner set aside`,
					);

				// No card that names a price or a link reaches the board.
				if (pricesOrLinks(card.text))
					fail(
						step,
						`reply ${request.n} added "${card.text}", which names a price or a link`,
					);
			}

			// An older reply never changes the board.
			if (request.n <= board.applied && applied !== board)
				fail(
					step,
					`reply ${request.n} changed the board though older than the last applied`,
				);

			board = applied;
		}

		for (const id of rejected)
			if (board.cards.find((c) => c.id === id)?.status !== "dismissed")
				fail(step, `card ${id}, set aside, is no longer set aside`);

		// No lane ever holds more than its limit, after a reply or after Undo.
		for (const lane of OFFER_LANES) {
			const count = board.cards.filter(
				(c) => c.lane === lane && c.status !== "dismissed",
			).length;

			if (count > offerLaneLimits[lane])
				fail(step, `the ${lane} lane holds ${count} cards`);

			if (count === offerLaneLimits[lane]) seen.fullLane++;
		}

		// Cards never move between lanes: a card keeps the lane it was added in.
		for (const card of board.cards) {
			const was = before.cards.find((c) => c.id === card.id);

			if (was && was.lane !== card.lane)
				fail(step, `card ${card.id} moved from ${was.lane} to ${card.lane}`);
		}
	}

	return { failures, seen };
}

describe("the board's rules with the offer board's lanes, on the real code", () => {
	const walks = Array.from({ length: 300 }, (_, seed) => walk(seed + 1, 80));

	it("hold on 300 random walks of 80 steps", () => {
		expect(walks.flatMap((w) => w.failures).slice(0, 5)).toEqual([]);
	});

	it("reach the cases they are for: full lanes, Undo in flight, set-aside and owned ideas named, older replies, cards the reader drops (prices, links, past a limit)", () => {
		const total = (key: keyof (typeof walks)[number]["seen"]) =>
			walks.reduce((sum, w) => sum + w.seen[key], 0);

		for (const key of [
			"fullLane",
			"undoInFlight",
			"reofferBlocked",
			"ownedNamed",
			"olderDropped",
			"readerDropped",
		] as const)
			expect(total(key), key).toBeGreaterThan(20);
	});
});
