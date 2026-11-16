import { describe, expect, it } from "vitest";
import { validateOfferTerms } from "../../src/lib/software-offers";
import { OFFER_MOVES } from "../../src/server/machines/offer-version";
import {
	attachmentsToClean,
	chooseDraft,
	type DraftChoice,
	draftAttachments,
	namedAttachmentsOf,
	type RemovedAttachment,
	reusedMsaOf,
	type SaveDraftFacts,
	type SaveDraftRequest,
	saveDraft,
} from "../../src/server/rules/offer-draft";
import type {
	AttachmentRow,
	ClosedArchives,
} from "../../src/server/rules/software-request";
import {
	attachment,
	inOrder,
	NOW,
	offer,
	offerTerms,
	outcome,
	refusalFacts,
	run,
	softwareRequest,
	wrote,
} from "../helpers/offer-rules";

// The draft's rules (docs/plans/2026-11-offers-conversion.md, section 2, "draft"), stage by stage: the version it saves
// (TermsInvalid, DraftChanged), the attachments the details name (AttachmentsUnreadable), then what only the batch
// checked before (AttachmentNotUsable, MsaNotFound), and what its batch writes.

const valid = validateOfferTerms(offerTerms);

describe("choosing the version a draft saves", () => {
	const choose = (s: {
		terms: ReturnType<typeof validateOfferTerms>;
		expected: string | null;
		offers: ReturnType<typeof offer>[];
	}) =>
		run(
			chooseDraft.decide(
				{ terms: s.terms, expectedUpdatedAt: s.expected, now: NOW },
				{ offers: s.offers },
			),
		);

	it("refuses terms that do not read, then a page that saved over another draft", () => {
		const open = offer({
			status: "draft",
			updated_at: "2026-11-15T09:30:00.000Z",
		});

		expect(
			inOrder(
				{
					terms: validateOfferTerms({ ...offerTerms, outcome: "" }),
					expected: "2026-11-15T09:00:00.000Z",
					offers: [open],
				},
				choose,
				[
					(s) => ({ ...s, terms: valid }),
					(s) => ({ ...s, expected: open.updated_at }),
				],
			),
		).toEqual(["TermsInvalid", "DraftChanged", "writes"]);
	});

	it("carries the terms' errors and the open draft's updated_at in its refusals", () => {
		const invalid = validateOfferTerms({ ...offerTerms, outcome: "" });

		expect(
			refusalFacts(choose({ terms: invalid, expected: null, offers: [] })),
		).toEqual({
			refused: "TermsInvalid",
			errors: invalid.ok ? {} : invalid.errors,
		});
		expect(
			refusalFacts(choose({ terms: valid, expected: "x", offers: [] })),
		).toEqual({ refused: "DraftChanged", updatedAt: null });
		expect(
			refusalFacts(
				choose({
					terms: valid,
					expected: null,
					offers: [offer({ updated_at: "2026-11-15T09:30:00.000Z" })],
				}),
			),
		).toEqual({
			refused: "DraftChanged",
			updatedAt: "2026-11-15T09:30:00.000Z",
		});
	});

	it("numbers a new version after the newest of any status, as the route did from the offers read newest first", () => {
		const offers = [
			offer({ id: "o3", version: 3, status: "withdrawn" }),
			offer({ id: "o2", version: 2, status: "superseded" }),
			offer({ id: "o1", version: 1, status: "superseded" }),
		];

		for (const listed of [offers, [], offers.slice(1)]) {
			const choice = wrote(
				choose({ terms: valid, expected: null, offers: listed }),
			);

			// The route: draft?.version ?? (offers[0]?.version ?? 0) + 1, with the offers read newest first.
			expect(choice.version).toBe((listed[0]?.version ?? 0) + 1);
			expect(choice.open).toBeNull();
			expect(choice.at).toBe(NOW);
		}
	});

	it("updates the open draft, by the machine's SAVE, at one millisecond past its updated_at when that is not earlier", () => {
		const open = offer({
			id: "o2",
			version: 2,
			status: "draft",
			updated_at: "2026-11-15T12:00:03.000Z",
		});

		expect(
			wrote(
				choose({
					terms: valid,
					expected: open.updated_at,
					offers: [open, offer({ id: "o1", version: 1, status: "sent" })],
				}),
			),
		).toEqual({
			open: { id: "o2", updatedAt: "2026-11-15T12:00:03.000Z" },
			version: 2,
			termsJson: JSON.stringify(valid.ok && valid.value),
			at: "2026-11-15T12:00:03.001Z",
		});
	});
});

