// The agreement a send pins when signing is on and the offer sent is the open draft: its details, the two current
// templates, the contractor's details, the MSA it reuses, each attachment's metadata row and bytes, and the packet's
// preflight. Pinning is a flow step (pinAgreement), because it reads D1 and R2; it reads in the order the route has
// always read, and asks these rules between its reads, so the refusals come in that order
// (docs/plans/2026-11-offers-conversion.md, section 2, "send"):
//   the stored details, checked against the terms: DetailsIncomplete, with errors when a reader refused (pinDetails);
//   the MSA and SOW templates and the contractor config: TemplatesMissing (pinTemplates);
//   the contractor's details: DetailsIncomplete, with errors when the reader refused (pinContractor);
//   the reused MSA, executed, open and ready for the request's address: MsaUnavailable (pinReusedMsa);
//   each attachment's metadata row, then its object and size, then its digest: DetailsIncomplete (attachmentRowFound,
//   attachmentObjectSized, attachmentDigestMatches);
//   the preflight of the packet: DetailsIncomplete (packetReady).
// The facts are what the flow read; nothing here reads. What fails as a store, or a missing R2 binding, is the flow's
// fixed answer, not a refusal (F4, #313). Re-checked at write time: the attachments by G11 in the send's batch; the
// rest is pinned as read (the batch writes the details, the template ids and the contractor snapshot it read).
import * as Data from "effect/Data";
import {
	type AgreementDetails,
	type Contractor,
	parseContractor,
	validateAgreementDetails,
} from "../../lib/agreement-fields";
import type { AgreementTemplate } from "../../lib/agreement-templates";
import { FieldsRefused } from "../../lib/fields";
import type { OfferTerms } from "../../lib/software-offers";
import { alwaysWrites, term, unless } from "../terms";
import { type NamedAttachment, proved } from "./software-request";

/** The details or the packet are not complete: 400, with `errors` (keyed `agreement.<path>`) only when a reader refused. */
export class DetailsIncomplete extends Data.TaggedError("DetailsIncomplete")<{
	readonly errors: Readonly<Record<string, string>> | undefined;
}> {
	readonly say = "Complete and validate Agreement details before sending.";
}

export class TemplatesMissing extends Data.TaggedError("TemplatesMissing") {
	readonly say =
		"Publish both templates and complete contractor details before sending.";
}

export class MsaUnavailable extends Data.TaggedError("MsaUnavailable") {
	readonly say = "The confirmed MSA is unavailable for this recipient.";
}

/** What a reader made of stored text: the value, or that it does not read, with each field's sentence when a reader refused. */
type Read<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly errors: Readonly<Record<string, string>> | undefined;
	  };

/**
 * Reads stored text as the route read it: JSON, then the reader. A reader's refusal gives its issues, each at
 * `agreement.<path>`; anything else that fails to read (text that is not JSON, the details checked against the terms)
 * gives none. As before, any failure to read is incomplete details.
 */
function readStored<T>(read: () => T): Read<T> {
	try {
		return { ok: true, value: read() };
	} catch (error) {
		return {
			ok: false,
			errors:
				error instanceof FieldsRefused
					? Object.fromEntries(
							error.issues.map((issue) => [
								`agreement.${issue.path.join(".")}`,
								issue.message,
							]),
						)
					: undefined,
		};
	}
}

const incomplete = (read: Read<unknown>) =>
	new DetailsIncomplete({ errors: read.ok ? undefined : read.errors });

/** The offer's stored details read and checked against the terms being sent. */
export const pinDetails = alwaysWrites({
	name: "pin: the stored agreement details are complete for these terms",
	given: (
		command: { readonly terms: OfferTerms },
		facts: { readonly stored: string | null | undefined },
	): Read<AgreementDetails> =>
		readStored(() =>
			validateAgreementDetails(
				JSON.parse(facts.stored ?? "null"),
				command.terms,
			),
		),
	refusals: [
		unless(
			term(
				"the details read and match the terms",
				(read: Read<AgreementDetails>) => read.ok,
			),
			incomplete,
		),
	],
	writes: (read) => proved(read.ok ? read.value : null),
	writesText: "the details to pin",
});

/** The contractor config, as stored: its version and its values as JSON text. */
export type ContractorConfig = {
	readonly version: number;
	readonly values_json: string;
};

type TemplatesGiven = {
	readonly msa: AgreementTemplate | null;
	readonly sow: AgreementTemplate | null;
	readonly config: ContractorConfig | null;
};

/** The pinned templates and contractor config. */
export type PinnedTemplates = {
	readonly msa: AgreementTemplate;
	readonly sow: AgreementTemplate;
	readonly config: ContractorConfig;
};

/** Both templates published and a contractor config saved. */
export const pinTemplates = alwaysWrites({
	name: "pin: both templates are published and the contractor config is saved",
	given: (_request: null, facts: TemplatesGiven) => facts,
	refusals: [
		unless(
			term(
				"an MSA template, a SOW template and a contractor config exist",
				(given: TemplatesGiven) =>
					given.msa !== null && given.sow !== null && given.config !== null,
			),
			() => new TemplatesMissing(),
		),
	],
	writes: (given): PinnedTemplates => ({
		msa: proved(given.msa),
		sow: proved(given.sow),
		config: proved(given.config),
	}),
	writesText: "the templates and the config to pin",
});

