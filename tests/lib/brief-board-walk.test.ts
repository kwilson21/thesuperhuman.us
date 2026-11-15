// The Quint model's properties (verification/brief-board.qnt), checked on the real code. A seeded random walk mixes the
// visitor's writing and actions (Keep, Edit, Answer, Not this, Bring back, notes, Undo, Pause) with requests that are
// answered late, out of order and overlapping, by an adversarial model: any idea, any claim that it was read from the
// answers, passages that are not there, refs to owned or set-aside cards. After every step the seven properties must hold.
import { describe, expect, it } from "vitest";
import {
	type Board,
	type BoardCard,
	type ReplyCard,
	addNote,
	answerCard,
	applyReply,
	briefOutline,
	bringBack,
	editCard,
	emptyBoard,
	isOwned,
	keepCard,
	quotedFrom,
	sameIdea,
	sendRequest,
	setAside,
	undo,
} from "~/lib/brief-board";

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

const PASSAGES = [
	"upcoming shows near them",
	"hear new music",
	"join the mailing list",
];

const IDEAS: [string, string][] = [
	["Shows", PASSAGES[0]],
	["Music", PASSAGES[1]],
	["Mailing list", PASSAGES[2]],
	["Contact", "a form for venues"],
	["Shop", "sell merch online"],
];

type Request = { n: number; live: boolean };

