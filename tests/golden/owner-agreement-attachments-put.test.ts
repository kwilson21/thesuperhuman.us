import { isObject } from "~/lib/type-guards";
import {
	GET,
	PUT,
} from "~/pages/api/owner/requests/[id]/agreement-attachments";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	generatedBody,
	rows,
	type Case,
	type Prior,
	type Seed,
	type Step,
} from "./harness";
import {
	EMPTY_PDF,
	merge,
	ORIGIN,
	pdfBytes,
	PDF,
	sql,
} from "./areas/agreement-admin";

// The golden corpus for PUT /api/owner/requests/[id]/agreement-attachments: the owner attaches a PDF (an exhibit or a
// client's own paper) to a software offer. The bytes go to R2 under agreements/attachments/<uuid>.pdf with their SHA-256
// as custom metadata, then one batch inserts the metadata row, guarded by the request being software and still open.
//
// Every response branch of the handler (src/pages/api/owner/requests/[id]/agreement-attachments.ts), and its cases:
//
//   403 {ok:false}                       not the owner (visitor, studio client cookie); Origin missing, another host, another scheme
//   503 {ok:false}                       no database, no bucket, neither (answered after the owner check, before Origin)
//   404 {ok:false}                       website signing is off (the settings row says 0)
//   400 "Choose a PDF, version and date."  filename missing, empty, blank, with / or \, over 200, with a control character; version
//                                        missing, empty, over 80; date missing, not a date (Feb 30, 2027-02-29, no zero padding, with a
//                                        time); the content type is not exactly application/pdf (none, a charset, upper case, octet-stream);
//                                        no body at all
//   413 "Keep each PDF under 10 MiB."    one byte over the limit
//   400 "The file must be a PDF."        an empty body, a text body, bytes that do not start with %PDF-
//   400 "The PDF has no pages."          pdf-lib loads it and counts zero pages
//   503 "The PDF could not be validated..."  starts with %PDF- but pdf-lib cannot load it
//   200 {ok:true, attachment}            a PDF, 3 pages, exactly 10 MiB, unicode, markup and trimmed names, a duplicate query key (last wins),
//                                        extra query keys, a date on Feb 29 of a leap year, another owner email
//   503 "The attachment could not be saved."   the bucket put fails, the batch fails (the object is deleted), the guard fails (unknown request,
//                                        a service request, withdrawn, resolved; the object is deleted), the batch and the check fail (the
//                                        object is kept), the batch fails and the bucket delete fails (swallowed)
//   rejected                             the signing-setting read fails (it is outside the try), a missing id param
//   sequences                            upload twice, upload then download then withdraw then download, two requests

const SIGNING_ON =
	"UPDATE software_signing_settings SET software_signing_enabled=1";

const QUERY = { filename: "msa-draft.pdf", version: "2", date: "2026-10-01" };

const BASE = "/api/owner/requests/r1/agreement-attachments";

const put = (
	query: { [name: string]: string } = {},
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	method: "PUT",
	path: `${BASE}?${new URLSearchParams({ ...QUERY, ...query }).toString()}`,
	params: { id: "r1" },
	headers: { origin: ORIGIN, "content-type": "application/pdf" },
	body: PDF,
	dump: { music: ["software_agreement_attachments"], r2: true },
	...extra,
});

const without = (name: keyof typeof QUERY, extra: Partial<Step> = {}): Step => {
	const { [name]: _gone, ...rest } = QUERY;

	return put(
		{},
		{ path: `${BASE}?${new URLSearchParams(rest).toString()}`, ...extra },
	);
};

const request: Seed = {
	owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
};

const scene = (
	name: string,
	step: Step | Step[],
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: merge(request) },
	setup: sql(SIGNING_ON),
	steps: Array.isArray(step) ? step : [step],
	...extra,
});

