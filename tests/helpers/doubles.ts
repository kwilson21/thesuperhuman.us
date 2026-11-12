// Test doubles for platform types. double() is for SERVICES: a test supplies only the methods the code under test
// calls, and a method it does not supply is absent at run time, so a call to it throws a TypeError and the test fails.
// partial() is for plain DATA: the code under test reads fields, and a field the test does not supply reads undefined.

/** A service typed as `T`: the members given and no others. A call to any other member throws. */
export function double<T>(members: Partial<T>): T {
	// SAFETY: the code under test calls only the members the test supplies; any other member of T is absent, so a call to it throws and fails the test.
	return members as T;
}

/** A data fixture typed as `T`: the fields given and no others. Every other field reads undefined. */
export function partial<T>(fields: Partial<T>): T {
	// SAFETY: the function under test reads only the supplied fields; every other field reads undefined.
	return fields as T;
}

/** A D1 binding with the statement and batch members the test supplies, and no others. */
export function fakeD1(members: Partial<D1Database>): D1Database {
	return double<D1Database>(members);
}

type KvGet = (
	key: string,
	type?: string,
) => Promise<string | ArrayBuffer | null>;

/**
 * A KV namespace with the members the test supplies. KVNamespace's `get` has many overloads, so a test's `get`
 * gives the one signature the code under test uses; `list` is for the OAuth library, which lists keys. The other
 * members are absent and throw if called.
 */
export function fakeKv(
	members: { get: KvGet } & Partial<
		Record<"put" | "delete" | "list", (...args: never[]) => void>
	>,
): KVNamespace {
	// SAFETY: the code under test calls only get, put, delete and list, with the arguments these fakes accept; any other member of KVNamespace is absent and throws if called.
	return members as KVNamespace;
}
