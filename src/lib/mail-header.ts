// Text that reaches an email header (the subject, an address) is cleaned where the email is sent, whatever its source,
// so that a line break or another control character a visitor typed can never start a new header or hide in one.

// Built from a string: a literal U+2028 or U+2029 in a regular expression is a line terminator in older engines.
const controls = new RegExp("[\u0000-\u001f\u007f-\u009f\u2028\u2029]+", "g");

/** A subject: each run of control characters and line separators becomes one space, and the ends are trimmed. */
export function headerText(value: string): string {
	// A value that is not text (an unset address) is passed on as it is, so it fails where it always did.
	if (typeof value !== "string") return value;

	return value.replace(controls, " ").trim();
}

/** An address: control characters and line separators are removed. */
export function stripControls(value: string): string {
	if (typeof value !== "string") return value;

	return value.replace(controls, "");
}
