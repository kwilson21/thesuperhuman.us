/** The keys of o, typed as keyof T. Callers pass an object literal whose own keys are exactly its declared keys. */
export function keysOf<T extends object>(o: T): (keyof T)[] {
	// SAFETY: o is an object literal with no inherited or computed keys, so Object.keys returns exactly the keys declared in T.
	return Object.keys(o) as (keyof T)[];
}
