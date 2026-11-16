// A scripted stand-in for the board's interpreting model (docs/plans/2026-11-living-brief.md): it reads a request to
// POST /api/software/brief/board and answers as the route would, from keyword rules instead of Workers AI. Used by the
// browser checks of the page and the screenshot scenario (scripts/screenshots/scenarios/software-board.mjs), where the route is answered
// locally. It is deliberately simple and deterministic; it is not the model, and its wording is not the model's.

/** Words in the answers that name a page (website) or a thing people do (web app), and the card each gives. */
const PARTS = [
	[/\b(new )?music\b|\bsongs?\b|\brecordings?\b/i, "Music"],
	[/\bshows?\b|\bgigs?\b|\btour(s|ing)?\b|\bconcerts?\b/i, "Shows"],
	[/\bmailing list\b|\bnewsletter\b/i, "Mailing list"],
	[/\bmerch(andise)?\b|\bshop\b|\bstore\b/i, "Shop"],
	[/\bphotos?\b|\bgallery\b/i, "Photos"],
	[/\bvideos?\b/i, "Videos"],
	[/\bclasses\b|\bworkshops?\b/i, "Classes"],
	[/\bbook(ing)?s?\b|\bsign up\b/i, "Booking"],
	[/\bpay(ment)?s?\b/i, "Payments"],
	[/\bschedules?\b|\bshifts?\b/i, "Schedule"],
	[/\bspreadsheets?\b/i, "Shared spreadsheet"],
	[/\bfollow-?ups?\b/i, "Follow-ups"],
];

const AUDIENCE = [
	[/\bfans?\b|\blisteners?\b/i, "Fans"],
	[/\bvenues?\b|\bpromoters?\b/i, "Venues and promoters"],
	[/\bstudents?\b/i, "Students"],
	[/\bvolunteers?\b/i, "Volunteers"],
	[/\bcustomers?\b|\bclients?\b/i, "Customers"],
];

/** A short passage around the match, copied from the answers by position, so the page's check that it is in them holds. */
function passage(text, match) {
	const before = [...text.slice(0, match.index).matchAll(/\S+/g)].slice(-3);

	const after = [
		...text.slice(match.index + match[0].length).matchAll(/\S+/g),
	].slice(0, 3);

	const start = before.length ? before[0].index : match.index;

	const end = after.length
		? match.index +
			match[0].length +
			after[after.length - 1].index +
			after[after.length - 1][0].length
		: match.index + match[0].length;

	return text
		.slice(start, end)
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function firstSentence(text) {
	const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
	const words = sentence.split(/\s+/).slice(0, 14).join(" ");

	return words.replace(/[.!?,;:]+$/, "");
}

/**
 * The reply for one request body (the JSON text the page sends): purpose and the parts and audience the answers name, read
 * from the answers with their passage; a contact page and two questions as suggestions, for a website about music;
 * existing open cards repeated by ref while their idea is still there.
 */
export function scriptedReply(body) {
	const request = JSON.parse(body);
	const text = Object.values(request.answers ?? {}).join("\n\n");
	const cards = [];

	const avoid = (request.cards ?? [])
		.filter((card) => card.state !== "open")
		.map((card) => card.text.toLowerCase());

	const open = new Map(
		(request.cards ?? [])
			.filter((card) => card.state === "open")
			.map((card) => [card.text, card.ref]),
	);

	const add = (card) => {
		if (avoid.some((text) => text.startsWith(card.text.toLowerCase()))) return;
		cards.push(
			open.has(card.text) ? { ref: open.get(card.text), ...card } : card,
		);
	};

	const purpose = firstSentence(text);

	if (purpose.split(/\s+/).length >= 4)
		add({
			lane: "purpose",
			text: purpose.slice(0, 140),
			basis: "said",
			quote: purpose.split(/\s+/).slice(0, 8).join(" "),
		});

	for (const [pattern, name] of AUDIENCE) {
		const match = pattern.exec(text);

		if (match)
			add({
				lane: "audience",
				text: name,
				basis: "said",
				quote: passage(text, match),
			});
	}

	const parts = [];

	for (const [pattern, name] of PARTS) {
		const match = pattern.exec(text);

		if (match) {
			parts.push(name);
			add({
				lane: "parts",
				text: name,
				basis: "said",
				quote: passage(text, match),
			});
		}
	}

	if (request.path === "website" && parts.includes("Shows")) {
		add({
			lane: "parts",
			text: "Contact",
			basis: "suggested",
			reason: "Venues and press need a way to reach you",
		});
		add({
			lane: "questions",
			text: "Do you sell tickets on the site, or link to a ticket seller?",
			basis: "suggested",
			reason: "You mention shows",
		});
		add({
			lane: "questions",
			text: "Who will add new show dates?",
			basis: "suggested",
			reason: "Show dates change often",
		});
	} else if (parts.length > 0) {
		add({
			lane: "questions",
			text: "Who will use it first, and how often?",
			basis: "suggested",
			reason: "It shapes the first version",
		});
	}

	return { ok: true, cards };
}
