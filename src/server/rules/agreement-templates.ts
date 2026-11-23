// The owner's agreement templates and the contractor's details (docs/plans/2026-11-signing-conversion.md, section 2): what a
// preview answers, whether a template version is published, which stored version the owner reads, and whether the
// contractor's details are saved, each in the order POST /api/owner/agreements answers today
// (src/pages/api/owner/agreements.ts and publishTemplate in src/lib/agreement-templates.ts). The pure half stays in src/lib
// and is called, not copied: validateTemplate, renderAgreement, sampleAgreementValues, templateComparison (the line diff)
// and templateVersionLabel, so every text, label and comparison is today's byte for byte. The hash of a new version
// (hashOfferToken of the canonical text, whose Windows line endings validateTemplate made Unix ones) is computed by the
// flow with today's helper and given here, with the new id, the time and the actor.
//
// The decisions and their facts, staged where today's code reads between them, so a flow keeps today's order of reads:
//   preview: checkTemplate (the text, before any read), then previewTemplate over the kind's newest version;
//   publish: publishFront (the text and the confirmation, before any read), publishNewText over the kind's newest version
//     (the label's form, then a text the same as that version's), then publishTemplate over that version and whether the
//     label is used for the kind (each earlier refusal again, then the label in use, then the version the page expected);
//   template-version: findTemplateVersion over the version asked for, then compareTemplateVersion over the one before it;
//   config: saveContractor over the newest contractor config.
// Re-checked at write time: A22 (the publish batch's guard: the kind's newest version is still the one expected) and A23
// (the config batch's guard: the newest config version is still the one expected), each a refused guard that is not
// retried; and the unique index software_agreement_templates_label (kind, version_label), which backs LabelUsed's fact: a
// publish that loses the label to another between its read and its batch reads and decides again (three tries, through
// decideAndSave) and answers LabelUsed with today's sentence. Today only the guards check the expected version; here it is
// read first and refused by name (VersionChanged) with the answer the raised guard gives today, after every refusal that
// answers before the batch today.
import * as Data from "effect/Data";
import type { Contractor } from "../../lib/agreement-fields";
import {
	type AgreementKind,
	type AgreementTemplate,
	renderAgreement,
	sampleAgreementValues,
	templateComparison,
	templateVersionLabel,
	validateTemplate,
	versionLabelPattern,
} from "../../lib/agreement-templates";
import { ReaderMessage } from "../../lib/reader-message";
import { alwaysWrites, term, unless } from "../terms";

/** The sentence of a stale version today, the route's generic 409 ("a guard that raised"). */
export const NOT_SAVED = "The agreement could not be saved.";

/**
 * The text is not a template the site accepts, or (a preview) it does not fill with the sample values: 409 with the
 * sentence `validateTemplate` or `renderAgreement` gave, carried as `problem` (a line number or the missing fields).
 */
export class TemplateRefused extends Data.TaggedError("TemplateRefused")<{
	readonly problem: string;
}> {
	get say() {
		return this.problem;
	}
}

/** A publish without its confirmation: 400. */
export class NotConfirmed extends Data.TaggedError("NotConfirmed") {
	readonly say = "Confirm publication of a new immutable version.";
}

/** The label is not 1 to 40 letters, digits, dots and dashes: 409. The command's reader refuses such a label first today. */
export class LabelInvalid extends Data.TaggedError("LabelInvalid") {
	readonly say =
		"Use letters, digits, dots and dashes for the version label, up to 40 characters.";
}

/** The canonical text hashes to the kind's newest version: 409, naming that version's label (or `v<date>`). */
export class NothingToPublish extends Data.TaggedError("NothingToPublish")<{
	readonly label: string;
}> {
	get say() {
		return `This text matches ${this.label}. Nothing to publish.`;
	}
}

/** The label is already used for the kind, by any version: 409. */
export class LabelUsed extends Data.TaggedError("LabelUsed")<{
	readonly versionLabel: string;
	readonly kind: AgreementKind;
}> {
	get say() {
		return `${this.versionLabel} is already used for the ${this.kind.toUpperCase()}. Choose another label.`;
	}
}

/**
 * The newest version (of the template's kind, or of the contractor config) is not the one the page expected: 409 with
 * the route's generic sentence, as the raised guard (A22, A23) answers today.
 */
export class VersionChanged extends Data.TaggedError("VersionChanged") {
	readonly say = NOT_SAVED;
}

/** No stored version of the kind has the number asked for: 404. */
export class VersionNotFound extends Data.TaggedError("VersionNotFound") {
	readonly say = "That version was not found.";
}

