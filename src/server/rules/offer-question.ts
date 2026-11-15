// The owner's question about a software brief, emailed to the client. Decided from the request as read (its status, email
// and updated_at) and whether a project has started: refused when a project has started, then when the request is closed,
// then when it is resolved. The status allows QUESTION by the machine (`softwareRequest`), which moves through `asking`:
// the email is invoked there and the question is recorded only once the client email was accepted. After these refusals
// and before anything is written the flow checks the mail settings (F8, a 503 with nothing written). Writes: first the
// reservation, the request's updated_at; after the client email, the audit `question-sent`. Re-checked at write time by G1
// (the reservation: the request as read; the record: the updated_at the reservation wrote) and G2 (no project) in both
// batches; a refused batch is answered by the reads in src/server/rules/offer-refused-batch.ts.
import { alwaysWrites } from "../terms";
import {
	type EmailWords,
	noProjectStarted,
	type ProjectRead,
	type Requested,
	type RequestRead,
	RequestResolved,
	requestOpen,
	requestRead,
	signedText,
	statusAllows,
	writeTime,
} from "./software-request";

export type QuestionRequest = {
	/** The question, trimmed by the command reader. */
	readonly text: string;
	readonly now: string;
	readonly actor: string;
};

type QuestionGiven = Requested &
	ProjectRead & { readonly command: QuestionRequest };

/**
 * The question's two batches and its email. The reservation is G1 over `request`, G2, and the request's updated_at set
 * to `at`; the record, after the client email, is G1 with updated_at `at`, G2, and the audit, at `at`.
 */
export type QuestionWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	/** The client's address: the request's email, as stored. */
	readonly to: string;
	readonly email: EmailWords;
	readonly audit: "question-sent";
};

export const askQuestion = alwaysWrites({
	name: "ask the client a question about the brief",
	given: (
		command: QuestionRequest,
		facts: Requested & ProjectRead,
	): QuestionGiven => ({ command, ...facts }),
	refusals: [
		noProjectStarted,
		requestOpen("QUESTION"),
		statusAllows("QUESTION", () => new RequestResolved()),
	],
	writes: (given): QuestionWrite => ({
		request: requestRead(given.request),
		at: writeTime(given.command.now, given.request.updatedAt),
		actor: given.command.actor,
		to: given.request.email,
		email: {
			subject: "A question about your project brief",
			text: signedText(given.command.text),
		},
		audit: "question-sent",
	}),
	writesText:
		"the reservation (the request's updated_at), then the client email and its copy, then the audit question-sent once the client email was accepted",
});