/** The id of the attachment a step's answer created, read back from the key it reports. */
const idOf = (prior: Prior, step = 0): string => {
	const attachment = prior.answerJson(step).attachment;

	const key =
		isObject(attachment) && "key" in attachment ? String(attachment.key) : "";

	return key.replace(/^agreements\/attachments\//, "").replace(/\.pdf$/, "");
};

const get = (prior: Prior, step = 0) =>
	`${BASE}?attachment=${idOf(prior, step)}`;

const pageCount = async (pages: number) => pdfBytes(pages);

const TEN_MIB = 10 * 1024 * 1024;
const padded = new Uint8Array(TEN_MIB);

padded.set(PDF);

const cases: Case[] = [
	scene("a PDF is attached", put()),
	scene("a PDF with three pages", put({}, { body: await pageCount(3) })),
	scene("a visitor is refused", put({}, { as: asVisitor() })),
	scene(
		"a studio client cookie is refused",
		put({}, { as: asClientCookie("a".repeat(72)) }),
	),
	scene(
		"a visitor with no database is refused before the bindings",
		put({}, { as: asVisitor() }),
		{ music: { missing: true } },
	),
	scene("no database is bound", put(), { music: { missing: true } }),
	scene("no bucket is bound", put(), { r2: { missing: true } }),
	scene("neither database nor bucket", put(), {
		music: { missing: true },
		r2: { missing: true },
	}),
	scene(
		"no Origin header",
		put({}, { headers: { "content-type": "application/pdf" } }),
	),
	scene(
		"another Origin",
		put(
			{},
			{
				headers: {
					origin: "https://evil.example",
					"content-type": "application/pdf",
				},
			},
		),
	),
	scene(
		"the same host over http",
		put(
			{},
			{
				headers: {
					origin: "http://thesuperhuman.us",
					"content-type": "application/pdf",
				},
			},
		),
	),
	scene("website signing is off", put(), { setup: undefined }),
	scene("the signing setting cannot be read", put(), {
		failures: [
			{
				on: /software_signing_enabled FROM software_signing_settings/,
				message: "d1 down",
			},
		],
	}),

	// the query
	scene("filename missing", without("filename")),
	scene("filename empty", put({ filename: "" })),
	scene("filename blank", put({ filename: "   " })),
	scene("filename with a slash", put({ filename: "a/b.pdf" })),
	scene(
		"filename with an encoded slash",
		put({}, { path: `${BASE}?filename=a%2Fb.pdf&version=2&date=2026-10-01` }),
	),
	scene("filename with a backslash", put({ filename: "a\\b.pdf" })),
	scene("filename of 200 characters", put({ filename: "f".repeat(200) })),
	scene("filename of 201 characters", put({ filename: "f".repeat(201) })),
	scene("filename with unicode", put({ filename: "Résumé \u{1F4C4}.pdf" })),
	scene("filename with a control character", put({ filename: "a\u0001b.pdf" })),
	scene("filename decomposed is stored composed", put({ filename: "é.pdf" })),
	scene("filename with markup characters", put({ filename: "<b>&\"'.pdf" })),
	scene(
		"filename with surrounding spaces is trimmed",
		put({ filename: "  a.pdf  " }),
	),
	scene("version missing", without("version")),
	scene("version empty", put({ version: "" })),
	scene("version of 80 characters", put({ version: "v".repeat(80) })),
	scene("version of 81 characters", put({ version: "v".repeat(81) })),
	scene("date missing", without("date")),
	scene("date that is not a day", put({ date: "2026-02-30" })),
	scene("date without zero padding", put({ date: "2026-1-5" })),
	scene("date with a time", put({ date: "2026-10-01T00:00:00Z" })),
	scene("a leap day", put({ date: "2028-02-29" })),
	scene("a non-leap Feb 29", put({ date: "2027-02-29" })),
	scene(
		"a repeated key keeps the last",
		put(
			{},
			{
				path: `${BASE}?filename=a.pdf&filename=b.pdf&version=2&date=2026-10-01`,
			},
		),
	),
	scene("extra query keys are ignored", put({ junk: "1", attachment: "x" })),

	// the body
	scene("no content type", put({}, { headers: { origin: ORIGIN } })),
	scene(
		"a content type with a charset",
		put(
			{},
			{
				headers: {
					origin: ORIGIN,
					"content-type": "application/pdf; charset=binary",
				},
			},
		),
	),
	scene(
		"a content type in upper case",
		put({}, { headers: { origin: ORIGIN, "content-type": "Application/PDF" } }),
	),
	scene(
		"octet-stream",
		put(
			{},
			{
				headers: { origin: ORIGIN, "content-type": "application/octet-stream" },
			},
		),
	),
	scene("no body", put({}, { body: undefined })),
	scene("an empty body", put({}, { body: "" })),
	scene("a text body", put({}, { body: "hello" })),
	scene(
		"bytes that are not a PDF",
		put({}, { body: new Uint8Array([1, 2, 3, 4, 5, 6]) }),
	),
	scene("only the five-byte PDF header", put({}, { body: "%PDF-" })),
	scene(
		"a PDF header over garbage",
		put({}, { body: "%PDF-1.7 this is not a pdf at all" }),
	),
	scene("a PDF with no pages", put({}, { body: EMPTY_PDF })),
	scene("exactly 10 MiB", put({}, { body: padded })),
	scene(
		"one byte over 10 MiB",
		put(
			{},
			{
				body: generatedBody(
					TEN_MIB + 1,
					(index) => "%PDF-".charCodeAt(index) || 0x20,
				),
			},
		),
	),
	scene(
		"a PDF sent as a stream of chunks",
		put(
			{},
			{
				body: new ReadableStream<Uint8Array>({
					start: (controller) => {
						controller.enqueue(PDF.slice(0, 100));
						controller.enqueue(PDF.slice(100));
						controller.close();
					},
				}),
			},
		),
	),

	// the request
	scene(
		"an unknown request",
		put(
			{},
			{
				path: `/api/owner/requests/zz/agreement-attachments?${new URLSearchParams(QUERY).toString()}`,
				params: { id: "zz" },
			},
		),
	),
	scene("a service request", put(), {
		music: {
			seed: { owner_requests: [rows.ownerRequest("r1", { kind: "service" })] },
		},
	}),
	scene("a withdrawn software request", put(), {
		music: {
			seed: {
				owner_requests: [rows.softwareRequest("r1", { status: "withdrawn" })],
			},
		},
	}),
	scene("a resolved software request", put(), {
		music: {
			seed: {
				owner_requests: [rows.softwareRequest("r1", { status: "resolved" })],
			},
		},
	}),
	scene("a new software request", put(), {
		music: {
			seed: { owner_requests: [rows.softwareRequest("r1", { status: "new" })] },
		},
	}),
	scene("no id param", put({}, { params: {} })),
	scene(
		"an id that looks like SQL",
		put({}, { params: { id: "r1' OR '1'='1" } }),
	),
	scene(
		"another owner email is recorded",
		put({}, { as: asOwner("other@example.test") }),
	),

	// outages
	scene("the bucket put fails", put(), { r2: { fails: ["put"] } }),
	scene("the batch fails and the object is deleted", put(), {
		failures: [
			{ on: /INSERT INTO software_agreement_attachments/, message: "d1 down" },
		],
	}),
	scene(
		"the batch fails and the check fails too, so the object is kept",
		put(),
		{
			failures: [
				{
					on: /INSERT INTO software_agreement_attachments/,
					message: "d1 down",
				},
				{
					on: /SELECT 1 FROM software_agreement_attachments WHERE id/,
					message: "d1 down",
				},
			],
		},
	),
	scene("the batch fails and the bucket delete fails", put(), {
		failures: [
			{ on: /INSERT INTO software_agreement_attachments/, message: "d1 down" },
		],
		r2: { fails: ["delete"] },
	}),
	scene("the request is withdrawn just before the batch", put(), {
		interleave: [
			{
				on: /INSERT INTO software_agreement_attachments/,
				label: "the request is withdrawn",
				run: (sqlite) =>
					sqlite.exec(
						"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
					),
			},
		],
	}),

	// sequences
	scene("the same PDF twice makes two attachments", [
		put(),
		put({}, { advanceMs: 1000 }),
	]),
	scene(
		"a PDF for two requests",
		[
			put(),
			put(
				{},
				{
					path: `/api/owner/requests/r2/agreement-attachments?${new URLSearchParams(QUERY).toString()}`,
					params: { id: "r2" },
				},
			),
		],
		{
			music: {
				seed: {
					owner_requests: [
						rows.softwareRequest("r1", { status: "reviewed" }),
						rows.softwareRequest("r2", {
							status: "reviewed",
							email: "ada@example.test",
						}),
					],
				},
			},
		},
	),
	scene("a rejected file, then a good one", [
		put({}, { body: "hello" }),
		put(),
	]),
	scene("an attachment then the request is withdrawn then another upload", [
		put(),
		put(
			{},
			{
				before: {
					label: "the request is withdrawn",
					run: sql(
						"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
					),
				},
			},
		),
	]),
	scene("an attachment is read back by the owner", [
		put(),
		put(
			{},
			{
				handler: GET,
				method: "GET",
				path: (prior) => get(prior),
				body: undefined,
				headers: {},
			},
		),
	]),
];

defineCorpus("owner-agreement-attachments-put", PUT, cases);
