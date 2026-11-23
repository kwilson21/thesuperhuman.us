import { describe, expect, it } from "vitest";
import { POST as AGREEMENT } from "~/pages/api/owner/requests/[id]/agreement";
import {
	GET as ATTACHMENT,
	PUT as UPLOAD,
} from "~/pages/api/owner/requests/[id]/agreement-attachments";
import { GET as SIGNED_COPY } from "~/pages/api/owner/agreements/[id]/file";
import { isObject, isText } from "~/lib/type-guards";
import {
	asOwner,
	rows,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
	type Interleave,
	type Step,
} from "../golden/harness";
import type { Recorded } from "../golden/harness/plain";
import * as admin from "../golden/areas/agreement-admin";
import * as signing from "../golden/areas/signing";

// How the four owner routes of website signing answer a failure on the site's side, after the behaviour fixes of
// docs/plans/2026-11-signing-conversion.md, section 5 (B1, B2, B3, B4 and B8), on the owner's decision of 2026-11-14: an
// unexpected store failure answers 500 with the route's fixed sentence, never the error's text, logged once; 503 only for
// a missing binding or a known unavailable dependency; a refusal keeps its answer. J1: the owner's downloads answer a
// ready copy whose object is gone with that logged 500, not the visitors' 404. Each case runs on the golden harness: the
// real schema on SQLite, the statements a failure names made to throw.

const DOWN = "D1_ERROR: private details for grace@example.test";

const CHANGED =
	"The agreement changed or the operation failed. Reload before retrying.";

const NOT_SAVED = "The attachment could not be saved.";
const COPY_UNAVAILABLE = "Signed copy unavailable. Contact Kazon.";

const DEPOSIT_BLOCK =
	"Void the deposit invoice first, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded.";

const OPEN_MSA =
	"An open offer uses this agreement. Withdraw that offer first.";

const OFFER_LOOKUP =
	/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/;

const DEPOSIT_CHECK = /^SELECT 1 FROM software_invoices WHERE offer_id=\?/;
const MSA_USE = /^SELECT 1 FROM software_offers o JOIN owner_requests r/;
const SIGNATURE_INSERT = /INSERT INTO software_agreement_signatures/;
const ABANDON_BATCH = /UPDATE software_agreements SET status='abandoned'/;
const END_BATCH = /UPDATE software_agreements SET ended_at/;
const HOLD_BATCH = /UPDATE software_agreements SET legal_hold/;

const PACKET_CLAIM =
	/UPDATE software_agreement_artifacts SET status='rendering'/;

const ATTACHMENT_INSERT = /INSERT INTO software_agreement_attachments/;

/** What a step answered, and what the case logged. */
type Seen = {
	readonly status: number | "rejected";
	readonly body: string;
	readonly logs: readonly string[];
};

const isTable = (
	value: Recorded | undefined,
): value is { [key: string]: Recorded } =>
	isObject(value) && !Array.isArray(value);

/** The rows of a music table that a step dumped. */
function dumped(record: CaseRecord, table: string, step = 0): Recorded[] {
	const state = record.steps[step]?.state ?? undefined;
	const music = isTable(state) ? state.music : undefined;
	const rows = isTable(music) ? music[table] : undefined;

	return Array.isArray(rows) ? rows : [];
}

/** Every console line the case wrote, each joined into one line. */
const logsOf = (record: CaseRecord) =>
	record.effects.flatMap((effect) =>
		effect.kind === "console" ? [effect.args.map(String).join(" ")] : [],
	);

/** The SQL of every statement the case ran on its own (each statement of a batch included). */
const statementsOf = (record: CaseRecord) =>
	record.effects.flatMap((effect) =>
		effect.kind === "d1"
			? [effect.sql]
			: effect.kind === "d1-batch"
				? effect.statements.map((statement) => statement.sql)
				: [],
	);

/** The R2 operations of the case, in order. */
const bucketOf = (record: CaseRecord) =>
	record.effects.flatMap((effect) => (effect.kind === "r2" ? [effect.op] : []));

