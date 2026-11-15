// The two refusals every form that checks a captcha shares. A refused token and a check that could not answer are different
// answers (the visitor is asked to try again only when the check could not answer), so each is its own named refusal, and a
// route reads the name. Each carries the sentence the forms that show one use (a pass form shows none).
import * as Data from "effect/Data";
import { intakeCheckAgain, intakeUnavailable } from "../../lib/music-request";

/** The check said the token is not good. */
export class CaptchaRefused extends Data.TaggedError("CaptchaRefused") {
	readonly say = intakeCheckAgain;
}

/** The check could not answer: the route answers 503 and the visitor keeps the form. */
export class CaptchaUnavailable extends Data.TaggedError("CaptchaUnavailable") {
	readonly say = intakeUnavailable;
}
