// The request handling of the dev server's POST /__screenshots/clock (dev.config.mjs), kept apart from the
// Vite plugin so it can be tested. A request sets the server's frozen clock to a step's instant (clock.mjs)
// and answers with the time the clock shows afterwards, so a clock that did not move is visible to capture.

// A clock body is one small JSON object. Anything longer is refused without being read to the end.
export const CLOCK_BODY_LIMIT = 512;

// The widest range Date supports, in milliseconds either side of 1970.
const DATE_RANGE_MS = 8.64e15;

/** The request body as text, or undefined when it is longer than `limit` bytes. */
export async function readLimitedBody(request, limit = CLOCK_BODY_LIMIT) {
	const chunks = [];
	let size = 0;

	for await (const chunk of request) {
		size += chunk.length;

		// A client still sending when the limit is hit may see the connection close before it reads the 413.
		if (size > limit) return undefined;
		chunks.push(chunk);
	}

	return Buffer.concat(chunks).toString("utf8");
}

/** Whether a Content-Type header names application/json, with or without parameters. */
const isJson = (contentType) =>
	String(contentType ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase() === "application/json";

/** The `now` of a `{ "now": <integer ms> }` body within Date's range, or undefined when it is not one. */
function parseClockBody(text) {
	try {
		const { now } = JSON.parse(text);

		return Number.isSafeInteger(now) && Math.abs(now) <= DATE_RANGE_MS
			? now
			: undefined;
	} catch {
		return undefined;
	}
}

const empty = (status, headers = {}) => ({ status, headers, body: "" });

/**
 * Answers one request. `body` is what readLimitedBody returned, or undefined when the body was too long.
 * `clock` is the handle installClock returns. Returns `{ status, headers, body }`.
 */
export function handleClockPost({ method, contentType, body }, clock) {
	if (method !== "POST") return empty(405, { allow: "POST" });

	// A page on another origin can only send a form-encoded or plain-text POST without asking first. Requiring
	// JSON makes the browser check the origin before the request reaches the clock.
	if (!isJson(contentType)) return empty(415);

	if (body === undefined) return empty(413);

	const now = parseClockBody(body);

	if (now === undefined) return empty(400);

	clock.set(now);

	return {
		status: 200,
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ok: true, now: clock.now() }),
	};
}

/**
 * The dev server's middleware for /__screenshots/clock, for `clock` (the handle installClock returns). It reads the
 * body of a POST, answers with handleClockPost, and answers 404 for any path other than the endpoint's own.
 */
export function clockMiddleware(clock) {
	return async (request, response) => {
		// Mounted by prefix, so only the exact path is this endpoint.
		if (request.url !== "/") {
			response.statusCode = 404;

			return response.end();
		}

		const body =
			request.method === "POST" ? await readLimitedBody(request) : "";

		const reply = handleClockPost(
			{
				method: request.method,
				contentType: request.headers["content-type"],
				body,
			},
			clock,
		);

		response.statusCode = reply.status;

		for (const [name, value] of Object.entries(reply.headers))
			response.setHeader(name, value);
		response.end(reply.body);
	};
}
