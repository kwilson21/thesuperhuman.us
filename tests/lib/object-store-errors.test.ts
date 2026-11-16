import { describe, expect, it } from "vitest";
import {
	concurrentWriteToKey,
	multipartPartInvalid,
	multipartUploadGone,
} from "~/lib/audio-project-uploads";
import { objectStoreUnavailable } from "~/lib/object-store-errors";

// R2 writes its error code at the end of the message, "... (10043)". A message that has the number somewhere else is not that error.
describe("R2 error codes are read from the end of the message", () => {
	const cases: [string, (error: Error) => boolean, string][] = [
		["10043", objectStoreUnavailable, "The service is unavailable. (10043)"],
		["10058", concurrentWriteToKey, "Too many requests for one key. (10058)"],
		["10024", multipartUploadGone, "The multipart upload is gone. (10024)"],
		["10025", multipartPartInvalid, "A part is invalid. (10025)"],
	];

	for (const [code, matches, message] of cases) {
		it(`${code} is matched at the end`, () => {
			expect(matches(new Error(message))).toBe(true);
		});

		it(`${code} elsewhere in the message is not matched`, () => {
			expect(
				matches(new Error(`object (${code}) was not found, try again`)),
			).toBe(false);
			expect(matches(new Error(`key studio/${code}/a.mp3 failed`))).toBe(false);
		});
	}

	it("something that is not an error is not matched", () => {
		expect(objectStoreUnavailable("(10043)")).toBe(false);
	});
});
