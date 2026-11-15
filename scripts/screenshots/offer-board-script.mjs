// A scripted stand-in for the offer board's model (docs/plans/2026-11-offer-board.md), for screenshots and browser
// checks: a fixed set of suggestions for the fictional band website brief the software-board scenario seeds. It reads the
// request's cards, so a card the owner used keeps its ref and an open card is repeated. No model is called.
export function scriptedOfferReply(body) {
	const request = JSON.parse(body || "{}");
	const shown = new Map(
		(request.cards ?? []).map((card) => [card.text, card.ref]),
	);
	const ref = (text) => shown.get(text) ?? "";

	return {
		ok: true,
		cards: [
			{
				ref: ref(
					"A website for the band that books shows and grows the mailing list",
				),
				lane: "outcome",
				text: "A website for the band that books shows and grows the mailing list",
				reason: "What the brief asks for",
				detail: null,
			},
			{
				ref: ref(
					"Fans hear new music and find shows near them; venues can book the band in a few steps.",
				),
				lane: "summary",
				text: "Fans hear new music and find shows near them; venues can book the band in a few steps.",
				reason: "From the brief's audience",
				detail: null,
			},
			{
				ref: ref("Design direction"),
				lane: "milestones",
				text: "Design direction",
				reason: "A small, clear first step",
				detail: {
					deliverables: [
						"Page list and navigation",
						"Homepage design at phone and computer widths",
						"One round of design changes",
					],
					acceptance: ["Open the homepage design on a phone and approve it"],
					daysLow: 2,
					daysHigh: 3,
				},
			},
			{
				ref: ref("Build and launch"),
				lane: "milestones",
				text: "Build and launch",
				reason: "The pages the brief names",
				detail: {
					deliverables: [
						"Music, Shows, Booking and Mailing list pages",
						"Booking form that emails the band",
						"Site live on the band's domain",
					],
					acceptance: [
						"Send a booking request and receive it",
						"Join the mailing list from a phone",
					],
					daysLow: 5,
					daysHigh: 8,
				},
			},
			{
				ref: ref("Song files and show dates for the first pages"),
				lane: "inputs",
				text: "Song files and show dates for the first pages",
				reason: "",
				detail: null,
			},
			{
				ref: ref("Selling tickets on the site"),
				lane: "exclusions",
				text: "Selling tickets on the site",
				reason: "The brief links to a ticket seller",
				detail: null,
			},
			{
				ref: ref(
					"About 4 weeks from the start date, once the song files are in.",
				),
				lane: "timing",
				text: "About 4 weeks from the start date, once the song files are in.",
				reason: "",
				detail: null,
			},
			{
				ref: ref("Who will add new show dates after launch?"),
				lane: "questions",
				text: "Who will add new show dates after launch?",
				reason: "Dates change often",
				detail: null,
			},
			{
				ref: ref("Mailing list service already chosen or not"),
				lane: "drivers",
				text: "Mailing list service already chosen or not",
				reason: "",
				detail: null,
			},
		],
		refs: [],
		size: "small",
		sizeReason: "Four pages and a form",
		figureUsd: 999999,
		figureReason: "A stand-in figure, held to the researched range",
	};
}
