// The two refusals every form that checks a captcha shares. A refused token and a check that could not answer are different
// answers (the visitor is asked to try again only when the check could not answer), so each is its own named refusal, and a
// flow reads the name.

/** The check said the token is not good. */
export class CaptchaRefused {
	readonly _tag = "CaptchaRefused";
	readonly say = "";
}

/** The check could not answer: the route answers 503 and the visitor keeps the form. */
export class CaptchaUnavailable {
	readonly _tag = "CaptchaUnavailable";
	readonly say = "";
}
