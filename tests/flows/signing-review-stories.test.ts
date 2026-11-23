import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { GET, POST } from "~/pages/api/offer/[token]/review";
import { isText } from "~/lib/type-guards";
import {
	agreementWorld,
	cookie,
	IP,
	REVIEW_TABLES,
	TOKEN,
	wireKit,
} from "../golden/areas/agreement-access";
import {
	asVisitor,
	runCase,
	type CaseRecord,
	type Prior,
	type Step,
} from "../golden/harness";

// The review's flows (src/server/flows/signing-review.ts) as stories, through the route on the golden harness (the real
// schema on SQLite, the clock and ids fixed): a review written, then each of its documents read by the session that made
// it and refused to anyone else; the POST's front checks in the route's order, before the draft and the review read
// anything; and the review again, which replaces the documents. The races of the review batch are
// tests/security/review-race.test.ts; every answer of both methods is held to the code it replaced by the offer-review
// golden corpus.

const PATH = `/api/offer/${TOKEN}/review`;

const { scenario } = wireKit(PATH, REVIEW_TABLES);

const answerOf = (record: CaseRecord, step: number) => {
	const answer = record.steps[step].answer;

	return answer.outcome === "response"
		? {
				status: answer.status,
				body: isText(answer.body) ? answer.body : "",
			}
		: { status: "rejected", body: "" };
};

/** The GET of one document, with the session cookie of the seeded world unless told otherwise. */
const download = (
	document: (prior: Prior) => string,
	over: Partial<Step> = {},
): Step => ({
	handler: GET,
	method: "GET",
	as: asVisitor({ ip: IP }),
	path: (prior) => `${PATH}?document=${document(prior)}`,
	params: { token: TOKEN },
	headers: cookie(),
	...over,
});

/** What the review's 200 answers: each document's id and kind (the rest is not read here). */
const Reviewed = Schema.Struct({
	documents: Schema.Array(
		Schema.Struct({ id: Schema.String, kind: Schema.String }),
	),
});

/** The id of a document the first step's review answered, by kind. */
const documentOf = (kind: "msa" | "sow") => (prior: Prior) =>
	Schema.decodeUnknownSync(Reviewed)(prior.answerJson(0)).documents.find(
		(document) => document.kind === kind,
	)?.id ?? "none";

describe("the review", () => {
	it("writes the documents for the session, which the session then reads and no one else can", async () => {
		const [json] = scenario("review, then read", {
			wires: ["json"],
			steps: (send) => [
				send(),
				download(documentOf("sow")),
				download(documentOf("msa")),
				download(() => "not-a-document"),
				download(documentOf("sow"), { headers: {} }),
			],
		});

		const record = await runCase(POST, json);

		expect(answerOf(record, 0).status).toBe(200);
		expect(answerOf(record, 1).status).toBe(200);
		expect(answerOf(record, 1).body).toContain("SOW");
		expect(answerOf(record, 2).status).toBe(200);
		expect(answerOf(record, 3)).toEqual({ status: 404, body: '{"ok":false}' });
		expect(answerOf(record, 4)).toEqual({ status: 401, body: '{"ok":false}' });
	});

	it("replaces its documents when the client reviews again", async () => {
		const [json] = scenario("review twice", {
			wires: ["json"],
			steps: (send) => [send(), send()],
		});

		const record = await runCase(POST, json);

		expect(answerOf(record, 1).status).toBe(200);

		const first = JSON.stringify(record.steps[0].state);
		const second = JSON.stringify(record.steps[1].state);

		expect(second).not.toBe(first);
		expect((second.match(/"status":"review"/g) ?? []).length).toBe(
			(first.match(/"status":"review"/g) ?? []).length,
		);
	});

	it("answers no session with the 401 before the nonce, and a bad nonce with the 403 before the details", async () => {
		const [noSession] = scenario("no session", {
			wires: ["json"],
			opts: { session: null },
			input: { csrf_nonce: "wrong", values: {} },
		});

		const [badNonce] = scenario("a bad nonce", {
			wires: ["json"],
			input: { csrf_nonce: "wrong", values: {} },
		});

		expect(answerOf(await runCase(POST, noSession), 0).status).toBe(401);
		expect(answerOf(await runCase(POST, badNonce), 0)).toEqual({
			status: 403,
			body: '{"ok":false,"error":"Reload and try again."}',
		});
	});

	it("answers a seeded document of the session's review as a text attachment", async () => {
		const record = await runCase(GET, {
			name: "a seeded document",
			...agreementWorld({ agreements: "review" }),
			steps: [download(() => "ag-sow")],
		});

		expect(answerOf(record, 0).status).toBe(200);
	});
});
