import { PDFRawStream, type PDFObject } from "pdf-lib";

/** The raw stream a parsed PDF holds at a lookup, or a thrown error if the object is not a raw stream. */
export function rawStreamOf(object: PDFObject | undefined): PDFRawStream {
	if (object instanceof PDFRawStream) return object;
	throw new Error("Expected a raw PDF stream.");
}