/** A stored template version, as the store reads it (`SELECT *`). */
export type TemplateRow = AgreementTemplate;

/** What a `src/lib` template helper made of a text: its value, or the sentence of the `ReaderMessage` it threw. */
type Checked<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly problem: string };

/** Runs a template helper; a `ReaderMessage` is the owner's sentence, anything else is a fault of the site and is thrown on. */
function checked<T>(work: () => T): Checked<T> {
	try {
		return { ok: true, value: work() };
	} catch (error) {
		if (error instanceof ReaderMessage)
			return { ok: false, problem: error.message };

		throw error;
	}
}

/** The sentence a refused text carries; empty only where a refusal has already passed. */
const problemOf = (read: Checked<unknown>) => (read.ok ? "" : read.problem);

/** The value a check gave; `fallback` only where a refusal has already ruled the failure out. */
const valueOf = <T>(read: Checked<T>, fallback: T) =>
	read.ok ? read.value : fallback;

const textIsTemplate = unless(
	term(
		"the text is a template the site accepts",
		(given: { readonly text: Checked<string> }) => given.text.ok,
	),
	(given) => new TemplateRefused({ problem: problemOf(given.text) }),
);

const publishConfirmed = unless(
	term(
		"the publish is confirmed",
		(given: { readonly confirmed: boolean }) => given.confirmed,
	),
	() => new NotConfirmed(),
);

const labelHasItsForm = unless(
	term(
		"the label is 1 to 40 letters, digits, dots and dashes",
		(given: { readonly versionLabel: string }) =>
			versionLabelPattern.test(given.versionLabel),
	),
	() => new LabelInvalid(),
);

const textIsNew = unless(
	term(
		"the text does not hash to the kind's newest version",
		(given: {
			readonly sha256: string;
			readonly current: TemplateRow | null;
		}) => given.current?.sha256 !== given.sha256,
	),
	(given) =>
		new NothingToPublish({
			// SAFETY: the term fails only when a current version exists.
			label: templateVersionLabel(given.current as TemplateRow),
		}),
);

const labelIsFree = unless(
	term(
		"no version of the kind has the label",
		(given: {
			readonly labelUsed: boolean;
			readonly versionLabel: string;
			readonly kind: AgreementKind;
		}) => !given.labelUsed,
	),
	(given) =>
		new LabelUsed({ versionLabel: given.versionLabel, kind: given.kind }),
);

const newestIsExpected = unless(
	term(
		"the newest version is the one the page expected (0 for none)",
		(given: {
			readonly newestVersion: number | null;
			readonly expectedVersion: number;
		}) => (given.newestVersion ?? 0) === given.expectedVersion,
	),
	() => new VersionChanged(),
);

/** A template text to check: the kind and the text as the owner sent it. */
export type TemplateText = {
	readonly kind: AgreementKind;
	readonly text: string;
};

/** The preview's and the publish's first check, made before any read: the route's own `validateTemplate`. */
export const checkTemplate = alwaysWrites({
	name: "check a template's text before any read",
	given: (request: TemplateText, _facts: null) => ({
		text: checked(() => validateTemplate(request.kind, request.text)),
	}),
	refusals: [textIsTemplate],
	writes: (given) => valueOf(given.text, ""),
	writesText:
		"nothing: the canonical text (Unix line endings) goes on to the reads",
});

/** A preview: the text, and the label the owner typed (trimmed by the command's reader), if any. */
export type PreviewRequest = TemplateText & {
	readonly versionLabel?: string | undefined;
};

/** What a preview answers: the text filled with sample values, and its comparison with the kind's newest version. */
export type TemplatePreview = {
	readonly text: string;
	readonly compare: ReturnType<typeof templateComparison> | null;
};

type PreviewGiven = {
	readonly text: Checked<string>;
	readonly rendered: Checked<string>;
	readonly current: TemplateRow | null;
};

/**
 * A preview: the text filled with sample values (the label the owner typed in `{{msa.source_revision}}` when it has the
 * label's form, else the sample label) and compared, as canonical text, with the kind's newest version. The page's
 * expected version is not compared. A text the renderer refuses answers its sentence, as a refused text does.
 */
