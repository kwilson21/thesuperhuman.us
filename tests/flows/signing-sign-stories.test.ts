import { describe, expect, it } from "vitest";
import { POST } from "~/pages/api/offer/[token]/sign";
import { isText } from "~/lib/type-guards";
import {
	resend,
	resendOk,
	scene,
	signBody,
	signJson,
} from "../golden/areas/signing";
import { json, runCase, type CaseRecord } from "../golden/harness";

// The signature's flow (src/server/flows/signing-sign.ts) as stories, through the route on the golden harness (the real
// schema on SQLite, the clock and ids fixed): the documents signed and both signing notices sent; the same request again,
// which answers the saved receipt; the front checks in the route's order (the session, the body, the nonce); and the
// notices step, whose failures never change the answer. Every answer is held to the code it replaced by the offer-sign
// golden corpus, and the notices' own decisions by tests/rules/agreement-messages.test.ts.

const answerOf = (record: CaseRecord, step: number) => {
	const answer = record.steps[step].answer;

	return answer.outcome === "response"
		? { status: answer.status, body: isText(answer.body) ? answer.body : "" }
		: { status: "rejected", body: "" };
};

/** The subjects of the mails Resend was asked to send, in order. */
const subjects = (record: CaseRecord) =>
	record.effects.flatMap((effect) =>
		effect.kind === "fetch" && effect.host === "resend" && isText(effect.body)
			? [String(JSON.parse(effect.body).subject)]
			: [],
	);

const CHANGED =
	'{"ok":false,"error":"The reviewed agreement changed. Reload and review it again."}';

describe("the signature", () => {
	it("signs both documents, sends the two notices, and answers the same receipt to the same request again", async () => {
		const record = await runCase(POST, {
			name: "sign, then again",
			...scene(),
			fetches: resendOk,
			steps: [signJson(signBody()), signJson(signBody())],
		});

		const first = answerOf(record, 0);

		expect(first.status).toBe(200);
		expect(answerOf(record, 1)).toEqual(first);
		expect(subjects(record)).toEqual([
			"Your signature is saved",
			"Agreement ready for countersignature",
		]);
	});

	it("answers the receipt when the notices' mail is refused, and when it fails outright", async () => {
		for (const answer of [json(422, { message: "bad" }), json(500, {})]) {
			const record = await runCase(POST, {
				name: "the notices fail",
				...scene(),
				fetches: resend(answer, answer),
				steps: [signJson(signBody())],
			});

			expect(answerOf(record, 0).status).toBe(200);
		}
	});

	it("refuses with the one 409 once the documents named are not the ones reviewed", async () => {
		const changed = await runCase(POST, {
			name: "a changed hash",
			...scene(),
			fetches: resendOk,
			steps: [
				signJson(
					signBody({
						documents: [
							{
								id: "00000000-0000-4000-8000-0000000000a2",
								hash: "0".repeat(64),
							},
						],
					}),
				),
			],
		});

		expect(answerOf(changed, 0)).toEqual({ status: 409, body: CHANGED });
	});

	it("answers the front checks in the route's order: the body (400) before the nonce (403)", async () => {
		const noConsent = await runCase(POST, {
			name: "no consent",
			...scene(),
			steps: [signJson(signBody({ consent: false, csrf_nonce: "wrong" }))],
		});

		const badNonce = await runCase(POST, {
			name: "a bad nonce",
			...scene(),
			steps: [signJson(signBody({ csrf_nonce: "wrong" }))],
		});

		expect(answerOf(noConsent, 0).status).toBe(400);
		expect(answerOf(badNonce, 0)).toEqual({
			status: 403,
			body: '{"ok":false,"error":"Reload and try again."}',
		});
	});
});
