import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	decideAttachment,
	intactAttachment,
	type AttachmentFacts,
} from "../../src/server/rules/agreement-attachment";

// The attachment rule as stories: the pin in the offer's stored details is the whole authorization.

const run = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag }),
			onSuccess: (value) => ({ kept: value }),
		}),
	);

const row = { request_id: "r1", object_key: "k1", sha256: "d1" };

const facts = (details: string | null, attachment = row): AttachmentFacts => ({
	attachment,
	offer: { request_id: "r1", agreement_details_json: details },
});

const pinning = (...pins: unknown[]) => JSON.stringify({ attachments: pins });

const decide = (given: AttachmentFacts) =>
	run(decideAttachment.decide(null, given));

const found = { kept: row };
const notFound = { refused: "AttachmentNotFound" };

describe("an attachment id", () => {
	it("is allowed when it is the offer's request's and the details pin its key and digest", () => {
		expect(decide(facts(pinning({ key: "k1", sha256: "d1" })))).toEqual(found);
	});

	it("is allowed among several pins, and with extra fields in a pin", () => {
		expect(
			decide(
				facts(
					pinning(
						{ key: "k0", sha256: "d0" },
						{ key: "k1", sha256: "d1", name: "x" },
					),
				),
			),
		).toEqual(found);
	});

	it("is refused when it is unknown", () => {
		expect(decide({ attachment: null, offer: facts(null).offer })).toEqual(
			notFound,
		);
	});

	it("is refused when the session has no offer", () => {
		expect(decide({ attachment: row, offer: null })).toEqual(notFound);
	});

	it("is refused when it is another request's attachment, with the same answer as an unknown id", () => {
		expect(
			decide(
				facts(pinning({ key: "k1", sha256: "d1" }), {
					...row,
					request_id: "r2",
				}),
			),
		).toEqual(notFound);
	});

	it("is refused when the right request's details pin another key", () => {
		expect(decide(facts(pinning({ key: "k9", sha256: "d1" })))).toEqual(
			notFound,
		);
	});

	it("is refused when the key is pinned with another digest", () => {
		expect(decide(facts(pinning({ key: "k1", sha256: "d9" })))).toEqual(
			notFound,
		);
	});

	it.each([
		["no details", null],
		["details with no attachments", JSON.stringify({ outcome: "x" })],
		["an empty list", pinning()],
		["a null list", JSON.stringify({ attachments: null })],
		[
			"a list of entries that are not pins",
			pinning(
				"k1",
				5,
				null,
				{ key: "k1" },
				{ sha256: "d1" },
				{ key: 1, sha256: "d1" },
			),
		],
		["details that are a list", JSON.stringify([{ key: "k1", sha256: "d1" }])],
		["details that are text", JSON.stringify("k1")],
		["a number as the attachments", JSON.stringify({ attachments: 7 })],
	])("is refused with %s", (_name, details) => {
		expect(decide(facts(details))).toEqual(notFound);
	});

	it("is allowed when the attachments are an object whose member is the pin, as the JSON walk visited it", () => {
		expect(
			decide(
				facts(
					JSON.stringify({
						attachments: { first: { key: "k1", sha256: "d1" } },
					}),
				),
			),
		).toEqual(found);
	});

	it("answers its 500 for details that are not JSON, and only for the offer's own request's attachment", () => {
		expect(decide(facts("{not json"))).toEqual({
			refused: "AttachmentDetailsUnreadable",
		});
		expect(decide(facts("{not json", { ...row, request_id: "r2" }))).toEqual(
			notFound,
		);
		expect(
			decide({ attachment: null, offer: facts("{not json").offer }),
		).toEqual(notFound);
	});
});

describe("an attachment's bytes", () => {
	it("are handed over only with the digest the row names", () => {
		expect(run(intactAttachment.decide({ bytesSha256: "d1" }, row))).toEqual({
			kept: {},
		});
		expect(run(intactAttachment.decide({ bytesSha256: "d2" }, row))).toEqual({
			refused: "AttachmentIntegrity",
		});
	});
});
