/** Any value JSON.parse can return. Callers check the shape before they use it. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };
