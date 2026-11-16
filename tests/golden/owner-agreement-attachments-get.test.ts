import { GET } from "~/pages/api/owner/requests/[id]/agreement-attachments";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type Step,
} from "./harness";
import {
	attachmentKey,
	attachmentRow,
	EARLIER,
	PDF,
	sql,
} from "./areas/agreement-admin";

// The golden corpus for GET /api/owner/requests/[id]/agreement-attachments?attachment=<id>: the owner downloads an offer
// attachment. The route does not look at the request's state, the signing setting or the bytes' digest.
//
// Every response branch of the handler (src/pages/api/owner/requests/[id]/agreement-attachments.ts), and its cases:
//
//   403 "Forbidden" (no agreement headers)   a visitor, a studio client cookie, a visitor sending an agreement cookie
//   404 "Not found"                          no attachment query key, an empty value, an unknown id, an attachment of another request, no
//                                            database bound (the optional call answers undefined), an id that looks like SQL, a very long
//                                            id, a unicode id, an upper-case id, the request id missing
//   503 "Unavailable"                        the stored object is missing
//   200 application/pdf, attachment agreement-attachment.pdf, nosniff, agreement headers
//                                            the stored bytes, tampered bytes (never re-hashed), an unusual stored filename (not used in the
//                                            header), a duplicate query key (first wins), Range ignored, a withdrawn request, a service request,
//                                            signing switched off, an object key that points at another attachment's object
//   rejected                                 no bucket bound, the bucket read fails, the database query fails
//   sequences                                twice in a row

const KEY = attachmentKey("att1");

const get = (id: string | null = "att1", extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	method: "GET",
	path: `/api/owner/requests/r1/agreement-attachments${id === null ? "" : `?attachment=${encodeURIComponent(id)}`}`,
	params: { id: "r1" },
	...extra,
});

const seeded: Seed = {
	owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	software_agreement_attachments: [
		attachmentRow("att1", "r1", { created_at: EARLIER }),
	],
};

const scene = (
	name: string,
	step: Step | Step[] = get(),
	setup: string[] = [],
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: seeded },
	r2: { seed: { [KEY]: { body: PDF } } },
	setup: setup.length ? sql(...setup) : undefined,
	steps: Array.isArray(step) ? step : [step],
	...extra,
});

const cases: Case[] = [
	scene("the owner downloads the attachment"),
	scene("a visitor is refused", get("att1", { as: asVisitor() })),
	scene(
		"a studio client cookie is refused",
		get("att1", { as: asClientCookie("a".repeat(72)) }),
	),
	scene(
		"a visitor with an agreement cookie is refused",
		get("att1", {
			as: asVisitor(),
			headers: { cookie: `agreement_session=${"Q".repeat(43)}` },
		}),
	),
	scene("no attachment key in the query", get(null)),
	scene("an empty attachment value", get("")),
	scene("an unknown attachment id", get("nope")),
	scene("an attachment id that looks like SQL", get("att1' OR '1'='1")),
	scene("a very long attachment id", get("a".repeat(2000))),
	scene("a unicode attachment id", get("ä😀")),
	scene("an upper-case attachment id", get("ATT1")),
	scene(
		"an attachment of another request",
		get("att1", {
			path: "/api/owner/requests/r2/agreement-attachments?attachment=att1",
			params: { id: "r2" },
		}),
	),
	scene("no request id param", get("att1", { params: {} })),
	scene("no database is bound", get(), [], { music: { missing: true } }),
	scene("the stored object is missing", get(), [], { r2: { seed: {} } }),
	scene("tampered bytes are served without a digest check", get(), [], {
		r2: { seed: { [KEY]: { body: "not the original" } } },
	}),
	scene("an unusual stored filename never reaches the header", get(), [
		`UPDATE software_agreement_attachments SET filename='a"b\\n"cé\u{1F600}.pdf' WHERE id='att1'`,
	]),
	scene(
		"the first of two attachment keys wins",
		get("att1", {
			path: "/api/owner/requests/r1/agreement-attachments?attachment=att1&attachment=nope",
		}),
	),
	scene("Range is ignored", get("att1", { headers: { range: "bytes=0-9" } })),
	scene("a withdrawn request still serves it", get(), [
		"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
	]),
	scene("a service request still serves it", get(), [
		"UPDATE owner_requests SET kind='service' WHERE id='r1'",
	]),
	scene("signing switched off still serves it", get(), [
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	]),
	scene(
		"an object key that points at another attachment's object",
		get(),
		[
			`UPDATE software_agreement_attachments SET object_key='${attachmentKey("att2")}' WHERE id='att1'`,
		],
		{ r2: { seed: { [attachmentKey("att2")]: { body: PDF } } } },
	),
	scene("no bucket is bound", get(), [], { r2: { missing: true } }),
	scene("the bucket read fails", get(), [], {
		r2: { seed: { [KEY]: { body: PDF } }, fails: ["get"] },
	}),
	scene("the database query fails", get(), [], {
		failures: [
			{
				on: /SELECT object_key FROM software_agreement_attachments/,
				message: "d1 down",
			},
		],
	}),
	scene("two downloads in a row", [get(), get("att1", { advanceMs: 1000 })]),
	scene("a refusal then a success", [get("att1", { as: asVisitor() }), get()]),
];

defineCorpus("owner-agreement-attachments-get", GET, cases);
