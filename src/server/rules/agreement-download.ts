// Who may download a signed agreement file, and which signed copy is intact. A verified visitor (an archive session, a
// signing session, or a studio session) may download an executed agreement that is theirs: the address of the agreement
// is the visitor's own, or the visitor's signing offer is the agreement's offer or reuses it, or the visitor's studio
// project is the agreement's project or is linked to it. Anything else is the same refusal as an unknown id, so the
// rules answer one refusal for every case a visitor can probe. Pure: the flow reads the plain columns and acts on the
// answer; no statement decides anything. The owner's download (`ownerCopy`) needs no visitor check: the owner route is
// behind sign-in, so it decides only whether the agreement's signed copy is ready and intact.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** The agreement a download may name, as read (any status; the rule decides which may be downloaded). */
export type DownloadAgreement = {
	readonly id: string;
	readonly offer_id: string | null;
	readonly request_id: string;
	readonly recipient_email: string;
	readonly status: string;
	readonly archive_closed_at: string | null;
};

/** One of the studio visitor's projects, as read with its brief and the agreement it names. */
export type StudioProject = {
	readonly request_id: string;
	readonly agreement_id: string | null;
	/** The master agreement the project's agreement names, if any. */
	readonly linked_msa_id: string | null;
	readonly request_status: string;
	readonly request_email: string;
	readonly revoked_at: string | null;
	readonly content_deleted_at: string | null;
};

/** The sessions a visitor holds. A session is present as a value even when its email is empty. */
export type VisitorSessions = {
	/** The recipient of the archive session. */
	readonly archive: { readonly recipient_email: string } | null;
	/** The signing session's recipient and offer. */
	readonly signing: {
		readonly recipient_email: string;
		readonly offer_id: string | null;
	} | null;
	/** The email of the studio session. */
	readonly studio: { readonly email: string } | null;
};

/** The facts a verified visitor's download is decided on, read before the decision and never after it. */
export type DownloadFacts = VisitorSessions & {
	readonly agreement: DownloadAgreement | null;
	/** The master agreement the signing session's offer reuses (`reused_msa_id`), if the offer is found and has one. */
	readonly signingReusedMsaId: string | null;
	/** The studio visitor's projects (none without a studio session). */
	readonly studioProjects: readonly StudioProject[];
};

/** The visitor holds no session: the answer asks them to verify. */
export class SignInFirst extends Data.TaggedError("SignInFirst") {
	readonly say = "Verify your agreement email first.";
}

/** Nothing a visitor can download answers here, the same as an unknown id. */
export class AgreementNotFound extends Data.TaggedError("AgreementNotFound") {
	readonly say = "Not found";
}

/** A visitor with any session is verified; with none, the answer is the same for every id. */
export const verifiedVisitor = alwaysWrites({
	name: "ask a visitor with no session to verify",
	given: (_request: null, facts: VisitorSessions) => facts,
	refusals: [
		unless(
			term(
				"the visitor holds an archive, signing or studio session",
				(given: VisitorSessions) =>
					given.archive !== null ||
					given.signing !== null ||
					given.studio !== null,
			),
			() => new SignInFirst(),
		),
	],
	writes: (given) => given,
	writesText: "the visitor, as verified",
});

type DownloadGiven = {
	readonly id: string;
	readonly open: boolean;
	readonly theirs: boolean;
};

/** Whether an email is the agreement's address: both must be there, and equal (an empty address equals an empty one). */
const sameAddress = (
	email: string | null | undefined,
	agreement: DownloadAgreement,
) =>
	email !== null && email !== undefined && email === agreement.recipient_email;

function downloadGiven(
	request: { readonly id: string },
	facts: DownloadFacts,
): DownloadGiven {
	const agreement = facts.agreement;
	const id = request.id;

	if (agreement === null) return { id, open: false, theirs: false };

	const open =
		agreement.status === "executed" && agreement.archive_closed_at === null;

	const byArchive = sameAddress(facts.archive?.recipient_email, agreement);

	// A signing session names its offer; both being absent is equal, as the comparison was before.
	const bySigning =
		facts.signing !== null &&
		sameAddress(facts.signing.recipient_email, agreement) &&
		(facts.signing.offer_id === agreement.offer_id ||
			facts.signingReusedMsaId === id);

	const project = facts.studioProjects.find(
		(candidate) =>
			candidate.request_id === agreement.request_id &&
			candidate.request_status !== "withdrawn" &&
			candidate.request_email !== "" &&
			candidate.revoked_at === null &&
			candidate.content_deleted_at === null,
	);

	const byStudio =
		sameAddress(facts.studio?.email, agreement) &&
		project !== undefined &&
		(project.agreement_id === id || project.linked_msa_id === id);

	return { id, open, theirs: byArchive || bySigning || byStudio };
}

/** Whether a verified visitor may download this agreement. One refusal for an unknown id and for everything not theirs. */
export const decideDownload = alwaysWrites({
	name: "let a verified visitor download their executed agreement",
	given: downloadGiven,
	refusals: [
		unless(
			term(
				"the agreement is executed and its archive is not closed",
				(given: DownloadGiven) => given.open,
			),
			() => new AgreementNotFound(),
		),
		unless(
			term(
				"the agreement is the visitor's own, through the archive, signing or studio session",
				(given: DownloadGiven) => given.theirs,
			),
			() => new AgreementNotFound(),
		),
	],
	writes: (given) => ({ id: given.id }),
	writesText: "the id of the agreement whose signed copy is read",
});