function seen(record: CaseRecord, step = 0): Seen {
	const answer = record.steps[step].answer;

	return {
		status: answer.outcome === "response" ? answer.status : "rejected",
		body:
			answer.outcome === "response" && isText(answer.body) ? answer.body : "",
		logs: logsOf(record),
	};
}

const run = async (handler: Handler, c: Omit<Case, "name">) =>
	runCase(handler, { name: "signing owner outage", ...c });

const failing = (on: RegExp, nth = 1) => ({
	failures: [{ on, nth, message: DOWN }],
});

const json = (error: string) => JSON.stringify({ ok: false, error });

/** The one line a fault logs: the route's label and the error's name and message, the address in it redacted. */
const logged = (label: string) => [
	`${label} failed unexpectedly: Error D1_ERROR: private details for [email]`,
];

// ---- POST /api/owner/requests/[id]/agreement ----

/** An owner request on the signing area's scene, as the action corpora send it. */
const owner = (
	sc: signing.Scene,
	body: signing.Loose,
	over: Omit<Case, "name" | "steps"> = {},
	step: Partial<Step> = {},
): Omit<Case, "name"> => {
	const { name: _name, ...rest } = signing.own("", sc, body, over, step);

	return rest;
};

const countersign = signing.countersignBody();
const abandon = signing.abandonBody();
const pending = signing.clientSigned();
const executed = signing.executed();

const endOn = (id: string = signing.SOW_ID, ended_on = "2026-11-13") =>
	signing.forAgreement("end", { ended_on, confirmed: true }, id);

const hold = signing.forAgreement("hold", { held: true });

/** Another request runs `sql` just before the first statement (or batch) that matches `on`. */
const interleaved = (on: RegExp, sql: string) => ({
	interleave: [
		{ on, label: "another request", run: (s) => s.exec(sql) },
	] satisfies Interleave[],
});