describe("the attachments the details name", () => {
	it("reads none for no details and for details that are null, and a list of up to five", () => {
		expect(namedAttachmentsOf(undefined)).toBeNull();
		expect(namedAttachmentsOf(null)).toBeNull();
		expect(namedAttachmentsOf({})).toEqual({ ok: true, attachments: [] });
		expect(namedAttachmentsOf(5)).toEqual({ ok: true, attachments: [] });
		expect(namedAttachmentsOf("text")).toEqual({ ok: true, attachments: [] });
		expect(namedAttachmentsOf([attachment])).toEqual({
			ok: true,
			attachments: [],
		});
		expect(namedAttachmentsOf({ attachments: [attachment] })).toEqual({
			ok: true,
			attachments: [attachment],
		});
	});

	it("refuses attachments that are not a list, malformed, or more than five", () => {
		for (const attachments of [
			"x",
			[{ ...attachment, key: "other/key.pdf" }],
			Array.from({ length: 6 }, () => attachment),
		]) {
			const named = namedAttachmentsOf({ attachments });

			expect(named).toEqual({ ok: false });
			expect(outcome(run(draftAttachments.decide(null, { named })))).toBe(
				"AttachmentsUnreadable",
			);
		}

		expect(wrote(run(draftAttachments.decide(null, { named: null })))).toEqual(
			[],
		);
	});
});

