// The owner's question about a software brief (POST /api/owner/requests/[id]/software, action question). The request and
// whether a project started are read and the rule decides (src/server/rules/offer-question.ts: project started, closed,
// resolved); without the mail settings nothing is written (F8, MailNotConfigured). Then the reservation batch moves the
// request's updated_at; the client email and the owner's copy go through the request machine's bridge (`asking`), and
// only once the client email was accepted is the question recorded, in a second batch guarded by the updated_at the
// reservation wrote. A refused batch is answered by the reads after it (src/server/rules/offer-refused-batch.ts); after
// the email, a failed store or read is OffersStoreFailedAfterEmail, whose answer says the email went out. A client email
// that was refused or may not have gone out is MailRefused or MailUncertain, with the reservation kept. It builds no
// response text.
import * as Effect from "effect/Effect";
import {
	readProjectStarted,
	recordQuestion,
	reserveQuestion,
} from "../offers-store";
import { askQuestion } from "../rules/offer-question";
import {
	afterRefusedQuestion,
	afterRefusedQuestionRecord,
} from "../rules/offer-refused-batch";
import { offerEmails } from "../rules/software-request";
import type { MessageCommand } from "../software-offer-input";
import {
	afterEmail,
	answerRefusedBatch,
	emailThroughMachine,
	findRequest,
	mailSettings,
	type OfferAction,
	type OfferMail,
} from "./offer-request";

/** The question the owner sends, and the mail settings to send it with. */
export type QuestionAction = OfferAction & {
	readonly command: MessageCommand;
	readonly mail: OfferMail;
};

/** Emails the client the question and records it; answers whether the owner's copy was sent. */
export const askSoftwareQuestion = (action: QuestionAction) =>
	Effect.gen(function* () {
		const request = yield* findRequest(action.requestId);
		const projectStarted = yield* readProjectStarted(action.requestId);

		const write = yield* askQuestion.decide(
			{ text: action.command.text, now: action.now(), actor: action.actor },
			{ request, projectStarted },
		);

		const settings = yield* mailSettings(action.mail);

		yield* reserveQuestion(write).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(afterRefusedQuestion, action),
			),
		);

		const landed = yield* emailThroughMachine(
			request.status,
			"QUESTION",
			offerEmails(settings, write.to, write.email),
		);

		yield* recordQuestion(write).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(afterRefusedQuestionRecord, action),
			),
			Effect.catchTag("OffersStoreFailed", afterEmail),
		);

		return landed.copySent;
	});