/** The signed copy of an agreement as stored (one row per agreement). */
export type StoredSignedCopy = {
	readonly status: string;
	readonly pdf_key: string | null;
	readonly pdf_sha256: string | null;
};

/** The agreement is signed by both parties but its copy is not ready yet. */
export class CopyNotReady extends Data.TaggedError("CopyNotReady") {
	readonly say = "Signed by both parties. Copy preparation needs attention.";
}

/** The ready copy's key, or nothing: the copy row is absent, not ready, or names no object. */
export const readySignedCopy = alwaysWrites({
	name: "read a signed copy that is ready",
	given: (_request: null, facts: StoredSignedCopy | null) => ({
		ready:
			facts !== null &&
			facts.status === "ready" &&
			facts.pdf_key !== null &&
			facts.pdf_key !== ""
				? { pdf_key: facts.pdf_key, pdf_sha256: facts.pdf_sha256 }
				: null,
	}),
	refusals: [
		unless(
			term(
				"the copy is ready and names an object",
				(given: { ready: object | null }) => given.ready !== null,
			),
			() => new CopyNotReady(),
		),
	],
	writes: (given) => given.ready,
	writesText: "the key and digest of the ready copy",
});

/** The bytes in the bucket are not the copy the row names. */
export class CopyIntegrity extends Data.TaggedError("CopyIntegrity") {
	readonly say = "Signed copy failed its integrity check. Contact Kazon.";
}

/** The bytes are the copy the row names. A row with no digest, or an empty one, is never intact. */
export const intactSignedCopy = alwaysWrites({
	name: "hand over a signed copy whose bytes match its digest",
	given: (
		request: { readonly bytesSha256: string },
		facts: { readonly pdf_sha256: string | null },
	) => ({ stored: facts.pdf_sha256, actual: request.bytesSha256 }),
	refusals: [
		unless(
			term(
				"the copy has a digest and the bytes have it",
				(given: { stored: string | null; actual: string }) =>
					given.stored !== null &&
					given.stored !== "" &&
					given.stored === given.actual,
			),
			() => new CopyIntegrity(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the bytes are handed over",
});

/** The agreement the owner's download names, as read with its client (any status; the rule decides). */
export type OwnerCopyAgreement = Pick<
	DownloadAgreement,
	"status" | "archive_closed_at"
>;

/**
 * What the owner's download has read so far. The facts are read one at a time, each only once the facts before it
 * passed, in today's order: the agreement, then its copy row, then the bytes of the copy's object. A fact not read yet is
 * absent.
 */
export type OwnerCopyFacts = {
	/** The agreement, or null when none with the id has a client. */
	readonly agreement: OwnerCopyAgreement | null;
	/** The agreement's copy row (null when it has none); absent until it is read. */
	readonly copy?: StoredSignedCopy | null;
	/** The digest of the bytes read from the copy's object; absent until they are read. */
	readonly bytesSha256?: string;
};

/** What the owner's download does next: read the copy row, read the bytes of its object, or hand the bytes over. */
export type OwnerCopyStep =
	| { readonly next: "read-copy" }
	| {
			readonly next: "read-bytes";
			readonly pdf_key: string;
			readonly pdf_sha256: string | null;
	  }
	| { readonly next: "hand-over" };

function ownerCopyStep(given: OwnerCopyFacts): OwnerCopyStep {
	if (given.copy === undefined) return { next: "read-copy" };

	if (given.bytesSha256 !== undefined) return { next: "hand-over" };

	// SAFETY: this runs only once the refusals passed, which ruled out a copy that is missing or names no object.
	const copy = given.copy as StoredSignedCopy & { readonly pdf_key: string };

	return {
		next: "read-bytes",
		pdf_key: copy.pdf_key,
		pdf_sha256: copy.pdf_sha256,
	};
}

/**
 * The owner's download of a signed copy (today's `agreementDownload`, src/lib/agreement-download.ts): an executed
 * agreement whose archive is open, then a copy that is ready and names an object, then bytes that have the copy's
 * digest; the same conditions and sentences as the visitor's `decideDownload` (its first term), `readySignedCopy` and
 * `intactSignedCopy`, without the visitor's ownership. Each answer names the next fact to read until every one is read.
 * An object that is missing is the flow's unexpected store state (B8), not a refusal.
 */
export const ownerCopy = alwaysWrites({
	name: "let the owner download an executed agreement's intact ready copy",
	given: (_request: null, facts: OwnerCopyFacts) => facts,
	refusals: [
		unless(
			term(
				"the agreement is executed and its archive is not closed",
				(given: OwnerCopyFacts) =>
					given.agreement !== null &&
					given.agreement.status === "executed" &&
					given.agreement.archive_closed_at === null,
			),
			() => new AgreementNotFound(),
		),
		unless(
			term(
				"the copy is ready and names an object, or it is not read yet",
				(given: OwnerCopyFacts) =>
					given.copy === undefined ||
					(given.copy !== null &&
						given.copy.status === "ready" &&
						given.copy.pdf_key !== null &&
						given.copy.pdf_key !== ""),
			),
			() => new CopyNotReady(),
		),
		unless(
			term(
				"the copy has a digest and the bytes have it, or they are not read yet",
				(given: OwnerCopyFacts) => {
					const stored = given.copy?.pdf_sha256 ?? null;

					return (
						given.bytesSha256 === undefined ||
						(stored !== null && stored !== "" && stored === given.bytesSha256)
					);
				},
			),
			() => new CopyIntegrity(),
		),
	],
	writes: ownerCopyStep,
	writesText:
		"the next fact to read (the copy row, then its object's bytes), or the bytes handed over",
});
