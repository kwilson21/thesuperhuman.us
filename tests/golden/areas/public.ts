// Shared builders for the golden corpora of the public visitor routes (audio-intake, software-inquiry, music-interest,
// music-event, software/brief/suggest, software/brief/pass): one visitor request, the answers outside services give by
// default, and the table lists a case dumps.
import type { JsonValue } from "../../helpers/json";
import {
	asVisitor,
	byHost,
	json,
	type FetchAnswer,
	type Responder,
	type Step,
} from "../harness";

export const ORIGIN = "https://thesuperhuman.us";
export const IP = "203.0.113.7";

/** Turnstile passes and Resend sends. */
export const allGood: Responder = byHost({
	turnstile: json(200, { success: true }),
	resend: json(200, { id: "em_1" }),
});

/** Turnstile answers as given; Resend sends. */
export const outside = (
	turnstile: FetchAnswer,
	resend: FetchAnswer = json(200, { id: "em_1" }),
): Responder => byHost({ turnstile, resend });

/** Turnstile passes; Resend answers each call as the list says (the n-th call gets the n-th; the last repeats). */
export const resend = (...answers: FetchAnswer[]): Responder =>
	byHost({ turnstile: json(200, { success: true }), resend: answers });

/** A visitor's JSON POST with a same-origin header. `over` changes any step member (headers are merged). */
export function visit(
	path: string,
	body: JsonValue | undefined,
	over: Partial<Step> = {},
): Step {
	const { headers, ...rest } = over;

	return {
		as: asVisitor({ ip: IP }),
		path,
		json: body,
		headers: { origin: ORIGIN, ...headers },
		...rest,
	};
}

/** A visitor's raw-text POST with exactly the headers given (so Origin and content type can be left out). */
export function rawVisit(
	path: string,
	body: string | undefined,
	headers: { [name: string]: string } = {},
	over: Partial<Step> = {},
): Step {
	return { as: asVisitor({ ip: IP }), path, body, headers, ...over };
}

/** The tables the two intake forms write, and the rate-limit store. */
export const requestTables = [
	"owner_requests",
	"owner_request_audit",
	"audio_projects",
	"audio_project_audit",
];
