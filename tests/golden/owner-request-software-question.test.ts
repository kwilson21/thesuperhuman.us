import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	BASE,
	EARLIER,
	inserting,
	liveLink,
	mail,
	mailOutcomes,
	NOW,
	offer,
	project,
	projectTables,
	refused,
	unreachable,
	running,
	secondsFromNow,
	sent,
	withOffers,
} from "./areas/software-offers";
import {
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";

// The golden corpus for the question action of POST /api/owner/requests/[id]/software: the owner emails the client a
// question about the project brief. The route reserves the question first (it moves owner_requests.updated_at in a
// batch), then sends the email through Resend (the client, then a copy to the owner), then records "question-sent" in a
// second batch. The guards shared by every action are recorded in owner-request-software-fit.
//
// Every response branch of the question action, and the cases that reach it:
//
//   guards   403 a visitor; 503 no database; 400 text missing, empty, spaces only, not text, over 2000 characters;
//            404 unknown id; 409 closed (withdrawn, empty email); 409 resolved; 409 project started (before any write)
//   200 {ok:true,copySent}      both emails sent (copySent true); the client's email sent and the copy refused, answered
//                               5xx or lost to the network (copySent false)
//   502 {ok:false,uncertain,message}  the client's email refused (4xx: not uncertain), answered 5xx or lost to the
//                               network (uncertain), no Resend key, no sender address or no owner address (not uncertain).
//                               The reservation stays: updated_at moved, no audit row, no question-sent record
//   409 "...changed or could not be saved..."  the reservation batch fails its guard (updated_at, status or email moved)
//                               or throws; recorded as the generic answer
//   409 project started         the project appears between the pre-check and the reservation batch, or between the email
//                               and the recording batch
//   409 "The client email was sent, but the request changed..."  the recording batch fails its guard or throws after the
//                               email went out
//   effects: reservation batch (request guard, no-project guard, update updated_at), then Resend POST for the client,
//   Resend POST for the owner's copy, then the recording batch (request guard at the reserved time, no-project guard,
//   audit "question-sent"). No R2, no background work.

const ask = (text: JsonValue = "Which users will sign in?"): JsonValue => ({
	action: "question",
	text,
});

const QUESTION_TABLES = ["owner_requests", "owner_request_audit"];

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, { dump: { music: QUESTION_TABLES }, ...extra });

const askCase = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed: withOffers([]) },
	fetches: mail(),
	steps: [step(body, over)],
	...extra,
});

const statusCase = (name: string, over: SeedRow): Case =>
	askCase(name, ask(), { music: { seed: withOffers([], {}, over) } });

