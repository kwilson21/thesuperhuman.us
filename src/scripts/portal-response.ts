/**
 * Reads the JSON body of a client-portal route response. A route that is switched off answers a
 * plain-text 404, so json() throws; call this where the surrounding catch handles that.
 */
export async function readPortalJson<
	Fields extends object = { error?: string },
>(response: Response) {
	// SAFETY: the client-portal routes under src/pages/api/studio and src/pages/api/owner/projects answer with JSON, except for a plain-text 404 ("Not found") that makes json() throw before this cast; each caller declares only optional fields and reads them after its own response.ok check.
	return (await response.json()) as Fields;
}