describe("POST /api/owner/requests/[id]/agreement", () => {
	it.each([
		["countersign", pending, countersign],
		["abandon", pending, abandon],
		["hold", executed, hold],
		["retry-copy", executed, signing.forAgreement("retry-copy")],
	])(
		"answers a failed offer lookup (%s) 500 with its sentence, logged once (B2)",
		async (_name, sc, body) => {
			const record = await run(
				AGREEMENT,
				owner(sc, body, failing(OFFER_LOOKUP)),
			);

			expect(seen(record)).toEqual({
				status: 500,
				body: json(CHANGED),
				logs: logged("Owner request agreement"),
			});
		},
	);

	it("answers a failed signing setting and a failed countersign batch 500, with nothing signed (B1)", async () => {
		for (const on of [/SELECT software_signing_enabled/, SIGNATURE_INSERT]) {
			const record = await run(
				AGREEMENT,
				owner(pending, countersign, failing(on)),
			);

			expect(seen(record)).toEqual({
				status: 500,
				body: json(CHANGED),
				logs: logged("Owner request agreement"),
			});
			expect(
				dumped(record, "software_agreement_signatures").filter(
					(row) => isTable(row) && row.party === "contractor",
				),
			).toEqual([]);
		}
	});

	it.each([
		[
			"a guard (the request withdrawn since the read)",
			interleaved(
				SIGNATURE_INSERT,
				"UPDATE owner_requests SET status='withdrawn'",
			),
			pending,
		],
		[
			"a unique index (an artifact row written since the read)",
			interleaved(
				SIGNATURE_INSERT,
				`INSERT INTO software_agreement_artifacts(agreement_id) VALUES('${signing.SOW_ID}')`,
			),
			pending,
		],
		[
			"a NOT NULL value (an offer with no client email snapshot)",
			{},
			signing.clientSigned({ offer: { recipient_email_snapshot: null } }),
		],
	])(
		"keeps countersign's 409 when the batch is refused by %s, and logs nothing",
		async (_name, over, sc) => {
			const record = await run(AGREEMENT, owner(sc, countersign, over));

			expect(seen(record)).toEqual({
				status: 409,
				body: json(CHANGED),
				logs: [],
			});
		},
	);

	it("answers a failed first deposit check 500 at once, with no recheck after it (B1, the second trigger that stops firing)", async () => {
		const record = await run(
			AGREEMENT,
			owner(pending, abandon, failing(DEPOSIT_CHECK)),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
		expect(
			statementsOf(record).filter((sql) => DEPOSIT_CHECK.test(sql)),
		).toHaveLength(1);
	});

	it("answers a failed abandon batch 500 even when a deposit appeared meanwhile, with nothing abandoned (B1)", async () => {
		const record = await run(
			AGREEMENT,
			owner(pending, abandon, {
				...failing(ABANDON_BATCH),
				...interleaved(
					ABANDON_BATCH,
					"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'open','o','t','t')",
				),
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
		expect(
			dumped(record, "software_agreements").filter(
				(row) => isTable(row) && row.status === "abandoned",
			),
		).toEqual([]);
	});

	it("keeps the deposit's 409 when the batch guard raised because a deposit appeared, and logs nothing", async () => {
		const record = await run(
			AGREEMENT,
			owner(
				pending,
				abandon,
				interleaved(
					ABANDON_BATCH,
					"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'creating','o','t','t')",
				),
			),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(DEPOSIT_BLOCK),
			logs: [],
		});
	});

	it("answers a failed deposit recheck after a refused batch 500, logged once (it rejected)", async () => {
		const record = await run(
			AGREEMENT,
			owner(pending, abandon, {
				...interleaved(
					ABANDON_BATCH,
					"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'creating','o','t','t')",
				),
				...failing(DEPOSIT_CHECK, 2),
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
	});

	it("answers a failed end batch of an MSA 500 at once, with no recheck of its use (B1, B2)", async () => {
		const record = await run(
			AGREEMENT,
			owner(executed, endOn(signing.MSA_ID), failing(END_BATCH)),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
		expect(
			statementsOf(record).filter((sql) => MSA_USE.test(sql)),
		).toHaveLength(1);
	});

	/** Both documents executed on 2025-01-01, so a day in February 2025 comes after signing. */
	const signedEarly = signing.executed({
		msa: signing.doc("executed", {
			row: { executed_at: "2025-01-01T12:00:00.000Z" },
		}),
		sow: signing.doc("executed", {
			row: { executed_at: "2025-01-01T12:00:00.000Z" },
		}),
	});

	it.each([
		[
			"the cleanup lock on a closed archive",
			executed,
			endOn(),
			interleaved(
				END_BATCH,
				`UPDATE software_agreements SET archive_closed_at='2026-11-13T12:00:00.000Z' WHERE id='${signing.SOW_ID}'`,
			),
			CHANGED,
		],
		[
			"a guard (an offer starts to reuse the MSA)",
			executed,
			endOn(signing.MSA_ID),
			interleaved(
				END_BATCH,
				`UPDATE software_offers SET reused_msa_id='${signing.MSA_ID}'`,
			),
			OPEN_MSA,
		],
		[
			"a date that does not exist",
			signedEarly,
			endOn(signing.SOW_ID, "2025-02-30"),
			{},
			CHANGED,
		],
	])(
		"keeps end's 409 for %s, and logs nothing",
		async (_name, sc, body, over, error) => {
			const record = await run(AGREEMENT, owner(sc, body, over));

			expect(seen(record)).toEqual({
				status: 409,
				body: json(error),
				logs: [],
			});
		},
	);

	it("keeps hold's 409 for a foreign key (the agreement deleted since the read), and answers a failed batch 500 (B1)", async () => {
		const deleted = await run(
			AGREEMENT,
			owner(
				executed,
				hold,
				interleaved(
					HOLD_BATCH,
					`DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_artifacts; DELETE FROM software_agreement_signatures WHERE agreement_id='${signing.SOW_ID}'; DELETE FROM software_agreements WHERE id='${signing.SOW_ID}'`,
				),
			),
		);

		expect(seen(deleted)).toEqual({
			status: 409,
			body: json(CHANGED),
			logs: [],
		});

		const failed = await run(
			AGREEMENT,
			owner(executed, hold, failing(HOLD_BATCH)),
		);

		expect(seen(failed)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
	});

	it("answers retry-copy's failed reset and failed bucket read 500, logged once (B1)", async () => {
		const reset = await run(
			AGREEMENT,
			owner(signing.delivered("failed"), signing.forAgreement("retry-copy"), {
				...signing.smallPackets,
				fetches: signing.resendOk,
				omit: [],
				...failing(/UPDATE software_agreement_deliveries SET status='pending'/),
			}),
		);

		expect(seen(reset)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});

		const bucket = await run(
			AGREEMENT,
			owner(signing.delivered("pending"), signing.forAgreement("retry-copy"), {
				r2: { seed: signing.storedPackets, fails: ["get"] },
				fetches: signing.resendOk,
				omit: [],
			}),
		);

		expect(seen(bucket)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: [
				"Owner request agreement failed unexpectedly: Error r2 get failed",
			],
		});
	});

	it("answers retry-artifact with no bucket 503 at the packet step, after the recovery write and the MSA read, with nothing claimed (B3)", async () => {
		const record = await run(
			AGREEMENT,
			owner(executed, signing.forAgreement("retry-artifact"), {
				r2: { missing: true },
			}),
		);

		expect(seen(record)).toEqual({
			status: 503,
			body: JSON.stringify({ ok: false }),
			logs: [],
		});
		expect(statementsOf(record).at(-1)).toMatch(
			/^SELECT msa_id FROM software_agreements/,
		);
		expect(
			statementsOf(record).filter((sql) => PACKET_CLAIM.test(sql)),
		).toEqual([]);
	});

	it("answers a failed packet claim 500, logged once (B1)", async () => {
		const record = await run(
			AGREEMENT,
			owner(executed, signing.forAgreement("retry-artifact"), {
				...failing(PACKET_CLAIM),
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(CHANGED),
			logs: logged("Owner request agreement"),
		});
	});

	it.each([
		["no id", {}],
		["an empty id", { id: "" }],
	])(
		"answers %s as an unknown request: countersign's 409 and hold's 404, with no read of the offer (B3)",
		async (_name, params) => {
			const signed = await run(
				AGREEMENT,
				owner(pending, countersign, {}, { params }),
			);

			expect(seen(signed)).toEqual({
				status: 409,
				body: json("Signing is off or the offer changed."),
				logs: [],
			});
			expect(statementsOf(signed)).toEqual([]);

			const held = await run(AGREEMENT, owner(executed, hold, {}, { params }));

			expect(seen(held)).toEqual({
				status: 404,
				body: JSON.stringify({ ok: false }),
				logs: [],
			});
		},
	);

	it("renders the 500 of a native form post as its page, without the error's text", async () => {
		const { name: _name, ...form } = signing.ownForm(
			"",
			executed,
			hold,
			failing(HOLD_BATCH),
		);

		const record = await run(AGREEMENT, form);

		const answer = seen(record);

		expect(answer.status).toBe(500);
		expect(answer.body).toContain(CHANGED);
		expect(answer.body).not.toContain("D1_ERROR");
		expect(answer.logs).toEqual(logged("Owner request agreement"));
	});
});

// ---- PUT and GET /api/owner/requests/[id]/agreement-attachments ----

const UPLOAD_PATH = "/api/owner/requests/r1/agreement-attachments";

const upload = (over: Partial<Step> = {}): Step => ({
	as: asOwner(),
	method: "PUT",
	path: `${UPLOAD_PATH}?${new URLSearchParams({ filename: "msa-draft.pdf", version: "2", date: "2026-10-01" }).toString()}`,
	params: { id: "r1" },
	headers: { origin: admin.ORIGIN, "content-type": "application/pdf" },
	body: admin.PDF,
	dump: { music: ["software_agreement_attachments"], r2: true },
	...over,
});

const uploadCase = (
	request = rows.softwareRequest("r1", { status: "reviewed" }),
	over: Omit<Case, "name" | "steps"> = {},
	step: Partial<Step> = {},
): Omit<Case, "name"> => ({
	music: { seed: { owner_requests: [request] } },
	setup: admin.sql(
		"UPDATE software_signing_settings SET software_signing_enabled=1",
	),
	steps: [upload(step)],
	...over,
});

describe("PUT /api/owner/requests/[id]/agreement-attachments", () => {
	it("answers a failed signing setting 500 with its sentence, logged once (B2)", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(undefined, failing(/SELECT software_signing_enabled/)),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(NOT_SAVED),
			logs: logged("Owner attachment upload"),
		});
	});

	it("answers a failed batch 500, logged once, and deletes the object (B1)", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(undefined, failing(ATTACHMENT_INSERT)),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(NOT_SAVED),
			logs: logged("Owner attachment upload"),
		});
		expect(bucketOf(record)).toEqual(["put", "delete"]);
	});

	it("answers a failed bucket put 500, logged once (B1)", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(undefined, { r2: { fails: ["put"] } }),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(NOT_SAVED),
			logs: [
				"Owner attachment upload failed unexpectedly: Error r2 put failed",
			],
		});
	});

	it.each([
		[
			"an unknown request",
			{ params: { id: "zz" } },
			undefined,
			404,
			'{"ok":false}',
		],
		[
			"a service request",
			{},
			rows.ownerRequest("r1", { kind: "service" }),
			404,
			'{"ok":false}',
		],
		["no id", { params: {} }, undefined, 404, '{"ok":false}'],
		[
			"a withdrawn request",
			{},
			rows.softwareRequest("r1", { status: "withdrawn" }),
			409,
			json(NOT_SAVED),
		],
		[
			"a resolved request",
			{},
			rows.softwareRequest("r1", { status: "resolved" }),
			409,
			json(NOT_SAVED),
		],
	])(
		"refuses %s (B3, B4), deletes the object and logs nothing",
		async (_name, step, request, status, body) => {
			const record = await run(UPLOAD, uploadCase(request, {}, step));

			expect(seen(record)).toEqual({ status, body, logs: [] });
			expect(bucketOf(record)).toEqual(["put", "delete"]);
			expect(dumped(record, "software_agreement_attachments")).toEqual([]);
		},
	);

	it("refuses a request withdrawn just before the batch with 409 (the guard raised, B4)", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(
				undefined,
				interleaved(
					ATTACHMENT_INSERT,
					"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
				),
			),
		);

		expect(seen(record)).toEqual({
			status: 409,
			body: json(NOT_SAVED),
			logs: [],
		});
	});

	it("answers a failed read of the request after a refused batch 500, logged once", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(rows.softwareRequest("r1", { status: "withdrawn" }), {
				...failing(/^SELECT kind FROM owner_requests/),
			}),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: json(NOT_SAVED),
			logs: logged("Owner attachment upload"),
		});
	});

	it("refuses bytes pdf-lib cannot read with 400 (B4), and logs nothing", async () => {
		const record = await run(
			UPLOAD,
			uploadCase(undefined, {}, { body: "%PDF-garbage" }),
		);

		expect(seen(record)).toEqual({
			status: 400,
			body: json(
				"The PDF could not be validated. Use a supported PDF or sign outside the website.",
			),
			logs: [],
		});
		expect(bucketOf(record)).toEqual([]);
	});
});