/** The contractor's details, as saved in the config. */
export const pinContractor = alwaysWrites({
	name: "pin: the contractor's details read",
	given: (_request: null, facts: { readonly config: ContractorConfig }) =>
		readStored(() => parseContractor(JSON.parse(facts.config.values_json))),
	refusals: [
		unless(
			term(
				"the contractor's details read",
				(read: Read<Contractor>) => read.ok,
			),
			incomplete,
		),
	],
	writes: (read) => proved(read.ok ? read.value : null),
	writesText: "the contractor's details to pin",
});

/** The MSA the offer reuses is executed, not terminated, its archive open, its copy ready, and for the request's address. */
export const pinReusedMsa = alwaysWrites({
	name: "pin: the MSA the offer reuses is usable for this recipient",
	given: (_request: null, facts: { readonly reusable: boolean }) => facts,
	refusals: [
		unless(
			term(
				"the reused MSA is executed, current and ready for the request's address",
				(given: { readonly reusable: boolean }) => given.reusable,
			),
			() => new MsaUnavailable(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the attachments are read next",
});

/** An attachment of the details has its metadata row of this request, unchanged. */
export const attachmentRowFound = alwaysWrites({
	name: "pin: the attachment has its metadata row",
	given: (_request: null, facts: { readonly found: boolean }) => facts,
	refusals: [
		unless(
			term(
				"the attachment's metadata row has its key, digest, size, name, version and date",
				(given: { readonly found: boolean }) => given.found,
			),
			() => new DetailsIncomplete({ errors: undefined }),
		),
	],
	writes: () => ({}),
	writesText: "nothing: its object is read next",
});

type ObjectGiven = {
	readonly bytes: number;
	readonly object: { readonly size: number } | null;
};

/** The attachment's object is in R2 with the size the details give. */
export const attachmentObjectSized = alwaysWrites({
	name: "pin: the attachment's object is there with its size",
	given: (
		command: Pick<NamedAttachment, "bytes">,
		facts: { readonly object: { readonly size: number } | null },
	): ObjectGiven => ({ bytes: command.bytes, object: facts.object }),
	refusals: [
		unless(
			term(
				"the object is there and has the attachment's size",
				(given: ObjectGiven) =>
					given.object !== null && given.object.size === given.bytes,
			),
			() => new DetailsIncomplete({ errors: undefined }),
		),
	],
	writes: () => ({}),
	writesText: "nothing: its bytes are hashed next",
});

/** The attachment's bytes have the digest the details give. */
export const attachmentDigestMatches = alwaysWrites({
	name: "pin: the attachment's bytes have its digest",
	given: (
		command: Pick<NamedAttachment, "sha256">,
		facts: { readonly sha256: string },
	) => ({ expected: command.sha256, actual: facts.sha256 }),
	refusals: [
		unless(
			term(
				"the bytes have the attachment's SHA-256",
				(given: { readonly expected: string; readonly actual: string }) =>
					given.actual === given.expected,
			),
			() => new DetailsIncomplete({ errors: undefined }),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the next attachment, or the preflight, comes next",
});

/** The preflight rendered the packet (it refused nothing; a failed read in it is the flow's fixed answer). */
export const packetReady = alwaysWrites({
	name: "pin: the agreement packet renders",
	given: (_request: null, facts: { readonly ready: boolean }) => facts,
	refusals: [
		unless(
			term(
				"the preflight rendered the packet",
				(given: { readonly ready: boolean }) => given.ready,
			),
			() => new DetailsIncomplete({ errors: undefined }),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the pin is made",
});

/** What a send pins on the offer, and the attachments its batch guards (G11). */
export type Pin = {
	/** The details as JSON. */
	readonly details: string;
	readonly msa: string;
	readonly sow: string;
	/** The contractor's details with the config's version, as JSON. */
	readonly contractor: string;
	/** The request's address, trimmed and lower-cased. */
	readonly email: string;
	readonly attachments: readonly NamedAttachment[];
};

/** The pin, from what was read and checked. */
export const pinOf = alwaysWrites({
	name: "pin the agreement the offer is sent with",
	given: (
		_request: null,
		facts: {
			readonly details: AgreementDetails;
			readonly templates: PinnedTemplates;
			readonly contractor: Contractor;
			readonly email: string;
		},
	) => facts,
	refusals: [],
	writes: (given): Pin => ({
		details: JSON.stringify(given.details),
		msa: given.templates.msa.id,
		sow: given.templates.sow.id,
		contractor: JSON.stringify({
			...given.contractor,
			config_version: given.templates.config.version,
		}),
		email: given.email.trim().toLowerCase(),
		attachments: given.details.attachments,
	}),
	writesText:
		"the details, the template ids, the contractor snapshot and the address, and the attachments to guard",
});
