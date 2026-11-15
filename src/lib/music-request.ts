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

// The fixed answers of the owner's software request actions (POST /api/owner/requests/[id]/software). The owner's page
// shows `message`, and every answer of that route is private. A refusal's own sentence is the route's; what is here is
// answered for a failure, which is no refusal.

const offersAnswer = (message: string, status: number) =>
	Response.json(
		{ ok: false, message },
		{ status, headers: { "cache-control": "private, no-store" } },
	);

/** A dependency this deployment does not have (the mail settings, the attachment bucket): a deliberate 503. */
export const offersUnavailable = () =>
	offersAnswer("Software offers are temporarily unavailable.", 503);

/** A store that failed unexpectedly, or a defect: 500, because nothing is known to be unavailable. */
export const offersFailed = () =>
	offersAnswer("The change could not be saved. Please try again.", 500);

/** A store that failed after the client email (a question's record, a decline's resolve, a send's live-link check). */
export const offersFailedAfterEmail = () =>
	offersAnswer(
		"The email was sent, but saving failed. Reload before you try again.",
		500,
	);

/** A store that failed after the draft was saved, while an attachment the draft removed was being cleaned up. */
export const offersFailedAfterDraft = () =>
	offersAnswer(
		"The draft was saved, but an attachment could not be cleaned up. Reload before you try again.",
		500,
	);
