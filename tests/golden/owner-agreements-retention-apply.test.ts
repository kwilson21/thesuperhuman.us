import type { JsonObject, JsonValue } from "../helpers/json";
import { isObject } from "~/lib/type-guards";
import { POST } from "~/pages/api/owner/agreements";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	act,
	agreementTables,
	applying,
	AGREEMENTS,
	attachmentKey,
	attachmentRow,
	DAY,
	detailsJson,
	evidenceOf,
	form,
	manifestJson,
	manifestOf,
	many,
	MARKER,
	merge,
	msaAgreement,
	objectsOf,
	one,
	PDF,
	PDF_SHA,
	projectSql,
	retentionEnv,
	RETENTION_DUMP,
	run,
	sowScene,
	sql,
	THIRTY_DAYS,
	world,
	EARLIER,
	FORM_HEADERS,
	LONG_AGO,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "retention-apply". It DELETES stored agreement files and rows,
// so it is covered exhaustively: a manifest from a preview is sent back (step 0 previews, step 1 applies) and then
// changed, aged, tampered with, or applied after the database changed under it.
//
// Every response branch of the handler and of applyAgreementRetention / previewAgreementRetention
// (src/lib/agreement-retention.ts), and its cases:
//
//   200 {ok:true} (native form: 303 to /owner/agreements)   a SOW, an MSA, a terminated signed MSA, an abandoned SOW, two
//                                                           agreements, an agreement with an attachment, a shared attachment,
//                                                           unattached attachments (with and without the stored object),
//                                                           orphans, all three kinds together, the empty archive (marker put
//                                                           with etagDoesNotMatch, then with etagMatches), a manifest exactly
//                                                           24 hours old, orphan_attachments left out, a repeated empty apply
//   400 "Check required fields and limits."                 confirmed missing, false, "true", 1; a form without confirmed
//   400 "Invalid fields" (form, manifest text is not JSON)
//   403 / 503                                               a visitor, a client; no binding id
//   409 {ok:false, error: <message>}                        every throw, with the message the route shows today:
//     "Review is stale or belongs to different storage."    version, binding, created_at (invalid, future, 24h and 1ms old),
//                                                           more than 20 agreements, 100 unattached, 100 orphans, a cursor
//                                                           that is empty, over 4096 or not text, unattached or orphans not arrays
//     "Archive changed. Preview again."                     any difference from a fresh scan (sha, objects, extra, row_hash,
//                                                           unattached, orphans), a hold, a later retain_until, a rendering
//                                                           artifact, a live project, a repeated apply, unattached metadata gone
//     "Project changed..." sqlite error                     a race inside the closing batch (hold, project evidence)
//     "Object changed." after the file closed               an attachment whose recorded digest is not its bytes
//     "Unattached PDF changed." / R2 delete refused         metadata digest differs; R2 delete fails (metadata put back)
//     TypeError text                                        manifest missing, null, a string, a number, agreements missing
//     partial failure                                       closing batch fails (nothing changed), receipts batch fails (file
//                                                           closed and objects deleted, rows kept), the clients delete fails,
//                                                           the second agreement fails after the first completed, R2 delete fails
//   marker                                                  put only when the saved cursor equals the manifest's

const preview = (extra: Partial<Step> = {}) =>
	act({ action: "retention-preview" }, extra);

/** Sends the preview's manifest back, after `change`. */
const apply = (
	change: (manifest: JsonObject) => JsonValue | undefined = (manifest) =>
		manifest,
	extra: Partial<Step> = {},
	from = 0,
) => act((prior) => applying(change(manifestOf(prior, from))), extra);

const formApply = (
	change: (manifest: JsonObject) => JsonValue = (m) => m,
): Step => ({
	as: asOwner(),
	path: AGREEMENTS,
	body: (prior) =>
		new URLSearchParams({
			action: "retention-apply",
			confirmed: "true",
			manifest: JSON.stringify(change(manifestOf(prior))),
		}).toString(),
	headers: FORM_HEADERS,
});

const sequence = (
	name: string,
	scene: Partial<Case>,
	change?: (m: JsonObject) => JsonValue | undefined,
	extra: Partial<Case> = {},
	applyExtra: Partial<Step> = {},
): Case => ({
	name,
	...scene,
	steps: [preview(), apply(change, applyExtra)],
	final: RETENTION_DUMP,
	...extra,
});

const with1 = (
	seed: Seed = {},
	r2: { [key: string]: { body: string | Uint8Array } } = {},
) =>
	world({ seed: merge(sowScene(1), seed), r2: { ...objectsOf("a1"), ...r2 } });

