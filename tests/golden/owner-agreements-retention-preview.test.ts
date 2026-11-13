import { POST } from "~/pages/api/owner/agreements";
import {
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
} from "./harness";
import {
	act,
	attachmentKey,
	attachmentRow,
	many,
	one,
	pinned,
	type Scene,
	world,
	evidenceOf,
	form,
	manifestJson,
	merge,
	msaAgreement,
	objectsOf,
	PDF,
	PDF_SHA,
	raw,
	RETENTION_DUMP,
	run,
	sowScene,
	THIRTY_DAYS,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, action "retention-preview": the owner asks which retired agreements
// and stored PDFs may be deleted. It reads, lists and hashes private storage and writes only the orphan-scan marker.
//
// Every response branch of the handler (src/pages/api/owner/agreements.ts), agreementRequest and
// previewAgreementRetention (src/lib/agreement-retention.ts), and its cases:
//
//   403 {ok:false}                               a visitor, a signed-in client is not the owner (the cases of the wire file add more)
//   503 "Retention storage identity is not configured."   no AUDIO bucket, no binding id, an empty id, neither
//   200 {ok:true, manifest}                      empty archive (marker written), every eligible and ineligible agreement shape,
//                                                objects, attachments, unattached attachments, orphans, markers
//   409 {ok:false, error: <message>}             any throw: a database or bucket outage, a malformed stored manifest
//   eligibility (the `eligible` SQL)             status executed or abandoned, ended_at, retain_until (at the instant, one
//                                                millisecond after), legal hold, rendering artifact, sending delivery or
//                                                notification, a live project of the agreement or its offer, a reusing offer
//                                                (live project, an SOW, sent, draft, superseded, project deleted), a linked SOW,
//                                                a signed MSA that is not terminated, the limit of 20 in id order
//   objects                                      the agreement's prefix only, an attachment shared with a kept agreement, pinned by
//                                                an active offer, shared by two retiring agreements (given to the last one)
//   unattached attachments                       old, young, at the 30 day boundary, referenced, pinned, the limit of 100
//   orphan attachments                           old objects nothing references, young, boundary, referenced three ways, the limit of
//                                                100 with a next cursor, a saved cursor (valid, unreadable, version 2, empty, too long)
//   wire                                         the same JSON answer for a native form post; extra fields are ignored

const owner = (extra = {}) => act({ action: "retention-preview" }, extra);

const eligibleCase = (
	name: string,
	over: SeedRow,
	extra: Scene = {},
): Case => ({
	name,
	...world(one(over, extra)),
	steps: [owner()],
	final: RETENTION_DUMP,
});

const scene = (name: string, o: Scene, extra: Partial<Case> = {}): Case => ({
	name,
	...world(o),
	steps: [owner()],
	final: RETENTION_DUMP,
	...extra,
});

const cases: Case[] = [
	// guards and the empty archive
	{
		name: "no retention binding id is configured",
		...world(),
		env: {},
		steps: [owner()],
	},
	{
		name: "an empty binding id",
		...world(),
		env: { AGREEMENT_RETENTION_BINDING_ID: "" },
		steps: [owner()],
	},
	{
		name: "no bucket is bound",
		...world(),
		r2: { missing: true },
		steps: [owner()],
	},
	{
		name: "no bucket and no binding id",
		...world(),
		r2: { missing: true },
		env: {},
		steps: [owner()],
	},
	{
		name: "a visitor is refused",
		...world(),
		steps: [owner({ as: asVisitor() })],
	},
	{
		name: "the empty archive writes the cursor marker",
		...world(),
		steps: [owner()],
		final: { r2: true },
	},
	{
		name: "a native form post gets the JSON manifest",
		...world(one()),
		steps: [form({ action: "retention-preview" })],
		final: RETENTION_DUMP,
	},
	{
		name: "extra fields are ignored",
		...world(one()),
		steps: [
			act({
				action: "retention-preview",
				confirmed: true,
				manifest: "x",
				junk: [1],
			}),
		],
	},
	{
		name: "the eligibility query fails",
		...world(one()),
		failures: [
			{ on: /SELECT a\.\* FROM software_agreements a/, message: "d1 down" },
		],
		steps: [owner()],
	},
	{ name: "an empty JSON object has no action", ...world(), steps: [act({})] },

	// eligibility
	eligibleCase("an eligible SOW with its objects", {}),
	{
		name: "an eligible MSA without signatures",
		...world({
			seed: { software_agreements: [msaAgreement("m1")] },
			r2: objectsOf("m1"),
		}),
		steps: [owner()],
	},
	{
		name: "a signed MSA that is not terminated is kept",
		...world({
			seed: merge(
				{ software_agreements: [msaAgreement("m1")] },
				evidenceOf("m1"),
			),
			r2: objectsOf("m1"),
		}),
		steps: [owner()],
	},
	{
		name: "a signed MSA that was terminated is eligible",
		...world({
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
		steps: [owner()],
	},
	eligibleCase("an abandoned SOW is eligible", {
		status: "abandoned",
		abandoned_at: "2026-11-01T00:00:00.000Z",
	}),
	eligibleCase("a SOW in review is kept", {
		status: "review",
		executed_at: null,
		ended_at: null,
	}),
	eligibleCase("a client-signed SOW is kept", {
		status: "client_signed",
		executed_at: null,
	}),
	eligibleCase("a SOW that has not ended is kept", { ended_at: null }),
	eligibleCase("a SOW with no retain_until is kept", { retain_until: null }),
	eligibleCase("retain_until in the future is kept", {
		retain_until: "2026-12-01T00:00:00.000Z",
	}),
	eligibleCase("retain_until at this instant is eligible", {
		retain_until: "2026-11-13T12:00:00.000Z",
	}),
	eligibleCase("retain_until one millisecond later is kept", {
		retain_until: "2026-11-13T12:00:00.001Z",
	}),
	eligibleCase("a legal hold keeps the SOW", { legal_hold: 1 }),
	eligibleCase(
		"an artifact being rendered keeps it",
		{},
		{
			seed: {
				software_agreement_artifacts: [
					{ agreement_id: "a1", status: "rendering" },
				],
			},
		},
	),
	eligibleCase(
		"a failed artifact does not keep it",
		{},
		{
			seed: {
				software_agreement_artifacts: [
					{ agreement_id: "a1", status: "failed", error_code: "render" },
				],
			},
		},
	),
	eligibleCase(
		"a delivery being sent keeps it",
		{},
		{
			seed: {
				software_agreement_deliveries: [
					{
						agreement_id: "a1",
						recipient_role: "client",
						email: "grace@example.test",
						status: "sending",
					},
				],
			},
		},
	),
	eligibleCase(
		"a notification being sent keeps it",
		{},
		{
			seed: {
				software_agreement_notifications: [
					{
						agreement_id: "a1",
						kind: "signature-receipt",
						email: "grace@example.test",
						status: "sending",
					},
				],
			},
		},
	),
	eligibleCase(
		"a live project of the agreement keeps it",
		{},
		{
			setup: [
				"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,agreement_id) VALUES('r1','o1','{}','standard','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','owner','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','a1')",
			],
		},
	),
	eligibleCase(
		"a project whose content was deleted does not keep it",
		{},
		{
			setup: [
				"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,agreement_id,content_deleted_at,external_signature_details_json) VALUES('r1','o1','{}','standard','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','owner','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','a1','2026-11-13T11:30:00.000Z','{\"who\":\"external\"}')",
			],
		},
	),
	eligibleCase(
		"a live project of the same offer keeps it",
		{},
		{
			setup: [
				"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','owner','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')",
			],
		},
	),
	{
		name: "an MSA reused by an offer with a live project is kept",
		...world({
			seed: merge(sowScene(2), { software_agreements: [msaAgreement("m1")] }),
			r2: objectsOf("m1"),
			setup: [
				"UPDATE software_offers SET reused_msa_id='m1' WHERE id='o2'",
				"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r2','o2','{}','standard','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','owner','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')",
			],
		}),
		steps: [owner()],
	},
	{
		name: "an MSA reused by an offer that has an SOW is kept",
		...world({
			seed: merge(
				sowScene(2, {
					agreement: {
						status: "review",
						ended_at: null,
						retain_until: null,
						executed_at: null,
					},
				}),
				{ software_agreements: [msaAgreement("m1")] },
			),
			r2: objectsOf("m1"),
			setup: ["UPDATE software_offers SET reused_msa_id='m1' WHERE id='o2'"],
		}),
		steps: [owner()],
	},
	{
		name: "an MSA reused by a sent offer is kept",
		...world({
			seed: merge(
				{ software_agreements: [msaAgreement("m1")] },
				{
					owner_requests: [rows.softwareRequest("r2")],
					software_offers: [
						rows.softwareOffer("o2", "r2", {
							status: "sent",
							reused_msa_id: null,
						}),
					],
				},
			),
			r2: objectsOf("m1"),
			setup: ["UPDATE software_offers SET reused_msa_id='m1' WHERE id='o2'"],
		}),
		steps: [owner()],
	},
	{
		name: "an MSA reused by a draft offer is kept",
		...world({
			seed: merge(
				{ software_agreements: [msaAgreement("m1")] },
				{
					owner_requests: [rows.softwareRequest("r2")],
					software_offers: [
						rows.softwareOffer("o2", "r2", { status: "draft" }),
					],
				},
			),
			r2: objectsOf("m1"),
			setup: ["UPDATE software_offers SET reused_msa_id='m1' WHERE id='o2'"],
		}),
		steps: [owner()],
	},
	{
		name: "an MSA reused only by a superseded offer is eligible",
		...world({
			seed: merge(
				{ software_agreements: [msaAgreement("m1")] },
				{
					owner_requests: [rows.softwareRequest("r2")],
					software_offers: [
						rows.softwareOffer("o2", "r2", { status: "superseded" }),
					],
				},
			),
			r2: objectsOf("m1"),
			setup: ["UPDATE software_offers SET reused_msa_id='m1' WHERE id='o2'"],
		}),
		steps: [owner()],
	},
	{
		name: "an MSA linked by an SOW is kept",
		...world({
			seed: merge(
				sowScene(2, {
					agreement: {
						status: "review",
						ended_at: null,
						retain_until: null,
						executed_at: null,
					},
				}),
				{ software_agreements: [msaAgreement("m1")] },
			),
			r2: objectsOf("m1"),
			setup: ["UPDATE software_agreements SET msa_id='m1' WHERE id='a2'"],
		}),
		steps: [owner()],
	},
	{
		name: "twenty-one eligible agreements list the first twenty in id order",
		...world({ seed: many(21) }),
		steps: [owner()],
	},
	{
		name: "an object of a longer id is not taken for this agreement",
		...world(
			one({}, { r2: { "agreements/a10/signed.pdf": { body: "other" } } }),
		),
		steps: [owner()],
	},

	// attachments inside agreements
	eligibleCase(
		"an attachment of the agreement is listed with its objects",
		{
			attachment_manifest_json: manifestJson({
				key: attachmentKey("att1"),
				sha256: PDF_SHA,
			}),
		},
		{
			r2: { [attachmentKey("att1")]: { body: PDF } },
			seed: { software_agreement_attachments: [attachmentRow("att1", "r1")] },
		},
	),
	{
		name: "an attachment shared with a kept agreement stays",
		...world({
			seed: merge(
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
						retain_until: "2027-01-01T00:00:00.000Z",
						attachment_manifest_json: manifestJson({
							key: attachmentKey("att1"),
							sha256: PDF_SHA,
						}),
					},
				}),
				{ software_agreement_attachments: [attachmentRow("att1", "r1")] },
			),
			r2: { ...objectsOf("a1"), [attachmentKey("att1")]: { body: PDF } },
		}),
		steps: [owner()],
	},
	{
		name: "an attachment pinned by an active offer stays",
		...world({
			seed: merge(
				sowScene(1, {
					agreement: {
						attachment_manifest_json: manifestJson({
							key: attachmentKey("att1"),
							sha256: PDF_SHA,
						}),
					},
				}),
				{
					owner_requests: [rows.softwareRequest("r2")],
					software_offers: [
						rows.softwareOffer("o2", "r2", {
							status: "sent",
							agreement_details_json: pinned(attachmentKey("att1")),
						}),
					],
					software_agreement_attachments: [attachmentRow("att1", "r1")],
				},
			),
			r2: { ...objectsOf("a1"), [attachmentKey("att1")]: { body: PDF } },
		}),
		steps: [owner()],
	},
	{
		name: "an offer attachment with a started project no longer pins it",
		...world({
			seed: merge(
				sowScene(1, {
					agreement: {
						attachment_manifest_json: manifestJson({
							key: attachmentKey("att1"),
							sha256: PDF_SHA,
						}),
					},
				}),
				{
					owner_requests: [rows.softwareRequest("r2")],
					software_offers: [
						rows.softwareOffer("o2", "r2", {
							status: "sent",
							agreement_details_json: pinned(attachmentKey("att1")),
						}),
					],
					software_agreement_attachments: [attachmentRow("att1", "r1")],
				},
			),
			r2: { ...objectsOf("a1"), [attachmentKey("att1")]: { body: PDF } },
			setup: [
				"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,content_deleted_at) VALUES('r2','o2','{}','standard','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','owner','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T11:30:00.000Z')",
			],
		}),
		steps: [owner()],
	},
	{
		name: "two retiring agreements share an attachment, the last one owns it",
		...world({
			seed: merge(
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
				{ software_agreement_attachments: [attachmentRow("att1", "r1")] },
			),
			r2: {
				...objectsOf("a1"),
				...objectsOf("a2"),
				[attachmentKey("att1")]: { body: PDF },
			},
		}),
		steps: [owner()],
	},
	eligibleCase("a malformed attachment manifest stops the whole preview", {
		attachment_manifest_json: "{not json",
	}),
	eligibleCase(
		"an offer whose details are not JSON does not break the pin check",
		{
			attachment_manifest_json: manifestJson({
				key: attachmentKey("att1"),
				sha256: PDF_SHA,
			}),
		},
		{
			seed: {
				owner_requests: [rows.softwareRequest("r2")],
				software_offers: [
					rows.softwareOffer("o2", "r2", {
						status: "sent",
						agreement_details_json: '{"attachments":["text",{"key":null}]}',
					}),
				],
			},
			r2: { [attachmentKey("att1")]: { body: PDF } },
		},
	),

	// unattached attachments (old metadata nothing references)
	scene("an old unattached attachment is listed", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [attachmentRow("u1", "r1")],
		},
	}),
	scene("a young unattached attachment is not listed", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [
				attachmentRow("u1", "r1", { created_at: "2026-11-01T00:00:00.000Z" }),
			],
		},
	}),
	scene("an attachment exactly thirty days old is listed", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [
				attachmentRow("u1", "r1", {
					created_at: new Date(
						Date.parse("2026-11-13T12:00:00.000Z") - THIRTY_DAYS,
					).toISOString(),
				}),
			],
		},
	}),
	scene("an attachment one millisecond too young is not listed", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [
				attachmentRow("u1", "r1", {
					created_at: new Date(
						Date.parse("2026-11-13T12:00:00.000Z") - THIRTY_DAYS + 1,
					).toISOString(),
				}),
			],
		},
	}),
	scene("an attachment a kept agreement carries is not unattached", {
		seed: merge(
			sowScene(1, {
				agreement: {
					retain_until: "2027-01-01T00:00:00.000Z",
					attachment_manifest_json: manifestJson({
						key: attachmentKey("u1"),
						sha256: PDF_SHA,
					}),
				},
			}),
			{ software_agreement_attachments: [attachmentRow("u1", "r1")] },
		),
	}),
	scene("an attachment an active offer pins is not unattached", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_offers: [
				rows.softwareOffer("o1", "r1", {
					status: "draft",
					agreement_details_json: pinned(attachmentKey("u1")),
				}),
			],
			software_agreement_attachments: [attachmentRow("u1", "r1")],
		},
	}),
	scene("one hundred and one unattached attachments list the first hundred", {
		seed: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: Array.from({ length: 101 }, (_, index) =>
				attachmentRow(`u${String(index).padStart(3, "0")}`, "r1"),
			),
		},
	}),

	// orphans in the bucket (advance the clock past thirty days)
	scene(
		"an old object nothing references is an orphan",
		{ r2: { [attachmentKey("lost")]: { body: PDF } } },
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene("a young object is not an orphan", {
		r2: { [attachmentKey("lost")]: { body: PDF } },
	}),
	scene(
		"an object exactly thirty days old is an orphan",
		{ r2: { [attachmentKey("lost")]: { body: PDF } } },
		{ steps: [owner({ advanceMs: THIRTY_DAYS })] },
	),
	scene(
		"an object one millisecond too young is not an orphan",
		{ r2: { [attachmentKey("lost")]: { body: PDF } } },
		{ steps: [owner({ advanceMs: THIRTY_DAYS - 1 })] },
	),
	scene(
		"an object with metadata is not an orphan",
		{
			r2: { [attachmentKey("att1")]: { body: PDF } },
			seed: {
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [
					attachmentRow("att1", "r1", {
						created_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"an object a kept agreement carries is not an orphan",
		{
			r2: { [attachmentKey("att1")]: { body: PDF } },
			seed: sowScene(1, {
				agreement: {
					retain_until: "2027-01-01T00:00:00.000Z",
					attachment_manifest_json: manifestJson({
						key: attachmentKey("att1"),
						sha256: PDF_SHA,
					}),
				},
			}),
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"an object an active offer pins is not an orphan",
		{
			r2: { [attachmentKey("att1")]: { body: PDF } },
			seed: {
				owner_requests: [rows.softwareRequest("r1")],
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "sent",
						agreement_details_json: pinned(attachmentKey("att1")),
					}),
				],
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"an old object outside the attachment prefix is ignored",
		{ r2: { "agreements/other/file.pdf": { body: PDF } } },
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"one hundred and one old objects list a hundred and a next cursor",
		{
			r2: Object.fromEntries(
				Array.from({ length: 101 }, (_, index) => [
					attachmentKey(`o${String(index).padStart(3, "0")}`),
					{ body: `object ${index}` },
				]),
			),
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"one hundred and one young objects write the next cursor to the marker",
		{
			r2: Object.fromEntries(
				Array.from({ length: 101 }, (_, index) => [
					attachmentKey(`o${String(index).padStart(3, "0")}`),
					{ body: `object ${index}` },
				]),
			),
		},
		{ final: { r2: true } },
	),
	scene(
		"a saved cursor starts the scan after it",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				[attachmentKey("b")]: { body: "b" },
				[attachmentKey("c")]: { body: "c" },
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 1, cursor: attachmentKey("a") }),
				},
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"an unreadable marker restarts the scan",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				"agreements/retention/attachment-cursor.json": { body: "{nope" },
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"a marker of version 2 is ignored",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				[attachmentKey("b")]: { body: "b" },
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 2, cursor: attachmentKey("a") }),
				},
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"a marker with an empty cursor is ignored",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				[attachmentKey("b")]: { body: "b" },
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 1, cursor: "" }),
				},
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"a marker with a cursor over 4096 characters is ignored",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				[attachmentKey("b")]: { body: "b" },
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 1, cursor: "z".repeat(4097) }),
				},
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"a marker whose cursor is not text is ignored",
		{
			r2: {
				[attachmentKey("a")]: { body: "a" },
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 1, cursor: 7 }),
				},
			},
		},
		{ steps: [owner({ advanceMs: THIRTY_DAYS + 1 })] },
	),
	scene(
		"a saved cursor and a failing bucket list retries and fails again",
		{
			r2: {
				"agreements/retention/attachment-cursor.json": {
					body: JSON.stringify({ version: 1, cursor: attachmentKey("a") }),
				},
			},
		},
		{
			r2: {
				seed: {
					"agreements/retention/attachment-cursor.json": {
						body: JSON.stringify({ version: 1, cursor: attachmentKey("a") }),
					},
				},
				fails: ["list"],
			},
		},
	),

	// outages
	scene("the bucket list fails", {}, { r2: { fails: ["list"] } }),
	scene(
		"the bucket read of an agreement object fails",
		one().seed ? { seed: one().seed, r2: objectsOf("a1") } : {},
		{ r2: { seed: objectsOf("a1"), fails: ["get"] } },
	),
	scene("writing the cursor marker fails", {}, { r2: { fails: ["put"] } }),
	{
		name: "the shared-attachment lookup fails",
		...world(
			one({
				attachment_manifest_json: manifestJson({
					key: attachmentKey("att1"),
					sha256: PDF_SHA,
				}),
			}),
		),
		failures: [{ on: /other\.id NOT IN/, message: "d1 down" }],
		steps: [owner()],
	},
	{
		name: "the active-offer lookup fails",
		...world(
			one({
				attachment_manifest_json: manifestJson({
					key: attachmentKey("att1"),
					sha256: PDF_SHA,
				}),
			}),
		),
		failures: [{ on: /FROM software_offers o,json_each/, message: "d1 down" }],
		steps: [owner()],
	},
	{
		name: "the project-evidence read fails",
		...world(one()),
		failures: [
			{
				on: /external_signature_details_json FROM software_projects/,
				message: "d1 down",
			},
		],
		steps: [owner()],
	},
	{
		name: "the unattached query fails",
		...world(one()),
		failures: [
			{
				on: /FROM software_agreement_attachments attachment/,
				message: "d1 down",
			},
		],
		steps: [owner()],
	},
	{
		name: "the orphan reference check fails",
		...world({ r2: { [attachmentKey("lost")]: { body: PDF } } }),
		failures: [{ on: /SELECT 1 WHERE\s+EXISTS/, message: "d1 down" }],
		steps: [owner({ advanceMs: THIRTY_DAYS + 1 })],
	},
	{
		name: "a change between the lists is not seen by a single preview",
		...world(one()),
		interleave: [
			{
				on: /FROM software_agreement_attachments attachment/,
				label: "the hold is placed after the agreements were read",
				run: run("UPDATE software_agreements SET legal_hold=1 WHERE id='a1'"),
			},
		],
		steps: [owner()],
		final: RETENTION_DUMP,
	},
	{ name: "a body that is not JSON", ...world(), steps: [raw("{bad")] },
];

defineCorpus("owner-agreements-retention-preview", POST, cases);
