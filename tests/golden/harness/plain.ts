// Turns the values a route hands to the platform into JSON a fixture can hold, with nothing lost silently.
//
// A fixture is JSON, so a value JSON cannot carry (undefined, bytes, a bigint, a Date, Headers) is written as a tagged
// object, never left to JSON.stringify to drop or reshape. Bytes are recorded as their length and SHA-256, never raw.
import { createHash } from "node:crypto";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { isText } from "~/lib/type-guards";

/** What a fixture holds: JSON, where every value the platform could not carry in JSON is a tagged object. */
export type Recorded =
	| string
	| number
	| boolean
	| null
	| Recorded[]
	| { [key: string]: Recorded };

/** A value a route passes to a binding: what D1, R2, KV, fetch and Workers AI accept, as far as a recording needs. */
export type Passed =
	| string
	| number
	| boolean
	| bigint
	| null
	| undefined
	| Date
	| Uint8Array
	| ArrayBuffer
	| Headers
	| URLSearchParams
	| readonly Passed[]
	| { [key: string]: Passed };

export const isBigint = (value: Passed | SQLOutputValue): value is bigint =>
	typeof value === "bigint";

const isNumber = (value: Passed): value is number => typeof value === "number";

const isBoolean = (value: Passed): value is boolean =>
	typeof value === "boolean";

/** Bytes in their own buffer, which a Response or Blob accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Bytes a route passed, recorded as a length and a digest. */
export type ByteRecord = { $bytes: { length: number; sha256: string } };

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function byteRecord(bytes: Uint8Array): ByteRecord {
	return { $bytes: { length: bytes.byteLength, sha256: sha256(bytes) } };
}

/** The bytes of a buffer or a view, as a Uint8Array over the same memory. */
export function viewOf(value: ArrayBuffer | Uint8Array): Uint8Array {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Reads a stream to its end. */
export async function drain(
	stream: ReadableStream<Uint8Array>,
): Promise<Bytes> {
	const parts: Uint8Array[] = [];
	const reader = stream.getReader();

	for (;;) {
		const { done, value } = await reader.read();

		if (done) break;

		parts.push(value);
	}

	return concat(parts);
}

export function concat(parts: readonly Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;

	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}

	return out;
}

/**
 * The recorded form of a value. A tag names what JSON cannot say: `{$undefined:true}`, `{$bigint:"1"}`,
 * `{$date:"…"}`, `{$bytes:{length,sha256}}`. Object keys keep the order the code wrote them in; a Headers object is
 * recorded with its names lowercased and sorted, as a header set has no order.
 */
export function plain(value: Passed): Recorded {
	if (value === undefined) return { $undefined: true };

	if (value === null) return null;

	if (isBigint(value)) return { $bigint: value.toString() };

	if (isText(value) || isNumber(value) || isBoolean(value)) return value;

	if (value instanceof Date) return { $date: value.toISOString() };

	if (value instanceof ArrayBuffer || value instanceof Uint8Array)
		return byteRecord(viewOf(value));

	if (value instanceof Headers)
		return Object.fromEntries(
			[...value.entries()].sort(([a], [b]) => a.localeCompare(b)),
		);

	if (value instanceof URLSearchParams) return { $form: value.toString() };

	if (Array.isArray(value)) return value.map((item) => plain(item));

	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, plain(item)]),
	);
}

/** A bound D1 argument, as a fixture holds it: bytes (any typed array) as a length and a digest. */
export function argRecord(value: SQLInputValue): Recorded {
	return ArrayBuffer.isView(value)
		? byteRecord(
				new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
			)
		: plain(value);
}

/** An Error recorded by its name and message, which a route can read. */
export function errorText(error: Error): string {
	return `${error.name}: ${error.message}`;
}
