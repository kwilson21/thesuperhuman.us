// Typed reads of JSON that a test received from, or sent to, the code under test. The caller names the shape it
// reads. Nothing here checks the shape: an expect() that reads a field the response does not carry fails the test.

/** The parsed JSON body of a response the code under test returned, typed as the caller's expectations read it. */
export async function jsonBody<T>(response: Response): Promise<T> {
	const body: T = await response.json();

	return body;
}

/** The parsed JSON text of a body the code under test sent, typed as the caller's expectations read it. */
export function parseJson<T>(text: string): T {
	const value: T = JSON.parse(text);

	return value;
}

/** A value that JSON.stringify sends as written. Test request bodies are object literals built from these. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| JsonObject;

/** A JSON object body. An undefined member is omitted by JSON.stringify, as a test that leaves it out expects. */
export type JsonObject = { [key: string]: JsonValue | undefined };
