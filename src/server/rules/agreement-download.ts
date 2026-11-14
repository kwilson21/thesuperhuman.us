// Who may download a signed agreement file, and which signed copy is intact. A verified visitor (an archive session, a
// signing session, or a studio session) may download an executed agreement that is theirs: the address of the agreement
// is the visitor's own, or the visitor's signing offer is the agreement's offer or reuses it, or the visitor's studio
// project is the agreement's project or is linked to it. Anything else is the same refusal as an unknown id, so the
// rule answers one refusal for every case a visitor can probe. Pure: the flow reads the facts and acts on the answer.

/** The executed agreement a download may name, as read. */
export type DownloadAgreement = {
	readonly id: string;
	readonly offer_id: string;
	readonly request_id: string;
	readonly recipient_email: string;
};

/** The facts a verified visitor's download is decided on, read before the decision and never after it. */
export type DownloadFacts = {
	readonly agreement: DownloadAgreement | null;
	/** The recipient of the archive session, if the visitor has one. */
	readonly archiveEmail: string | null;
	/** The signing session's recipient and offer, if the visitor has one. */
	readonly signing: {
		readonly recipient_email: string;
		readonly offer_id: string | null;
	} | null;
	/** Whether the signing session's offer reuses this agreement as its MSA. */
	readonly signingReusesAgreement: boolean;
	/** The email of the studio session, if the visitor has one. */
	readonly studioEmail: string | null;
	/** The agreement a studio project of this client that is for this agreement's request names, if any. */
	readonly projectAgreementId: string | null;
	/** The MSA the project's agreement names as its master, if any. */
	readonly linkedMsaId: string | null;
};

/** The one refusal for everything a visitor cannot download, and for an unknown id. */
export type DownloadDecision =
	| { readonly kind: "allowed"; readonly agreement: DownloadAgreement }
	| { readonly kind: "refused" };

export function decideDownload(
	id: string,
	facts: DownloadFacts,
): DownloadDecision {
	const agreement = facts.agreement;

	if (agreement === null) return { kind: "refused" };

	const byArchive = facts.archiveEmail === agreement.recipient_email;

	const bySigning =
		facts.signing !== null &&
		facts.signing.recipient_email === agreement.recipient_email &&
		(facts.signing.offer_id === agreement.offer_id ||
			facts.signingReusesAgreement);

	const byStudio =
		facts.studioEmail === agreement.recipient_email &&
		(facts.projectAgreementId === id || facts.linkedMsaId === id);

	return byArchive || bySigning || byStudio
		? { kind: "allowed", agreement }
		: { kind: "refused" };
}

/** The signed copy as stored: its key, its digest, and its status. */
export type SignedCopy = {
	readonly status: string;
	readonly pdf_key: string | null;
	readonly pdf_sha256: string | null;
};

/** Whether the bytes read from the bucket are the copy the row names. A row with no digest is never intact. */
export function copyIsIntact(copy: SignedCopy, bytesSha256: string): boolean {
	return (
		copy.pdf_sha256 !== null &&
		copy.pdf_sha256 !== "" &&
		copy.pdf_sha256 === bytesSha256
	);
}