describe("saving the draft", () => {
	const row: AttachmentRow = {
		object_key: attachment.key,
		sha256: attachment.sha256,
		bytes: attachment.bytes,
		filename: attachment.filename,
		version: attachment.version,
		document_date: attachment.date,
	};

	const choice: DraftChoice = {
		open: null,
		version: 1,
		termsJson: "{}",
		at: NOW,
	};

	/** No closed archive names a key, and every one reads. */
	const noneClosed: ClosedArchives = { keys: [], unreadable: false };

	const facts = (over: Partial<SaveDraftFacts> = {}): SaveDraftFacts => ({
		request: softwareRequest(),
		chosen: choice,
		attachments: [attachment],
		named: { rows: [row], closed: noneClosed },
		removed: [],
		reusedMsaFound: null,
		...over,
	});

	const command = (over: Partial<SaveDraftRequest> = {}): SaveDraftRequest => ({
		id: "new-id",
		actor: "owner@example.test",
		agreementDetails: { attachments: [attachment] },
		...over,
	});

	const save = (c: SaveDraftRequest, f: SaveDraftFacts) =>
		run(saveDraft.decide(c, f));

	it("refuses an attachment the batch's guard refused, then an MSA that is gone", () => {
		expect(
			inOrder(
				{
					c: command({
						reusedMsaId: "123e4567-e89b-42d3-a456-426614174000",
						confirmMsaReuse: true,
					}),
					f: facts({
						named: { rows: [], closed: noneClosed },
						reusedMsaFound: false,
					}),
				},
				(s) => save(s.c, s.f),
				[
					(s) => ({
						...s,
						f: { ...s.f, named: { rows: [row], closed: noneClosed } },
					}),
					(s) => ({ ...s, f: { ...s.f, reusedMsaFound: true } }),
				],
			),
		).toEqual(["AttachmentNotUsable", "MsaNotFound", "writes"]);
	});

	it("refuses a named attachment whose row differs in any column G11 compares, or that is in a closed archive", () => {
		for (const changed of [
			{ sha256: "b".repeat(64) },
			{ bytes: 99 },
			{ filename: "Other.pdf" },
			{ version: "v3" },
			{ document_date: "2026-10-02" },
			{ object_key: "agreements/attachments/other.pdf" },
		])
			expect(
				outcome(
					save(
						command(),
						facts({
							named: { rows: [{ ...row, ...changed }], closed: noneClosed },
						}),
					),
				),
			).toBe("AttachmentNotUsable");

		expect(
			outcome(
				save(
					command(),
					facts({
						named: {
							rows: [row],
							closed: { keys: [attachment.key], unreadable: false },
						},
					}),
				),
			),
		).toBe("AttachmentNotUsable");
	});

	it("refuses a named attachment while a closed archive does not read, as G11's malformed JSON refuses the batch, and checks nothing with none named", () => {
		const unreadable = {
			rows: [row],
			closed: { keys: [], unreadable: true },
		};

		expect(outcome(save(command(), facts({ named: unreadable })))).toBe(
			"AttachmentNotUsable",
		);

		for (const agreementDetails of [undefined, null, { attachments: [] }])
			expect(
				outcome(
					save(
						command({ agreementDetails }),
						facts({ attachments: [], named: unreadable }),
					),
				),
			).toBe("writes");
	});

	it("checks the reused MSA only when the draft confirms one", () => {
		expect(reusedMsaOf({ reusedMsaId: "m", confirmMsaReuse: true })).toBe("m");
		expect(
			reusedMsaOf({ reusedMsaId: "m", confirmMsaReuse: false }),
		).toBeNull();
		expect(reusedMsaOf({ reusedMsaId: "m" })).toBeNull();
		expect(reusedMsaOf({ confirmMsaReuse: true })).toBeNull();
		expect(
			outcome(
				save(command({ reusedMsaId: "m", confirmMsaReuse: false }), facts()),
			),
		).toBe("writes");
	});

	it("inserts a new version, or updates the open draft by the machine's SAVE", () => {
		expect(wrote(save(command(), facts())).save).toEqual({
			kind: "insert",
			version: 1,
		});
		expect(
			wrote(
				save(
					command({ id: "o2" }),
					facts({
						chosen: {
							...choice,
							version: 2,
							open: { id: "o2", updatedAt: "2026-11-15T09:30:00.000Z" },
						},
					}),
				),
			).save,
		).toEqual({
			kind: "update",
			expectedUpdatedAt: "2026-11-15T09:30:00.000Z",
			move: OFFER_MOVES.SAVE,
		});
	});

	it("sets, clears or leaves the details and the reused MSA as the command says", () => {
		const details = { attachments: [attachment] };

		expect(
			wrote(save(command({ agreementDetails: details }), facts())),
		).toMatchObject({
			details: { json: JSON.stringify(details) },
			reusedMsa: null,
		});
		expect(
			wrote(
				save(command({ agreementDetails: null }), facts({ attachments: [] })),
			).details,
		).toEqual({ json: null });
		expect(
			wrote(
				save(
					command({ agreementDetails: undefined }),
					facts({ attachments: [] }),
				),
			).details,
		).toBeNull();
		expect(
			wrote(
				save(
					command({ reusedMsaId: "m", confirmMsaReuse: true }),
					facts({ reusedMsaFound: true }),
				),
			).reusedMsa,
		).toEqual({ id: "m" });
		expect(
			wrote(
				save(command({ reusedMsaId: "m", confirmMsaReuse: false }), facts()),
			).reusedMsa,
		).toEqual({ id: null });
	});

	it("writes the request as read, the attachments to guard, the removed rows and the audit", () => {
		const removed: RemovedAttachment = {
			id: "f1",
			request_id: "r1",
			filename: "Old.pdf",
			version: "v1",
			document_date: "2026-09-01",
			object_key: "agreements/attachments/old.pdf",
			sha256: "c".repeat(64),
			bytes: 5,
			created_at: NOW,
			created_by: "owner@example.test",
		};

		expect(wrote(save(command(), facts({ removed: [removed] })))).toMatchObject(
			{
				request: { id: "r1", status: "new", email: "ada@example.test" },
				at: NOW,
				id: "new-id",
				version: 1,
				attachments: [attachment],
				removed: [removed],
				audit: "offer-draft-saved",
			},
		);
	});
});

describe("cleaning up after the batch", () => {
	it("removes from R2 only the rows the batch's delete returned", () => {
		const rows = ["a", "b", "c"].map((key) => ({
			id: key,
			request_id: "r1",
			filename: `${key}.pdf`,
			version: "v1",
			document_date: "2026-09-01",
			object_key: `agreements/attachments/${key}.pdf`,
			sha256: "c".repeat(64),
			bytes: 5,
			created_at: NOW,
			created_by: "owner@example.test",
		}));

		expect(
			wrote(
				run(
					attachmentsToClean.decide(null, {
						removed: rows,
						deletedKeys: [
							"agreements/attachments/c.pdf",
							"agreements/attachments/a.pdf",
						],
					}),
				),
			).map((row) => row.id),
		).toEqual(["a", "c"]);
	});
});
