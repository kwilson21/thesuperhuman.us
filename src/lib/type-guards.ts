/** Type guards shared across src/lib. No server-only imports: browser scripts reach some of these modules. */

/** True for strings; the generic form keeps a more specific input type, such as a literal union, narrowed to its string part. */
export function isText<T>(value: T): value is T & string {
	return typeof value === "string";
}

/** True for non-null objects, including arrays. */
export function isObject(value: unknown): value is object {
	return value !== null && typeof value === "object";
}