export const previewTemplate = alwaysWrites({
	name: "preview a template's text",
	given: (request: PreviewRequest, current: TemplateRow | null) => {
		const text = checked(() => validateTemplate(request.kind, request.text));

		const label =
			request.versionLabel && versionLabelPattern.test(request.versionLabel)
				? request.versionLabel
				: undefined;

		return {
			text,
			rendered: text.ok
				? checked(() =>
						renderAgreement(
							request.kind,
							request.text,
							sampleAgreementValues(request.kind, request.text, label),
						),
					)
				: text,
			current,
		} satisfies PreviewGiven;
	},
	refusals: [
		textIsTemplate,
		unless(
			term(
				"the text fills with the sample values",
				(given: PreviewGiven) => given.rendered.ok,
			),
			(given) => new TemplateRefused({ problem: problemOf(given.rendered) }),
		),
	],
	writes: (given): TemplatePreview => ({
		text: valueOf(given.rendered, ""),
		compare: given.current
			? templateComparison(given.current, valueOf(given.text, ""))
			: null,
	}),
	writesText: "nothing: the filled text and the comparison are the answer",
});

/** A publish as the command reads it: the label trimmed, the source revision trimmed and optional. */
export type PublishRequest = TemplateText & {
	readonly confirmed: boolean | undefined;
	readonly versionLabel: string;
	readonly sourceRevision?: string | undefined;
	readonly expectedVersion: number;
};

/** A publish with what the flow adds: the canonical text's hash (`hashOfferToken`), the new id, the time and the owner. */
export type PublishInputs = PublishRequest & {
	readonly sha256: string;
	readonly id: string;
	readonly at: string;
	readonly actor: string;
};

/** What a publish reads: the kind's newest version, and whether any version of the kind has the label. */
export type PublishFacts = {
	readonly current: TemplateRow | null;
	readonly labelUsed: boolean;
};

/** A publish's first checks, made before any read: the route's `validateTemplate`, then the confirmation. */
export const publishFront = alwaysWrites({
	name: "publish: the text and the confirmation, before any read",
	given: (request: PublishRequest, _facts: null) => ({
		text: checked(() => validateTemplate(request.kind, request.text)),
		confirmed: request.confirmed === true,
	}),
	refusals: [textIsTemplate, publishConfirmed],
	writes: (given) => valueOf(given.text, ""),
	writesText:
		"nothing: the canonical text goes on to be hashed, then to the reads",
});

/** What a publish's checks read once the kind's newest version is read; the label's use is added after its own read. */
const publishGiven = (request: PublishInputs, current: TemplateRow | null) => ({
	kind: request.kind,
	text: checked(() => validateTemplate(request.kind, request.text)),
	confirmed: request.confirmed === true,
	versionLabel: request.versionLabel,
	sourceRevision: request.sourceRevision?.trim() || null,
	sha256: request.sha256,
	current,
	newestVersion: current?.version ?? null,
	expectedVersion: request.expectedVersion,
	id: request.id,
	at: request.at,
	actor: request.actor,
});

/**
 * A publish once the kind's newest version is read: the earlier checks again, the label's form, then a text the same as
 * that version's. The flow asks it between that read and the label's, so the label is read only when the text is new.
 */
export const publishNewText = alwaysWrites({
	name: "publish: the label's form, and a text that differs from the newest version",
	given: (request: PublishInputs, current: TemplateRow | null) =>
		publishGiven(request, current),
	refusals: [textIsTemplate, publishConfirmed, labelHasItsForm, textIsNew],
	writes: () => ({}),
	writesText: "nothing: the label's use is read next",
});

/** The new version a publish writes, and what the route answers. */
export type TemplatePublication = {
	/** The row the batch inserts. */
	readonly row: {
		readonly id: string;
		readonly kind: AgreementKind;
		readonly version: number;
		readonly text: string;
		readonly sha256: string;
		readonly published_at: string;
		readonly published_by: string;
		readonly version_label: string;
		readonly source_revision: string | null;
	};
	/** A22: the batch inserts only while the kind's newest version is still this one (0 for none). */
	readonly expectedVersion: number;
	/** The event the batch writes after the row (its id is drawn as its statement is built, by `agreementEvent`). */
	readonly event: {
		readonly action: "template-published";
		readonly actor: string;
		readonly at: string;
	};
	/** The route's answer after `ok: true`, in this key order. */
	readonly answer: {
		readonly id: string;
		readonly sha256: string;
		readonly version: number;
		readonly versionLabel: string;
	};
};

/**
 * A publish: the text a template, the publish confirmed, the label's form, a text new to the kind, a label no version of
 * the kind has, and the newest version the one the page expected (A22 re-checks it in the batch, and the label's unique
 * index re-checks the label). Writes version expected + 1 with the canonical text, its hash, the time, the owner, the label
 * and the source revision (trimmed; blank is null), and the event.
 */