const cases: Case[] = [
	// who and what
	askCase("a visitor", ask(), {}, { as: asVisitor() }),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [step(ask())],
	},
	askCase("no text", { action: "question" }),
	askCase("an empty text", ask("")),
	askCase("a text of only spaces", ask("   ")),
	askCase("a text that is not text", ask(42)),
	askCase("a text of null", ask(null)),
	askCase("a text over 2000 characters", ask("q".repeat(2001))),
	askCase("a text of exactly 2000 characters", ask("q".repeat(2000))),
	askCase(
		"a text of 2000 characters with spaces around it",
		ask(` ${"q".repeat(2000)} `),
	),
	askCase("a text with unicode", ask("Café 日本語 🙂, nbsp end")),
	askCase(
		"a text with markup",
		ask(`<script>alert("x")</script> & 'q' <b>b</b>`),
	),
	askCase("a text with newlines", ask("One?\n\nTwo?\r\nThree?")),
	askCase(
		"a text with a line that looks like a header",
		ask("Subject: hi\nBcc: a@example.test"),
	),
	{
		name: "an unknown request id",
		music: { seed: withOffers([]) },
		fetches: mail(),
		steps: [step(ask(), { path: `${BASE}/nope`, params: { id: "nope" } })],
	},
	{
		name: "a request of another kind",
		music: { seed: { owner_requests: [rows.ownerRequest("r1")] } },
		fetches: mail(),
		steps: [step(ask())],
	},
	statusCase("a withdrawn request", { status: "withdrawn" }),
	statusCase("a request with an empty email", { email: "" }),
	statusCase("a resolved request", { status: "resolved" }),
	statusCase("a new request", { status: "new" }),
	statusCase("a reviewed request", { status: "reviewed" }),
	statusCase("a client email in capitals with spaces around it", {
		email: " Grace@Example.TEST ",
	}),
	statusCase("a request whose updated_at is ahead of the clock", {
		updated_at: secondsFromNow(3600),
	}),
	statusCase("a request whose updated_at is the clock's millisecond", {
		updated_at: NOW,
	}),
	{
		name: "a request with a started project",
		music: {
			seed: withOffers([offer("sent")], { software_projects: [project()] }),
		},
		fetches: mail(),
		steps: [
			step(ask(), { dump: { music: [...QUESTION_TABLES, ...projectTables] } }),
		],
	},
	{
		name: "a request with a client-signed agreement still takes a question",
		music: {
			seed: {
				...rows.agreementBase(),
				...withOffers([offer("sent")]),
				software_agreements: [rows.agreement("a1", "r1", "o1")],
			},
		},
		fetches: mail(),
		steps: [step(ask())],
	},
	{
		name: "a request with a draft offer, a sent offer and a live link",
		music: {
			seed: withOffers([offer("sent"), offer("draft", 2)], {
				software_offer_links: [liveLink()],
			}),
		},
		fetches: mail(),
		steps: [step(ask())],
	},
	askCase(
		"an owner email in capitals",
		ask(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	askCase(
		"an owner email with spaces around it",
		ask(),
		{},
		{ as: asOwner(" owner@example.test ") },
	),
	// Resend and the environment
	...mailOutcomes.map(({ name, client, copy }) =>
		askCase(`question: ${name}`, ask(), { fetches: mail(client, copy) }),
	),
	askCase("no Resend key", ask(), { omit: ["RESEND_API_KEY"] }),
	askCase("an empty Resend key", ask(), { env: { RESEND_API_KEY: "" } }),
	askCase("no sender address", ask(), { omit: ["CONTACT_FROM_EMAIL"] }),
	askCase("no owner address", ask(), { omit: ["OWNER_EMAIL"] }),
	askCase("Resend answers 200 with a body that is not JSON", ask(), {
		fetches: mail({ kind: "response", status: 200, text: "ok", headers: {} }),
	}),
	askCase("Resend answers 301", ask(), {
		fetches: mail({ kind: "response", status: 301, text: "", headers: {} }),
	}),
	askCase("Resend answers 500", ask(), {
		fetches: mail({ kind: "response", status: 500, text: "", headers: {} }),
	}),
	// races and outages
	askCase("a question that loses a race on updated_at", ask(), {
		interleave: [
			{
				on: /UPDATE owner_requests SET updated_at/,
				label: "another change moves updated_at",
				run: running(
					"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
				),
			},
		],
	}),
	askCase("a question that loses a race on status", ask(), {
		interleave: [
			{
				on: /UPDATE owner_requests SET updated_at/,
				label: "the request is withdrawn",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	{
		name: "a project starts between the pre-check and the reservation",
		music: { seed: withOffers([offer("sent")]) },
		fetches: mail(),
		interleave: [
			{
				on: /UPDATE owner_requests SET updated_at/,
				label: "a project starts",
				run: inserting("software_projects", project()),
			},
		],
		steps: [
			step(ask(), { dump: { music: [...QUESTION_TABLES, ...projectTables] } }),
		],
	},
	askCase("the request changes while the email is sent", ask(), {
		interleave: [
			{
				on: /INSERT INTO owner_request_audit/,
				label: "another change moves updated_at",
				run: running(
					"UPDATE owner_requests SET updated_at='2026-11-13T12:00:30.000Z'",
				),
			},
		],
	}),
	{
		name: "a project starts while the email is sent",
		music: { seed: withOffers([offer("sent")]) },
		fetches: mail(),
		interleave: [
			{
				on: /INSERT INTO owner_request_audit/,
				label: "a project starts",
				run: inserting("software_projects", project()),
			},
		],
		steps: [
			step(ask(), { dump: { music: [...QUESTION_TABLES, ...projectTables] } }),
		],
	},
	askCase("the first read fails", ask(), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	askCase("the project pre-check fails", ask(), {
		failures: [
			{ on: /^SELECT 1 FROM software_projects/, message: "D1 is down" },
		],
	}),
	askCase("the reservation batch fails", ask(), {
		failures: [
			{ on: /UPDATE owner_requests SET updated_at/, message: "D1 is down" },
		],
	}),
	askCase("the recording batch fails", ask(), {
		failures: [
			{ on: /INSERT INTO owner_request_audit/, message: "D1 is down" },
		],
	}),
	askCase(
		"the recording batch fails and so does the project lookup after it",
		ask(),
		{
			failures: [
				{ on: /INSERT INTO owner_request_audit/, message: "D1 is down" },
				{
					on: /^SELECT 1 FROM software_projects/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	askCase(
		"the reservation batch fails and the project lookup after it also fails",
		ask(),
		{
			failures: [
				{ on: /UPDATE owner_requests SET updated_at/, message: "D1 is down" },
				{
					on: /^SELECT 1 FROM software_projects/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	// sequences
	{
		name: "two questions in a row",
		music: { seed: withOffers([]) },
		fetches: mail(),
		steps: [step(ask("First?")), step(ask("Second?"), { advanceMs: 1000 })],
	},
	{
		name: "a question the client email refuses, then the same question again",
		music: { seed: withOffers([]) },
		fetches: byHost({ resend: [refused, sent] }),
		steps: [step(ask()), step(ask(), { advanceMs: 1000 })],
	},
	{
		name: "a question, then a fit note with the old updatedAt",
		music: { seed: withOffers([]) },
		fetches: mail(),
		steps: [
			step(ask()),
			step(
				{
					action: "fit",
					label: "potential-fit",
					note: "x",
					expectedRequestUpdatedAt: EARLIER,
				},
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "a question, then the request is resolved, then another question",
		music: { seed: withOffers([]) },
		fetches: mail(),
		steps: [
			step(ask()),
			step(ask("After resolving?"), {
				advanceMs: 1000,
				before: {
					label: "the request is resolved",
					run: (world) =>
						world.music.exec("UPDATE owner_requests SET status='resolved'"),
				},
			}),
		],
	},
	{
		name: "a question, then a decline",
		music: {
			seed: withOffers([offer("sent")], { software_offer_links: [liveLink()] }),
		},
		fetches: mail(),
		steps: [
			step(ask()),
			step({ action: "decline", text: "Not a fit." }, { advanceMs: 1000 }),
		],
	},
	{
		name: "the same question with the email lost, then sent after the network returns",
		music: { seed: withOffers([]) },
		fetches: byHost({ resend: [unreachable, sent] }),
		steps: [step(ask()), step(ask(), { advanceMs: 1000 })],
	},
];

defineCorpus("owner-request-software-question", POST, cases);