const withAttachment = (key = "att1", sha = PDF_SHA): Partial<Case> => ({
	music: {
		seed: merge(
			agreementTables(),
			sowScene(1, {
				agreement: {
					attachment_manifest_json: manifestJson({
						key: attachmentKey(key),
						sha256: sha,
					}),
				},
			}),
			{
				software_agreement_attachments: [
					attachmentRow(key, "r1", { created_at: EARLIER }),
				],
			},
		),
	},
	r2: { seed: { ...objectsOf("a1"), [attachmentKey(key)]: { body: PDF } } },
	env: retentionEnv,
});

const unattached = (
	extra: Seed = {},
	r2: { [key: string]: { body: string | Uint8Array } } = {
		[attachmentKey("u1")]: { body: PDF },
	},
): Partial<Case> =>
	world({
		seed: merge(
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [attachmentRow("u1", "r1")],
			},
			extra,
		),
		r2,
	});

const orphan = (): Partial<Case> =>
	world({ r2: { [attachmentKey("lost")]: { body: PDF } } });

const aged = { advanceMs: THIRTY_DAYS + 1 };

const stale = (m: JsonObject) => ({ ...m, version: 2 });

const asEntry = (m: JsonObject): JsonObject => {
	const [first] = Array.isArray(m.agreements) ? m.agreements : [];

	return isObject(first) && !Array.isArray(first) ? first : {};
};

