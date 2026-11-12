// A test fake for an R2 bucket. R2Bucket's methods are overloaded, so a test's put, get, list and delete are typed with
// the loose signature below. The code under test calls only these four members; any other R2Bucket member is absent at
// run time, so a call to it throws a TypeError and the test fails.

type R2Member = (...args: never[]) => void;

/** An R2 bucket with the four members the tests use, and no others. */
export function fakeR2Bucket(members: {
	put: R2Member;
	get: R2Member;
	list: R2Member;
	delete: R2Member;
}): R2Bucket {
	// SAFETY: the code under test calls only put, get, list and delete, with the arguments these fakes accept; any other member of R2Bucket is absent and throws if called.
	return members as R2Bucket;
}