const KEY = admin.attachmentKey("att1");

const attachmentCase = (
	over: Omit<Case, "name" | "steps"> = {},
): Omit<Case, "name"> => ({
	music: {
		seed: {
			owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
			software_agreement_attachments: [
				admin.attachmentRow("att1", "r1", { created_at: admin.EARLIER }),
			],
		},
	},
	r2: { seed: { [KEY]: { body: admin.PDF } } },
	steps: [
		{
			as: asOwner(),
			method: "GET",
			path: `${UPLOAD_PATH}?attachment=att1`,
			params: { id: "r1" },
		},
	],
	...over,
});

describe("GET /api/owner/requests/[id]/agreement-attachments", () => {
	it.each([
		["no database", { music: { missing: true } }],
		["no bucket", { r2: { missing: true } }],
	])("answers %s 503 before any read (B3)", async (_name, over) => {
		const record = await run(ATTACHMENT, attachmentCase(over));

		expect(seen(record)).toEqual({
			status: 503,
			body: "Unavailable",
			logs: [],
		});
		expect(statementsOf(record)).toEqual([]);
	});

	it("answers a failed query 500, logged once (B2)", async () => {
		const record = await run(
			ATTACHMENT,
			attachmentCase(
				failing(/SELECT object_key FROM software_agreement_attachments/),
			),
		);

		expect(seen(record)).toEqual({
			status: 500,
			body: "Unavailable",
			logs: logged("Owner attachment"),
		});
	});

	it("answers a failed bucket read and a missing object 500, logged once (B2, B8, J1)", async () => {
		const failed = await run(
			ATTACHMENT,
			attachmentCase({
				r2: { seed: { [KEY]: { body: admin.PDF } }, fails: ["get"] },
			}),
		);

		expect(seen(failed)).toEqual({
			status: 500,
			body: "Unavailable",
			logs: ["Owner attachment failed unexpectedly: Error r2 get failed"],
		});

		const missing = await run(ATTACHMENT, attachmentCase({ r2: { seed: {} } }));

		expect(seen(missing)).toEqual({
			status: 500,
			body: "Unavailable",
			logs: [
				"Owner attachment failed unexpectedly: Error The attachment's object is missing.",
			],
		});
	});
});