export const publishTemplate = alwaysWrites({
	name: "publish a new immutable template version",
	given: (request: PublishInputs, facts: PublishFacts) => ({
		...publishGiven(request, facts.current),
		labelUsed: facts.labelUsed,
	}),
	refusals: [
		textIsTemplate,
		publishConfirmed,
		labelHasItsForm,
		textIsNew,
		labelIsFree,
		newestIsExpected,
	],
	writes: (given): TemplatePublication => {
		const version = given.expectedVersion + 1;

		return {
			row: {
				id: given.id,
				kind: given.kind,
				version,
				text: valueOf(given.text, ""),
				sha256: given.sha256,
				published_at: given.at,
				published_by: given.actor,
				version_label: given.versionLabel,
				source_revision: given.sourceRevision,
			},
			expectedVersion: given.expectedVersion,
			event: { action: "template-published", actor: given.actor, at: given.at },
			answer: {
				id: given.id,
				sha256: given.sha256,
				version,
				versionLabel: given.versionLabel,
			},
		};
	},
	writesText:
		"the new version's row and its template-published event, in one batch guarded by A22",
});

/** The version the owner asks to read. */
export type TemplateVersionRequest = {
	readonly kind: AgreementKind;
	readonly version: number;
};

/** The version asked for is stored for the kind; the flow then reads the version before it, which may be missing. */
export const findTemplateVersion = alwaysWrites({
	name: "find the stored template version asked for",
	given: (_request: TemplateVersionRequest, row: TemplateRow | null) => ({
		row,
	}),
	refusals: [
		unless(
			term(
				"the kind has a stored version with that number",
				(given: { readonly row: TemplateRow | null }) => given.row !== null,
			),
			() => new VersionNotFound(),
		),
	],
	writes: (given) => {
		// SAFETY: `writes` runs only once the refusal above passed, which ruled out a missing row.
		const row = given.row as TemplateRow;

		return { row, previous: { kind: row.kind, version: row.version - 1 } };
	},
	writesText:
		"nothing: the row, and the version before it to read (its number less one)",
});

/** What the owner reads of a stored version: as stored, not validated again. */
export type TemplateVersionAnswer = {
	readonly version: number;
	readonly label: string;
	readonly text: string;
	readonly compare: ReturnType<typeof templateComparison> | null;
};

/** A stored version with its label (or `v<date>`) and its comparison with the version before it, when that one is stored. */
export const compareTemplateVersion = alwaysWrites({
	name: "show a stored template version against the one before it",
	given: (row: TemplateRow, previous: TemplateRow | null) => ({
		row,
		previous,
	}),
	refusals: [],
	writes: ({ row, previous }): TemplateVersionAnswer => ({
		version: row.version,
		label: templateVersionLabel(row),
		text: row.text,
		compare: previous ? templateComparison(previous, row.text) : null,
	}),
	writesText: "nothing: the version, its label, its text and the comparison",
});

/** The contractor's details as the command's reader gave them, with the page's version, the time and the owner. */
export type ContractorRequest = {
	readonly values: Contractor;
	readonly expectedVersion: number;
	readonly at: string;
	readonly actor: string;
};

/** The newest contractor config as stored (any row with its version), or null when none is stored. */
export type NewestContractorConfig = { readonly version: number } | null;

/** The new contractor config version a save writes. */
export type ContractorSave = {
	/** The row the batch inserts, in the table's column order. */
	readonly row: {
		readonly version: number;
		readonly values_json: string;
		readonly created_at: string;
		readonly created_by: string;
	};
	/** A23: the batch inserts only while the newest config version is still this one (0 for none). */
	readonly expectedVersion: number;
};

/**
 * Saving the contractor's details: the newest config version is the one the page expected (A23 re-checks it in the
 * batch). Writes version expected + 1 with the values as JSON (their keys in the order the reader gave them), the time and
 * the owner.
 */
export const saveContractor = alwaysWrites({
	name: "save the contractor's details as a new version",
	given: (request: ContractorRequest, newest: NewestContractorConfig) => ({
		...request,
		newestVersion: newest?.version ?? null,
	}),
	refusals: [newestIsExpected],
	writes: (given): ContractorSave => ({
		row: {
			version: given.expectedVersion + 1,
			values_json: JSON.stringify(given.values),
			created_at: given.at,
			created_by: given.actor,
		},
		expectedVersion: given.expectedVersion,
	}),
	writesText: "the new config version, in one batch guarded by A23",
});
