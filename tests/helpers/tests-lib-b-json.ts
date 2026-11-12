/**
 * The parsed JSON body of a response, typed as `T`. The caller names the body shape it expects, and the assertions it
 * makes on the fields it reads check that shape: a body that differs fails the test.
 */
export async function readJson<T>(response: Response): Promise<T> {
	// SAFETY: response.json() returns the parsed body unchecked; T is the shape the calling test names, and the test's assertions on the fields it reads fail if the body differs.
	return (await response.json()) as T;
}
