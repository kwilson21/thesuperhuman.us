// Which attachment a signing session may download. An attachment is shown only when the offer the session signs pins it
// (its key and digest appear in the offer's agreement details) and the attachment belongs to that offer's request. Every
// other case, an unknown id included, is the same refusal, so the answer does not tell the visitor which ids exist.
// Pure: the flow reads the row the store finds and acts on the answer.

/** The attachment row the store found for this session's offer, if the offer pins it. */
export type AttachmentRow = {
	readonly object_key: string;
	readonly sha256: string;
};

/** Whether an attachment row was found for the session's offer. A missing row is a refusal, as an unknown id is. */
export function decideAttachment(
	row: AttachmentRow | null,
): { kind: "allowed"; row: AttachmentRow } | { kind: "refused" } {
	return row === null ? { kind: "refused" } : { kind: "allowed", row };
}
