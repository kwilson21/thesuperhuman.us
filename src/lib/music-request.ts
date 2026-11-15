import type { JsonValue } from "./json-value";

export async function musicRequest(
	request: Request,
	maxBytes = 8192,
): Promise<JsonValue | Response> {
	if (request.headers.get("origin") !== new URL(request.url).origin)
		return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

	if (
		request.headers.get("content-type")?.split(";")[0].trim() !==
		"application/json"
	)
		return Response.json(
			{ ok: false, error: "JSON required" },
			{ status: 415 },
		);
	const reader = request.body?.getReader();

	if (!reader)
		return Response.json(
			{ ok: false, error: "Missing request" },
			{ status: 400 },
		);
	let bytes = 0;
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;
		bytes += value.byteLength;

		if (bytes > maxBytes) {
			await reader.cancel();

			return Response.json(
				{ ok: false, error: "Request too large" },
				{ status: 413 },
			);
		}

		chunks.push(value);
	}

	const buffer = new Uint8Array(bytes);
	let offset = 0;

	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}

	try {
		return JSON.parse(new TextDecoder().decode(buffer));
	} catch {
		return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
	}
}

/** The sentence a listener is shown when what they sent could not be stored. */
const NOT_SAVED = "Your request could not be saved. Please try again shortly.";

/** A binding or secret this deployment does not have: a deliberate 503. */
export const musicUnavailable = () =>
	Response.json({ ok: false, error: NOT_SAVED }, { status: 503 });

/** A store that failed unexpectedly, or a defect: the same sentence, and 500 because nothing is known to be unavailable. */
export const musicFailed = () =>
	Response.json({ ok: false, error: NOT_SAVED }, { status: 500 });

// The fixed sentences of the public intake forms (the audio request and the software brief), which both routes and their
// refusals show. A route builds the response around them; the status is the route's.

// A refusal's own sentence (a wait, a refused captcha, a captcha outage, a submission id taken) is its `say` in the rule
// file; what is here is answered for a failure, which is no rule's refusal.

/** An intake's own store or limiter could not answer. */
export const intakeUnavailable =
	"Sending is temporarily unavailable. Your details are still here. Please try again later.";

/** The request or brief was not stored. */
export const intakeNotStored =
	"We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.";

/** The brief's details are too large to store. */
export const intakeTooLarge = "Keep the brief shorter and try again.";

/** A binding or secret this deployment does not have: a deliberate 503. */
export const intakeNotAvailable = () =>
	Response.json(
		{
			ok: false,
			error:
				"Sending is unavailable right now. Your details are still here. Please email kazon.wilson@thesuperhuman.us.",
		},
		{ status: 503 },
	);

/** The intake's temporary sentence, with the status the route gives it (503 for a known outage, 500 otherwise). */
export const intakeTemporarilyUnavailable = (status: number) =>
	Response.json({ ok: false, error: intakeUnavailable }, { status });
