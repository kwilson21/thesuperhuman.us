import { describe, expect, it } from "vitest";
import { readBriefCopyInput } from "../../src/server/brief-copy-input";
import { legacyBriefCopySchema } from "../fixtures/legacy-validators/brief-copy";
import { notStrings, seeded } from "../helpers/differential";

// The Effect reader answers every body as the Zod schema it replaced did: the same accept and refuse, and for an accepted
// body the same values (an unknown key is dropped, as Zod's default does). Seeded, so a failure reproduces.

const ACTIONS = ["send", "Send", "resend", "", " send", "send ", 1, null];

const FLAGS = [true, false, "true", "yes", 1, 0, null, undefined, [], {}];

describe("the Effect reader for the owner brief copy body", () => {
	it("accepts and refuses every seeded body as the Zod schema does", () => {
		const random = seeded(20261115);

		for (let index = 0; index < 3000; index++) {
			const sent: Record<string, unknown> = {};

			if (random.chance(0.85)) sent.action = random.pick(ACTIONS);

			if (random.chance(0.6)) sent.confirmedNotSent = random.pick(FLAGS);

			if (random.chance(0.3)) sent.extra = random.pick(FLAGS);

			const legacy = legacyBriefCopySchema.safeParse(sent);
			const current = readBriefCopyInput(sent);

			expect(current.ok, JSON.stringify(sent)).toBe(legacy.success);

			if (legacy.success && current.ok)
				expect(current.value).toEqual(legacy.data);
		}
	});

	it.each([...notStrings, "send", [], ["send"], [{ action: "send" }]])(
		"refuses a body that is not an object, as the Zod schema does (case %#)",
		(sent) => {
			expect(readBriefCopyInput(sent).ok).toBe(false);
			expect(legacyBriefCopySchema.safeParse(sent).success).toBe(false);
		},
	);

	it("keeps an unset confirmation unset and reads true and false as given", () => {
		expect(readBriefCopyInput({ action: "send" })).toEqual({
			ok: true,
			value: { action: "send" },
		});
		expect(
			readBriefCopyInput({ action: "send", confirmedNotSent: true }),
		).toEqual({ ok: true, value: { action: "send", confirmedNotSent: true } });
	});
});