const cases: Case[] = [
	// applied
	sequence(
		"a SOW is retired with its objects and rows",
		with1(evidenceOf("a1")),
	),
	sequence(
		"an MSA without signatures is retired",
		world({
			seed: { software_agreements: [msaAgreement("m1")] },
			r2: objectsOf("m1"),
		}),
	),
	sequence(
		"a terminated signed MSA is retired",
		world({
			seed: merge(
				{
					software_agreements: [
						msaAgreement("m1", { terminated_at: "2026-11-01T00:00:00.000Z" }),
					],
				},
				evidenceOf("m1"),
			),
			r2: objectsOf("m1"),
		}),
	),
	sequence(
		"an abandoned SOW is retired",
		world({
			seed: sowScene(1, {
				agreement: {
					status: "abandoned",
					abandoned_at: "2026-11-01T00:00:00.000Z",
				},
			}),
			r2: objectsOf("a1"),
		}),
	),
	sequence(
		"two agreements are retired one after the other",
		world({
			seed: merge(sowScene(1), sowScene(2), evidenceOf("a1"), evidenceOf("a2")),
			r2: { ...objectsOf("a1"), ...objectsOf("a2") },
		}),
	),
	sequence(
		"an agreement with an attachment is retired with it",
		withAttachment(),
	),
	sequence(
		"an attachment shared by two retiring agreements is deleted with the last",
		{
			music: {
				seed: merge(
					agreementTables(),
					sowScene(1, {
						agreement: {
							attachment_manifest_json: manifestJson({
								key: attachmentKey("att1"),
								sha256: PDF_SHA,
							}),
						},
					}),
					sowScene(2, {
						agreement: {
							attachment_manifest_json: manifestJson({
								key: attachmentKey("att1"),
								sha256: PDF_SHA,
							}),
						},
					}),
					{
						software_agreement_attachments: [
							attachmentRow("att1", "r1", { created_at: EARLIER }),
						],
					},
				),
			},
			r2: {
				seed: {
					...objectsOf("a1"),
					...objectsOf("a2"),
					[attachmentKey("att1")]: { body: PDF },
				},
			},
			env: retentionEnv,
		},
	),
	sequence("an unattached attachment is deleted with its object", unattached()),
	sequence(
		"an unattached attachment whose object is gone loses only its row",
		unattached({}, {}),
	),
	{
		name: "an orphan object is deleted",
		...orphan(),
		steps: [preview(aged), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "agreements, unattached attachments and orphans together",
		...world({
			seed: merge(sowScene(1), {
				software_agreement_attachments: [attachmentRow("u1", "r1")],
			}),
			r2: {
				...objectsOf("a1"),
				[attachmentKey("u1")]: { body: PDF },
				[attachmentKey("lost")]: { body: PDF },
			},
		}),
		steps: [preview(aged), apply()],
		final: RETENTION_DUMP,
	},
	sequence(
		"an empty archive records the marker with etagDoesNotMatch",
		world(),
	),
	sequence(
		"an empty archive with a marker records it with etagMatches",
		world({
			r2: { [MARKER]: { body: JSON.stringify({ version: 1, cursor: null }) } },
		}),
	),
	{
		name: "an empty apply twice is accepted twice",
		...world(),
		steps: [preview(), apply(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the same manifest cannot be applied twice",
		...with1(),
		steps: [preview(), apply(), apply()],
		final: RETENTION_DUMP,
	},
	sequence(
		"a manifest exactly 24 hours old is accepted",
		with1(),
		undefined,
		{},
		{ advanceMs: DAY },
	),
	sequence(
		"a manifest 24 hours and a millisecond old is stale",
		with1(),
		undefined,
		{},
		{ advanceMs: DAY + 1 },
	),
	sequence("a manifest from the future is stale", with1(), (m) => ({
		...m,
		created_at: "2026-11-13T13:00:00.000Z",
	})),
	sequence("a created_at that is not a date is stale", with1(), (m) => ({
		...m,
		created_at: "nope",
	})),
	sequence(
		"a manifest without orphan_attachments is accepted",
		with1(),
		(m) => ({ ...m, orphan_attachments: undefined }),
	),
	{
		name: "a native form applies and answers a redirect",
		...with1(),
		steps: [preview(), formApply()],
		final: RETENTION_DUMP,
	},

	// the body
	sequence("confirmed missing", with1(), undefined, {
		steps: [
			preview(),
			act((prior) => ({
				action: "retention-apply",
				manifest: manifestOf(prior),
			})),
		],
	}),
	sequence("confirmed false", with1(), undefined, {
		steps: [
			preview(),
			act((prior) => ({
				action: "retention-apply",
				confirmed: false,
				manifest: manifestOf(prior),
			})),
		],
	}),
	sequence("confirmed as the text true", with1(), undefined, {
		steps: [
			preview(),
			act((prior) => ({
				action: "retention-apply",
				confirmed: "true",
				manifest: manifestOf(prior),
			})),
		],
	}),
	sequence("confirmed as the number one", with1(), undefined, {
		steps: [
			preview(),
			act((prior) => ({
				action: "retention-apply",
				confirmed: 1,
				manifest: manifestOf(prior),
			})),
		],
	}),
	{
		name: "a manifest left out",
		...with1(),
		steps: [act({ action: "retention-apply", confirmed: true })],
		final: RETENTION_DUMP,
	},
	{
		name: "a null manifest",
		...with1(),
		steps: [
			act({ action: "retention-apply", confirmed: true, manifest: null }),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "a manifest that is text",
		...with1(),
		steps: [act(applying("manifest"))],
		final: RETENTION_DUMP,
	},
	{
		name: "a manifest that is a number",
		...with1(),
		steps: [act(applying(7))],
		final: RETENTION_DUMP,
	},
	{
		name: "a manifest that is an array",
		...with1(),
		steps: [act(applying([]))],
		final: RETENTION_DUMP,
	},
	{
		name: "an empty object manifest",
		...with1(),
		steps: [act(applying({}))],
		final: RETENTION_DUMP,
	},
	{
		name: "a manifest with only a version and binding and created_at",
		...with1(),
		steps: [
			act(
				applying({
					version: 1,
					binding: "AUDIO:superhuman-audio",
					created_at: "2026-11-13T12:00:00.000Z",
				}),
			),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "a visitor cannot apply",
		...with1(),
		steps: [preview(), apply(undefined, { as: asVisitor() })],
		final: RETENTION_DUMP,
	},
	{
		name: "a forged client cookie cannot apply",
		...with1(),
		steps: [
			preview(),
			apply(undefined, { as: asClientCookie("a".repeat(72)) }),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "a native form whose manifest is stale redirects nowhere",
		...with1(),
		steps: [preview(), formApply(stale)],
		final: RETENTION_DUMP,
	},
	{ name: "no binding id", ...with1(), env: {}, steps: [act(applying({}))] },
	{
		name: "no bucket",
		...with1(),
		r2: { missing: true },
		steps: [act(applying({}))],
	},
	{
		name: "a form with invalid manifest text",
		...with1(),
		steps: [
			form({ action: "retention-apply", confirmed: "true", manifest: "{nope" }),
		],
	},
	{
		name: "a form without confirmed",
		...with1(),
		steps: [form({ action: "retention-apply", manifest: "{}" })],
	},
	{
		name: "a form whose manifest is stale",
		...with1(),
		steps: [
			form({
				action: "retention-apply",
				confirmed: "on",
				manifest: '{"version":1}',
			}),
		],
	},

	// manifest validity
	sequence("version 2", with1(), stale),
	sequence("another binding", with1(), (m) => ({
		...m,
		binding: "AUDIO:other",
	})),
	sequence("twenty-one agreements", with1(), (m) => ({
		...m,
		agreements: Array.from({ length: 21 }, () => asEntry(m)),
	})),
	sequence("agreements left out", with1(), (m) => ({
		...m,
		agreements: undefined,
	})),
	sequence("unattached_attachments not an array", with1(), (m) => ({
		...m,
		unattached_attachments: "x",
	})),
	sequence("a hundred and one unattached attachments", with1(), (m) => ({
		...m,
		unattached_attachments: Array.from({ length: 101 }, () => ({})),
	})),
	sequence("orphan_attachments not an array", with1(), (m) => ({
		...m,
		orphan_attachments: {},
	})),
	sequence("a hundred and one orphans", with1(), (m) => ({
		...m,
		orphan_attachments: Array.from({ length: 101 }, () => ({})),
	})),
	sequence("a cursor that is not text", with1(), (m) => ({
		...m,
		orphan_scan_cursor: 5,
	})),
	sequence("an empty cursor", with1(), (m) => ({
		...m,
		orphan_scan_cursor: "",
	})),
	sequence("a cursor over 4096 characters", with1(), (m) => ({
		...m,
		orphan_scan_cursor: "z".repeat(4097),
	})),
	sequence(
		"a cursor after every key leaves the marker alone",
		with1(),
		(m) => ({ ...m, orphan_scan_cursor: "agreements/attachments/zzz" }),
	),

	// differences from a fresh scan
	sequence("an agreement digest changed", with1(), (m) => ({
		...m,
		agreements: [{ ...asEntry(m), sha256: "f".repeat(64) }],
	})),
	sequence("an object added to the agreement", with1(), (m) => ({
		...m,
		agreements: [
			{
				...asEntry(m),
				objects: [{ key: "agreements/a1/extra.pdf", sha256: PDF_SHA }],
			},
		],
	})),
	sequence("the objects removed from the agreement", with1(), (m) => ({
		...m,
		agreements: [{ ...asEntry(m), objects: [] }],
	})),
	sequence("an extra agreement", with1(), (m) => ({
		...m,
		agreements: [asEntry(m), { ...asEntry(m), id: "a9" }],
	})),
	sequence("the row hash changed", with1(), (m) => ({
		...m,
		agreements: [{ ...asEntry(m), row_hash: "0" }],
	})),
	sequence("an unattached attachment added", with1(), (m) => ({
		...m,
		unattached_attachments: [
			{ id: "x", key: "k", sha256: PDF_SHA, created_at: EARLIER },
		],
	})),
	sequence("an orphan added", with1(), (m) => ({
		...m,
		orphan_attachments: [
			{ key: attachmentKey("x"), sha256: PDF_SHA, uploaded_at: LONG_AGO },
		],
	})),

	// the database changes after the preview
	{
		name: "a hold placed after the preview",
		...with1(),
		steps: [
			preview(),
			apply(undefined, {
				before: {
					label: "a legal hold is placed",
					run: sql("UPDATE software_agreements SET legal_hold=1 WHERE id='a1'"),
				},
			}),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "retain_until moved after the preview",
		...with1(),
		steps: [
			preview(),
			apply(undefined, {
				before: {
					label: "retain_until is moved a year out",
					run: sql(
						"UPDATE software_agreements SET retain_until='2027-11-13T00:00:00.000Z' WHERE id='a1'",
					),
				},
			}),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "an artifact starts rendering after the preview",
		...with1(evidenceOf("a1")),
		steps: [
			preview(),
			apply(undefined, {
				before: {
					label: "the artifact is rendering again",
					run: sql(
						"UPDATE software_agreement_artifacts SET status='rendering' WHERE agreement_id='a1'",
					),
				},
			}),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "a project starts on the offer after the preview",
		...with1(),
		steps: [
			preview(),
			apply(undefined, {
				before: { label: "a project starts", run: sql(projectSql("r1", "o1")) },
			}),
		],
		final: RETENTION_DUMP,
	},
	{
		name: "the agreement is gone after the preview",
		...with1(),
		steps: [
			preview(),
			apply(undefined, {
				before: {
					label: "another process deleted the agreement",
					run: sql("DELETE FROM software_agreements WHERE id='a1'"),
				},
			}),
		],
		final: RETENTION_DUMP,
	},

	// races inside the batches
	{
		name: "a hold lands just before the closing batch",
		...with1(),
		interleave: [
			{
				on: /SET archive_closed_at/,
				label: "a legal hold lands",
				run: run("UPDATE software_agreements SET legal_hold=1 WHERE id='a1'"),
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "a project appears just before the closing batch",
		...with1(),
		interleave: [
			{
				on: /SET archive_closed_at/,
				label: "a project starts",
				run: run(
					projectSql("r1", "o1", ",external_signature_details_json", ",'{}'"),
				),
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "an artifact starts rendering just before the receipts batch",
		...with1(evidenceOf("a1")),
		interleave: [
			{
				on: /INSERT INTO software_agreement_retention_receipts/,
				label: "the artifact is rendering",
				run: run(
					"UPDATE software_agreement_artifacts SET status='rendering' WHERE agreement_id='a1'",
				),
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the second agreement fails after the first completed",
		...world({
			seed: merge(sowScene(1), sowScene(2), evidenceOf("a1"), evidenceOf("a2")),
			r2: { ...objectsOf("a1"), ...objectsOf("a2") },
		}),
		failures: [
			{
				on: /INSERT INTO software_agreement_retention_receipts/,
				nth: 2,
				message: "d1 down",
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the closing batch fails and nothing changes",
		...with1(evidenceOf("a1")),
		failures: [{ on: /SET archive_closed_at/, message: "d1 down" }],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the receipts batch fails after the objects were deleted",
		...with1(evidenceOf("a1")),
		failures: [
			{
				on: /INSERT INTO software_agreement_retention_receipts/,
				message: "d1 down",
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "a retry after the receipts batch failed completes the retirement",
		...with1(evidenceOf("a1")),
		failures: [
			{
				on: /INSERT INTO software_agreement_retention_receipts/,
				message: "d1 down",
			},
		],
		steps: [preview(), apply(), preview(), apply(undefined, {}, 2)],
		final: RETENTION_DUMP,
	},
	{
		name: "the clients delete fails after the rows were removed",
		...with1(evidenceOf("a1")),
		failures: [
			{ on: /DELETE FROM software_agreement_clients/, message: "d1 down" },
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the bucket refuses to delete an object",
		...with1(evidenceOf("a1")),
		r2: { seed: objectsOf("a1"), fails: ["delete"] },
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the fresh scan during apply fails",
		...with1(),
		failures: [
			{
				on: /SELECT a\.\* FROM software_agreements a/,
				nth: 2,
				message: "d1 down",
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "an attachment whose recorded digest is not its bytes",
		...withAttachment("att1", "a".repeat(64)),
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},

	// unattached attachments and orphans
	{
		name: "the unattached metadata digest differs from the stored bytes",
		...unattached({}, { [attachmentKey("u1")]: { body: "not the pdf" } }),
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the unattached metadata disappears before it is read",
		...unattached(),
		interleave: [
			{
				on: /SELECT id,request_id,filename/,
				label: "the row is deleted",
				run: run("DELETE FROM software_agreement_attachments WHERE id='u1'"),
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "an offer pins the unattached attachment before the delete batch",
		...unattached({
			software_offers: [
				rows.softwareOffer("o1", "r1", { status: "superseded" }),
			],
		}),
		interleave: [
			{
				on: /DELETE FROM software_agreement_attachments WHERE id=\?/,
				label: "an offer is sent with the attachment",
				run: run(
					`UPDATE software_offers SET status='sent',agreement_details_json='${detailsJson(attachmentKey("u1"))}' WHERE id='o1'`,
				),
			},
		],
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the bucket refuses to delete an unattached object",
		...unattached(),
		r2: { seed: { [attachmentKey("u1")]: { body: PDF } }, fails: ["delete"] },
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "metadata appears for an orphan before its guard",
		...orphan(),
		interleave: [
			{
				on: /SELECT CASE WHEN EXISTS\(SELECT 1 WHERE/,
				label: "an upload row is recorded",
				run: run(
					`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r1','software','Grace','grace@example.test','x','new','${EARLIER}','${EARLIER}'); INSERT INTO software_agreement_attachments VALUES('lost','r1','l.pdf','1','2026-10-01','${attachmentKey("lost")}','${PDF_SHA}',${PDF.byteLength},'${EARLIER}','owner@example.test')`,
				),
			},
		],
		steps: [preview(aged), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "the marker write fails after an orphan was deleted",
		...orphan(),
		r2: { seed: { [attachmentKey("lost")]: { body: PDF } }, fails: ["put"] },
		steps: [preview(aged), apply()],
		final: RETENTION_DUMP,
	},
	{
		name: "many agreements apply in id order",
		...world({
			seed: many(3),
			r2: { ...objectsOf("a001"), ...objectsOf("a002"), ...objectsOf("a003") },
		}),
		steps: [preview(), apply()],
		final: RETENTION_DUMP,
	},
];

defineCorpus("owner-agreements-retention-apply", POST, cases);
