// The Quint model's properties (verification/brief-board.qnt), checked on the real code. A seeded random walk mixes the
// visitor's writing and actions (Keep, Edit, Answer, Not this, Bring back, notes, Undo, skipping the outline) with requests that are
// answered late, out of order and overlapping, by an adversarial model: any idea, any claim that it was read from the
// answers, passages that are not there, refs to owned or set-aside cards. The visitor also moves between the lane screens
// and the written questions, so replies arrive while a lane is on screen. After every step the nine properties must hold.
import { describe, expect, it } from "vitest";
import {
	type Board,
	type BoardCard,
	type ReplyCard,
	LANES,
	type Lane,
	addNote,
	answerCard,
	applyReply,
	briefOutline,
	bringBack,
	editCard,
	emptyBoard,
	isOwned,
	keepCard,
	laneLimits,
	leaveLane,
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
	// The lane on screen: none (a written question) or one of two lanes the walk's replies write to.
	let screen: Lane | null = null;
	const requests: Request[] = [];
	// Ghosts: ids the visitor set aside and has not brought back, and the requests sent when Undo last made a card unowned.
	const rejected = new Set<string>();
	const restoredAt = new Map<string, number>();
	const answers = () => PASSAGES.filter((p) => present.has(p)).join(". ");
	const failures: string[] = [];

	// The ideas a delivery added to the lane on screen during this visit, and how often each shows on the lane.
	let visitAdded: { lane: Lane; text: string }[] = [];
	// Set when a reply says an idea the visitor edited away again, naming another open card: the visitor then leaves soon,
	// so the held reply is applied before another replaces it.
	let leaveSoon = false;

	const onLane = (b: Board, lane: Lane, text: string) =>
		b.cards.filter((c) => c.lane === lane && sameIdea(c.text, text)).length;

	// What the walk reached, so a walk that never overlapped or never undid in flight cannot pass for the wrong reason.
	const seen = {
		olderDropped: 0,
		pausedDropped: 0,
		undoInFlight: 0,
		reofferBlocked: 0,
		staleQuoteDropped: 0,
		ownedNamed: 0,
		heldReplies: 0,
		heldChangesApplied: 0,
		heldDropped: 0,
		leaveAdded: 0,
		restated: 0,
		repeated: 0,
		addedThenGone: 0,
		rewordIntoEdited: 0,
		rewordAddedCard: 0,
	};

	const fail = (step: number, what: string) =>
		failures.push(`seed ${seed}, step ${step}: ${what}`);

	for (let step = 0; step < steps; step++) {
		let roll = next();
		const before = board;

		// A directed case: the visitor edited away an idea a delivery added during this visit, and a reply then sent says
		// that idea again, naming another open card of the lane. It arrives at once, and the visitor soon leaves, so the
		// leave applies it (and must not reword that card into the idea).
		let aimed: { lane: Lane; text: string } | undefined;

		// A second directed case: a reply that rewords, by its id, a card a delivery added during this visit arrives at once.
		let rewordAim = false;

		if (!aimed && screen && !paused && visitAdded.length && next() < 0.15) {
			rewordAim = true;
			let n: number;
			[board, n] = sendRequest(board);
			requests.push({ n, live: true });
			roll = 1;
		}

		if (screen && !paused && !rewordAim && next() < 0.3) {
			aimed = pick(
				visitAdded.filter((i) => onLane(board, i.lane, i.text) === 0),
			);

			if (aimed) {
				let n: number;
				[board, n] = sendRequest(board);
				requests.push({ n, live: true });
				roll = 1;
			}
		}

		// The visitor moves to another lane, or to none. Leaving a lane applies the reply held for it.
		if (leaveSoon || next() < 0.1) {
			leaveSoon = false;

			const target = pick(
				([null, "parts", "audience"] as const).filter((l) => l !== screen),
			);

			if (screen) {
				const held = board.deferred;
				const left = leaveLane(board, screen, answers(), paused);

				if (left.deferred) fail(step, "a reply is still held after leaving");

				if (
					JSON.stringify(left.seen[screen]) !==
					JSON.stringify(
						board.cards
							.filter((c) => c.lane === screen && c.status !== "dismissed")
							.map((c) => c.id),
					)
				)
					fail(
						step,
						`the last-seen list of ${screen} is not what the visitor saw on it`,
					);

				// Held changes go under the rules of any reply: owned cards, Undo and grounding hold, and nothing else
				// changes (no card added, no other lane touched, the numbers as they were); paused or older drops them.
				for (const c of board.cards) {
					const now = left.cards.find((x) => x.id === c.id);
					const same = JSON.stringify(c) === JSON.stringify(now);

					if (isOwned(c) && !same)
						fail(step, `leaving ${screen} changed owned card ${c.id}`);

					if (held && (restoredAt.get(c.id) ?? -1) >= held.n && !same)
						fail(
							step,
							`leaving ${screen} changed ${c.id}, brought back by Undo after the held reply was sent`,
						);

					if (c.lane !== screen && !same)
						fail(
							step,
							`leaving ${screen} changed card ${c.id} of another lane`,
						);

					if (
						now?.status === "proposed" &&
						now.basis === "said" &&
						!same &&
						!quotedFrom(now.quote, answers())
					)
						fail(
							step,
							`leaving ${screen} made "${now.text}" from a passage not in the answers`,
						);
				}

				// Leaving adds what the delivery could not (a full lane): new open cards of that lane only, from a reply
				// that was applied, never when it is dropped.
				const addedOnLeave = left.cards.filter(
					(c) => !board.cards.some((b) => b.id === c.id),
				);

				for (const c of addedOnLeave)
					if (c.lane !== screen || c.status !== "proposed")
						fail(
							step,
							`leaving ${screen} added ${c.id} outside the lane or owned`,
						);

				if (left.applied !== board.applied || left.nextId < board.nextId)
					fail(step, `leaving ${screen} changed the request numbers`);

				const dropped = !held || paused || held.n < board.applied;

				if (dropped && addedOnLeave.length)
					fail(step, `leaving ${screen} added a card from a dropped reply`);

				// 9. leaveKeepsReply: with room left in the lane, every idea the held reply names that is supported by
				// the answers is on the lane after it is left (as an off-screen delivery would have left it).
				if (
					held &&
					!dropped &&
					left.cards.filter(
						(c) => c.lane === screen && c.status !== "dismissed",
					).length < laneLimits[screen]
				)
					for (const item of held.reply) {
						const named = item.ref
							? board.cards.some((c) => c.id === item.ref)
							: false;

						if (
							item.lane !== screen ||
							named ||
							// Another item of the reply may name, by its ref, the card that says this idea, and reword it.
							held.reply.some(
								(other) =>
									other !== item &&
									board.cards.some(
										(c) =>
											c.id === other.ref &&
											c.lane === screen &&
											sameIdea(c.text, item.text),
									),
							) ||
							held.added.some(
								(a) => a.lane === item.lane && sameIdea(a.text, item.text),
							) ||
							(item.basis === "said" && !quotedFrom(item.quote, answers()))
						)
							continue;

						if (
							!left.cards.some(
								(c) => c.lane === screen && sameIdea(c.text, item.text),
							)
						)
							fail(
								step,
								`leaving ${screen} left "${item.text}" of the held reply off the lane`,
							);
					}

				// 10. leaveAddsNothingTwice: no idea a delivery added to the lane during this visit is on more cards after
				// the leave than before it, whatever the visitor did to the cards meanwhile.
				for (const idea of visitAdded) {
					if (onLane(board, idea.lane, idea.text) === 0) {
						seen.addedThenGone++;

						// The held reply says that idea again, naming an open card of the lane it may still change (so the leave could reword
						// that card into the idea).
						if (
							held &&
							!paused &&
							held.n >= board.applied &&
							held.reply.some(
								(item) =>
									item.lane === idea.lane &&
									sameIdea(item.text, idea.text) &&
									board.cards.some(
										(c) =>
											c.id === item.ref &&
											c.lane === idea.lane &&
											c.status === "proposed" &&
											c.since < held.n,
									),
							)
						)
							seen.rewordIntoEdited++;
					}

					if (
						onLane(left, idea.lane, idea.text) >
						onLane(board, idea.lane, idea.text)
					)
						fail(
							step,
							`leaving ${screen} added "${idea.text}" again, which a delivery added during the visit`,
						);
				}

				// 11. leaveUpdatesAddedCard: an untouched card a delivery added during the visit takes the wording of a held
				// reply that names it by its id, when nothing else forbids it (no other card or item says that idea).
				if (held && !dropped)
					for (const item of held.reply) {
						const card = board.cards.find((c) => c.id === item.ref);

						if (
							!card ||
							card.lane !== screen ||
							item.lane !== screen ||
							card.status !== "proposed" ||
							card.since >= held.n ||
							(restoredAt.get(card.id) ?? -1) >= held.n ||
							!visitAdded.some(
								(i) => i.lane === card.lane && sameIdea(i.text, card.text),
							) ||
							held.reply.filter((o) => o.ref === card.id).length !== 1 ||
							held.reply.some(
								(o) =>
									o !== item &&
									o.lane === item.lane &&
									sameIdea(o.text, item.text),
							) ||
							board.cards.some(
								(c) =>
									c.id !== card.id &&
									c.lane === item.lane &&
									sameIdea(c.text, item.text),
							) ||
							// An idea a delivery added that is no longer on any card (edited away) is not reworded into.
							visitAdded.some(
								(i) =>
									i.lane === item.lane &&
									sameIdea(i.text, item.text) &&
									!sameIdea(i.text, card.text),
							) ||
							(item.basis === "said" && !quotedFrom(item.quote, answers()))
						)
							continue;

						seen.rewordAddedCard++;

						if (left.cards.find((c) => c.id === card.id)?.text !== item.text)
							fail(
								step,
								`leaving ${screen} did not apply the held wording to ${card.id}, added during the visit`,
							);
					}

				if (addedOnLeave.length) seen.leaveAdded++;

				const moved =
					JSON.stringify(left.cards) !== JSON.stringify(board.cards);

				if (held && (paused || held.n < board.applied)) {
					seen.heldDropped++;

					if (moved)
						fail(
							step,
							`leaving ${screen} applied a held reply it should have dropped`,
						);
				} else if (moved) seen.heldChangesApplied++;

				board = left;
			}

			screen = target ?? null;
			visitAdded = [];
		}

		if (roll < 0.1) present = new Set([...present, pick(PASSAGES)!]);
		else if (roll < 0.15)
			present = new Set([...present].filter((p) => p !== pick(PASSAGES)));
		else if (roll < 0.22) {
			const target = pick(board.cards.filter((c) => c.status === "proposed"));

			if (target) board = keepCard(board, target.id);
		} else if (roll < 0.27) {
			const target = pick(board.cards.filter((c) => c.status !== "dismissed"));

			if (target)
				// Half the edits keep the idea, half say something else (so a card no longer says the idea it was added for).
				board = editCard(
					board,
					target.id,
					next() < 0.5 ? `${target.text} edited` : `Reworked ${step}`,
				);
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
			const request =
				aimed || rewordAim
					? requests[requests.length - 1]
					: pick(requests.filter((r) => r.live));

			if (!request) continue;
			request.live = false;

			// The adversary: any idea, said or not, a real or false passage, a ref to any card or none.
			const reply = IDEAS.flatMap(([text, passage]): ReplyCard[] =>
				next() < 0.5
					? [
							{
								ref: next() < 0.4 ? (pick(board.cards)?.id ?? "") : "",
								lane: next() < 0.25 ? "audience" : "parts",
								text: next() < 0.2 ? `${text} page` : text,
								basis: next() < 0.6 ? "said" : "suggested",
								quote: next() < 0.8 ? passage : "words nobody wrote",
								reason: "",
							},
						]
					: [],
			);

			// Some replies state an idea twice, and some restate an idea an earlier delivery added, without naming its card.
			if (reply.length && next() < 0.25) {
				const twin = pick(reply)!;
				reply.push({ ...twin, text: `${twin.text}.` });
				seen.repeated++;
			}

			if (visitAdded.length && next() < 0.4) {
				const again = pick(visitAdded)!;

				// Half the time it names another card of the lane by its id, so a leave could reword that card into the idea.
				const other = pick(
					board.cards.filter(
						(c) => c.lane === again.lane && c.status === "proposed",
					),
				);

				reply.push({
					ref: next() < 0.7 ? (other?.id ?? "") : "",
					lane: again.lane,
					text: again.text,
					basis: "suggested",
					quote: "",
					reason: "",
				});
				seen.restated++;

				if (reply[reply.length - 1].ref && next() < 0.7) leaveSoon = true;
			}

			// Some replies reword, by its id, a card a delivery added during this visit, and the leave may apply it.
			const addedCard = pick(
				board.cards.filter(
					(c) =>
						c.lane === screen &&
						c.status === "proposed" &&
						visitAdded.some(
							(i) => i.lane === c.lane && sameIdea(i.text, c.text),
						),
				),
			);

			if (addedCard && next() < 0.8) {
				reply.push({
					ref: addedCard.id,
					lane: addedCard.lane,
					text: `${addedCard.text} page`,
					basis: "suggested",
					quote: "",
					reason: "",
				});

				if (next() < 0.9) leaveSoon = true;
			}

			if (aimed) {
				const other = pick(
					board.cards.filter(
						(c) =>
							c.lane === aimed.lane &&
							c.status === "proposed" &&
							c.since < request.n,
					),
				);

				if (other) {
					reply.push({
						ref: other.id,
						lane: aimed.lane,
						text: aimed.text,
						basis: "suggested",
						quote: "",
						reason: "",
					});
					leaveSoon = true;
				}
			}

			const applied: Board = applyReply(
				board,
				reply,
				request.n,
				answers(),
				paused,
				screen,
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

			// 8. onScreenStable: no card listed on the lane on screen changes or leaves by a delivery.
			if (screen) {
				if (
					!paused &&
					request.n > board.applied &&
					applied.deferred?.n === request.n
				)
					seen.heldReplies++;

				for (const card of board.cards.filter((c) => c.lane === screen))
					if (changed(card.id))
						fail(
							step,
							`reply ${request.n} changed or withdrew ${card.id}, listed on the lane on screen`,
						);
			}

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

			if (screen && !paused && request.n > board.applied)
				for (const c of applied.cards)
					if (
						c.lane === screen &&
						!board.cards.some((b) => b.id === c.id) &&
						c.status === "proposed"
					)
						visitAdded.push({ lane: c.lane, text: c.text });

			board = applied;

			// The visitor, looking at the lane, often rewrites a card a reply just added.
			const justAdded = added.filter((c) => c.lane === screen);

			if (screen && justAdded.length && next() < 0.4)
				board = editCard(board, pick(justAdded)!.id, `Reworked ${step}`);
		}

		// 2. rejectedStaysRejected
		for (const id of rejected) {
			const card: BoardCard | undefined = board.cards.find((c) => c.id === id);

			if (card?.status !== "dismissed")
				fail(step, `card ${id}, set aside, is now ${card?.status ?? "gone"}`);
		}

		// 8. withinLimits: no lane holds more cards than its limit, after a reply or after Undo (the Quint model leaves
		// lane limits out; the second review found a reply and an Undo that broke this).
		for (const lane of LANES)
			if (
				board.cards.filter((c) => c.lane === lane && c.status !== "dismissed")
					.length > laneLimits[lane]
			)
				fail(
					step,
					`the ${lane} lane holds more than ${laneLimits[lane]} cards`,
				);

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

	it("reach the cases they are for: older and paused replies, Undo in flight, set-aside and owned ideas named, false passages, replies held for the lane on screen and applied (with the new cards a full lane refused) or dropped when it is left", () => {
		const total = (key: keyof (typeof walks)[number]["seen"]) =>
			walks.reduce((sum, w) => sum + w.seen[key], 0);

		for (const key of [
			"olderDropped",
			"pausedDropped",
			"undoInFlight",
			"reofferBlocked",
			"staleQuoteDropped",
			"ownedNamed",
			"heldReplies",
			"heldChangesApplied",
			"heldDropped",
			"restated",
			"repeated",
			"addedThenGone",
			"rewordIntoEdited",
			"rewordAddedCard",
		] as const)
			expect(total(key), key).toBeGreaterThan(20);
	});
});