// ---- GET /api/owner/agreements/[id]/file ----

const copyCase = (
	over: Omit<Case, "name" | "steps"> = {},
	setup: string[] = [],
): Omit<Case, "name"> => ({
	music: { seed: admin.downloadSeed() },
	r2: { seed: admin.signedBucket() },
	setup: setup.length ? admin.sql(...setup) : undefined,
	steps: [
		{
			as: asOwner(),
			method: "GET",
			path: "/api/owner/agreements/a1/file",
			params: { id: "a1" },
		},
	],
	...over,
});

describe("GET /api/owner/agreements/[id]/file", () => {
	it.each([
		[
			"the agreement query",
			/FROM software_agreements a JOIN software_agreement_clients/,
		],
		["the artifact query", /SELECT \* FROM software_agreement_artifacts/],
	])(
		"answers a failed read (%s) 500 with its sentence, logged once (B2)",
		async (_name, on) => {
			const record = await run(SIGNED_COPY, copyCase(failing(on)));

			expect(seen(record)).toEqual({
				status: 500,
				body: COPY_UNAVAILABLE,
				logs: logged("Owner signed copy"),
			});
		},
	);

	it("answers a failed bucket read and a ready copy whose object is gone 500, logged once (B2, B8, J1)", async () => {
		const failed = await run(
			SIGNED_COPY,
			copyCase({ r2: { seed: admin.signedBucket(), fails: ["get"] } }),
		);

		expect(seen(failed)).toEqual({
			status: 500,
			body: COPY_UNAVAILABLE,
			logs: ["Owner signed copy failed unexpectedly: Error r2 get failed"],
		});

		const missing = await run(SIGNED_COPY, copyCase({ r2: { seed: {} } }));

		expect(seen(missing)).toEqual({
			status: 500,
			body: COPY_UNAVAILABLE,
			logs: [
				"Owner signed copy failed unexpectedly: Error The ready copy's object is missing.",
			],
		});
	});

	it("keeps the integrity 503, and logs nothing", async () => {
		const record = await run(
			SIGNED_COPY,
			copyCase({
				r2: { seed: { [admin.SIGNED_KEY]: { body: "not the copy" } } },
			}),
		);

		expect(seen(record)).toEqual({
			status: 503,
			body: "Signed copy failed its integrity check. Contact Kazon.",
			logs: [],
		});
	});
});
