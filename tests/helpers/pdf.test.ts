import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { rawStreamOf } from "./pdf";

describe("rawStreamOf", () => {
	it("throws for an object that is not a raw PDF stream", async () => {
		const document = await PDFDocument.create();

		expect(() =>
			rawStreamOf(document.context.lookup(PDFName.of("Nope"))),
		).toThrow("Expected a raw PDF stream.");
	});
});
