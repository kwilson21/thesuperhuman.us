// Test doubles for platform types. A test supplies only the members the code under test calls. A member it does not
// supply is absent at run time, so a call to it throws a TypeError and the test fails. That is the claim these
// helpers make, and double() is the one place it is written.

/** `members` typed as `T`: a test double with the members given and no others. */
export function double<T>(members: Partial<T>): T {
	// SAFETY: the code under test calls only the members the test supplies; any other member of T is absent, so a call to it throws and fails the test.
	return members as T;
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
 * gives the one signature the code under test uses; the other members are absent and throw if called.
 */
export function fakeKv(
	members: { get: KvGet } & Partial<
		Record<"put" | "delete", (...args: never[]) => void>
	>,
): KVNamespace {
	// SAFETY: the code under test calls only get, put and delete, with the arguments these fakes accept; any other member of KVNamespace is absent and throws if called.
	return members as KVNamespace;
}
