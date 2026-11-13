// The contact form's rule, in the style for rules with no states (kwilson21/tally `src/rules`, Effect alone): it reads
// what it needs through services, and either finishes or fails with a named refusal that carries its sentence. The
// time, the visitor's address and the two email addresses are plain inputs. The route maps each refusal to its answer.
//
// What it does, in order: count the submission and check the captcha (./guards), email the owner what the visitor wrote,
// then email the visitor a thank-you. The thank-you is best effort: if it fails, the submission still succeeded.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { contactOwnerMessage, contactReplyMessage } from "../../lib/resend";
import type { ContactInput } from "../contact-input";
import { Mail } from "../services";
import { type Visitor, passGuards } from "./guards";

/** Resend did not take the email to the owner, so nothing reached the owner. */
export class ContactNotDelivered extends Data.TaggedError(
	"ContactNotDelivered",
) {
	readonly say =
		"We could not confirm email delivery. Please email kazon.wilson@thesuperhuman.us directly.";
}

export type ContactSubmission = {
	readonly input: ContactInput;
	readonly visitor: Visitor;
	/** env.CONTACT_FROM_EMAIL */
	readonly from: string;
	/** env.CONTACT_TO_EMAIL */
	readonly to: string;
};

export const submitContact = (submission: ContactSubmission) =>
	Effect.gen(function* () {
		const { input, visitor, from, to } = submission;

		yield* passGuards(visitor);

		const mail = yield* Mail;

		yield* mail
			.send(contactOwnerMessage({ input, from, to }))
			.pipe(Effect.mapError(() => new ContactNotDelivered()));

		// Best effort: the owner has the message, so a failed thank-you does not fail the request.
		yield* mail.send(contactReplyMessage({ input, from })).pipe(Effect.ignore);
	});