function walk(seed: number, steps: number) {
	const next = random(seed);

	const pick = <T>(items: readonly T[]): T | undefined =>
		items.length ? items[Math.floor(next() * items.length)] : undefined;

	let board: Board = emptyBoard();
	let present = new Set<string>();
	let paused = false;
	const requests: Request[] = [];
	// Ghosts: ids the visitor set aside and has not brought back, and the requests sent when Undo last made a card unowned.
	const rejected = new Set<string>();
	const restoredAt = new Map<string, number>();
	const answers = () => PASSAGES.filter((p) => present.has(p)).join(". ");
	const failures: string[] = [];

	// What the walk reached, so a walk that never overlapped or never undid in flight cannot pass for the wrong reason.
	const seen = {
		olderDropped: 0,
		pausedDropped: 0,
		undoInFlight: 0,
		reofferBlocked: 0,
		staleQuoteDropped: 0,
		ownedNamed: 0,
	};

	const fail = (step: number, what: string) =>
		failures.push(`seed ${seed}, step ${step}: ${what}`);

	for (let step = 0; step < steps; step++) {
		const roll = next();
		const before = board;

		if (roll < 0.1) present = new Set([...present, pick(PASSAGES)!]);
		else if (roll < 0.15)
			present = new Set([...present].filter((p) => p !== pick(PASSAGES)));
		else if (roll < 0.22) {
			const target = pick(board.cards.filter((c) => c.status === "proposed"));

			if (target) board = keepCard(board, target.id);
		} else if (roll < 0.27) {
			const target = pick(board.cards.filter((c) => c.status !== "dismissed"));

			if (target) board = editCard(board, target.id, `${target.text} edited`);
		} else if (roll < 0.3) {
			const target = pick(
				board.cards.filter(
					(c) => c.lane === "parts" && c.status !== "dismissed",
				),
			);

			if (target) board = answerCard(board, target.id, "an answer");
		} else if (roll < 0.38) {
			const target = pick(
				board.cards.filter(
					(c) => c.status !== "dismissed" && c.status !== "wrote",
				),
			);

			if (target) {
				board = setAside(board, target.id);
				rejected.add(target.id);
			}
		} else if (roll < 0.41) {
			const target = pick(board.cards.filter((c) => c.status === "dismissed"));

			if (target) {
				board = bringBack(board, target.id);

				if (board !== before) rejected.delete(target.id);
			}
		} else if (roll < 0.44)
			board = addNote(board, "parts", pick(["Press kit", "Lyrics", "Shows"])!);
		else if (roll < 0.52) {
			board = undo(board);

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
		} else if (roll < 0.56) paused = !paused;
		else if (roll < 0.72) {
			if (!paused) {
				let n: number;
				[board, n] = sendRequest(board);
				requests.push({ n, live: true });
			}
		} else {
			const request = pick(requests.filter((r) => r.live));

			if (!request) continue;
			request.live = false;

			// The adversary: any idea, said or not, a real or false passage, a ref to any card or none.
			const reply = IDEAS.flatMap(([text, passage]): ReplyCard[] =>
				next() < 0.5
					? [
							{
								ref: next() < 0.4 ? (pick(board.cards)?.id ?? "") : "",
								lane: "parts",
								text: next() < 0.2 ? `${text} page` : text,
								basis: next() < 0.6 ? "said" : "suggested",
								quote: next() < 0.8 ? passage : "words nobody wrote",
								reason: "",
							},
						]
					: [],
			);

			const applied = applyReply(
				board,
				reply,
				request.n,
				answers(),
				paused,
			).board;

			if (request.n <= board.applied) seen.olderDropped++;
			else if (paused) seen.pausedDropped++;
			else {
				for (const item of reply) {
					const named = board.cards.find(
						(c) => c.id === item.ref || sameIdea(c.text, item.text),
					);

					if (named?.status === "dismissed") seen.reofferBlocked++;
					else if (named && isOwned(named)) seen.ownedNamed++;

					if (item.basis === "said" && !quotedFrom(item.quote, answers()))
						seen.staleQuoteDropped++;
				}
			}

			const changed = (id: string) => {
				const a = board.cards.find((c) => c.id === id);
				const b = applied.cards.find((c) => c.id === id);

				return JSON.stringify(a) !== JSON.stringify(b);
			};

			// 1. ownedUntouched
			for (const card of board.cards.filter(isOwned))
				if (changed(card.id))
					fail(step, `reply ${request.n} changed owned card ${card.id}`);

			// 3. undoRespected
			for (const card of board.cards)
				if ((restoredAt.get(card.id) ?? -1) >= request.n && changed(card.id))
					fail(
						step,
						`reply ${request.n} changed card ${card.id}, brought back by Undo after it was sent`,
					);

			const added = applied.cards.filter(
				(c) => !board.cards.some((b) => b.id === c.id),
			);

			// 2. rejectedStaysRejected: no new card says a set-aside idea again.
			for (const card of added)
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
						`reply ${request.n} added "${card.text}", which the visitor set aside`,
					);

			// 4. groundedOnApply
			for (const card of applied.cards.filter(
				(c) => changed(c.id) || added.includes(c),
			))
				if (
					card.status === "proposed" &&
					card.basis === "said" &&
					!quotedFrom(card.quote, answers())
				)
					fail(
						step,
						`reply ${request.n} made "${card.text}" from a passage not in the answers`,
					);

			// 6. newestWins and 7. pausedHolds
			if ((request.n <= board.applied || paused) && applied !== board)
				fail(
					step,
					`reply ${request.n} changed the board while ${paused ? "paused" : "older than the last applied"}`,
				);

			board = applied;
		}

		// 2. rejectedStaysRejected
		for (const id of rejected) {
			const card: BoardCard | undefined = board.cards.find((c) => c.id === id);

			if (card?.status !== "dismissed")
				fail(step, `card ${id}, set aside, is now ${card?.status ?? "gone"}`);
		}

		// 5. outlineGrounded
		for (const item of briefOutline(board, answers()))
			if (item.origin === "answers" && !quotedFrom(item.quote ?? "", answers()))
				fail(
					step,
					`the outline sends "${item.text}" as read from the answers, without its passage`,
				);
	}

	return { failures, seen };
}

describe("the board's properties on the real code", () => {
	const walks = Array.from({ length: 400 }, (_, seed) => walk(seed + 1, 80));

	it("hold on 400 random walks of 80 steps", () => {
		expect(walks.flatMap((w) => w.failures).slice(0, 5)).toEqual([]);
	});

	it("reach the cases they are for: older and paused replies, Undo in flight, set-aside and owned ideas named, false passages", () => {
		const total = (key: keyof (typeof walks)[number]["seen"]) =>
			walks.reduce((sum, w) => sum + w.seen[key], 0);

		for (const key of [
			"olderDropped",
			"pausedDropped",
			"undoInFlight",
			"reofferBlocked",
			"staleQuoteDropped",
			"ownedNamed",
		] as const)
			expect(total(key), key).toBeGreaterThan(20);
	});
});
