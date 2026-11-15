import { describe, expect, it } from "vitest";
import { GET as fileGET } from "~/pages/api/agreements/[id]/file";
import { GET as attachmentGET } from "~/pages/api/agreements/attachments/[id]";
import { boundStatement, preparedStatement } from "../helpers/d1";
import { double, fakeD1 } from "../helpers/doubles";

// Non-interference of the two download routes for a verified visitor. Whatever a visitor observes (the status, the headers,
// the body, and the sequence of database statements with their arguments and bucket calls) is the same for an unknown id
// as for an agreement or attachment that belongs to someone else, and the same for a session that is not theirs. The
// answer may differ only for what the visitor is allowed to know: their own agreement.

const CLOCK = /^\d{4}-\d\d-\d\dT/;

const TOKEN = "a".repeat(43);
const STUDIO = "b".repeat(72);

type Row = Record<string, string | number | null>;

type Seen = {
	readonly statements: { readonly query: string; readonly args: unknown[] }[];
	readonly buckets: string[];
};

const FAR = "9999-12-31T00:00:00.000Z";

/** Serves one request against a world: the rows a statement finds, and the bucket. Records every call in order. */
function serve(input: {
	readonly path: "file" | "attachment";
	readonly id: string;
	readonly cookie: string;
	readonly agreement: Row | null;
	readonly pinned?: Row | null;
	readonly attachmentOffer?: Row | null;
	readonly artifact?: Row | null;
	readonly projects?: Row[];
	readonly studioEmail?: string;
}): Promise<{
	readonly status: number;
	readonly headers: [string, string][];
	readonly body: string;
	readonly seen: Seen;
}> {
	const seen: Seen = { statements: [], buckets: [] };

	const rowsFor = (query: string, args: unknown[]): Row[] => {
		if (/FROM software_agreement_sessions/.test(query))
			return [
				{
					token_hash: "h",
					purpose: String(args[1]),
					offer_id: "o-mine",
					link_hash: "l",
					recipient_email: "me@example.test",
					verified_at: "2026-01-01T00:00:00.000Z",
					expires_at: FAR,
					revoked_at: null,
					csrf_nonce: "n",
				},
			];

		if (/FROM software_offers o JOIN software_offer_links/.test(query))
			return [
				{
					offer_status: "sent",
					link_revoked_at: null,
					request_status: "open",
					recipient_email_snapshot: "me@example.test",
				},
			];

		if (/FROM audio_client_sessions/.test(query))
			return [
				{
					email: input.studioEmail ?? "me@example.test",
					expires_at: FAR,
					revoked_at: null,
				},
			];

		if (/FROM software_agreement_attachments/.test(query))
			return input.pinned ? [input.pinned] : [];

		if (
			/SELECT request_id,agreement_details_json FROM software_offers/.test(
				query,
			)
		)
			return input.attachmentOffer ? [input.attachmentOffer] : [];

		if (/SELECT reused_msa_id FROM software_offers/.test(query))
			return [{ reused_msa_id: null }];

		if (
			/FROM software_agreements a JOIN software_agreement_clients/.test(query)
		)
			return input.agreement ? [input.agreement] : [];

		if (/FROM software_agreement_artifacts/.test(query))
			return input.artifact ? [input.artifact] : [];

		if (/FROM software_projects/.test(query)) return input.projects ?? [];

		return [];
	};

	// SAFETY: the code under test names the row type it reads; the world serves the rows for that statement as plain objects.
	const resultOf = <T>(rows: Row[]): D1Result<T> =>
		double<D1Result<T>>({ success: true, results: rows as T[] });

	const record = <T>(query: string, args: unknown[]) => {
		// A clock reading differs between two runs; the instant itself is not what a visitor could compare.
		seen.statements.push({
			query,
			args: args.map((arg) => (CLOCK.test(String(arg)) ? "<time>" : arg)),
		});

		return resultOf<T>(rowsFor(query, args));
	};

	const db = fakeD1({
		prepare: (query: string) =>
			preparedStatement(query, [], (text, args) => ({
				all: async <T>() => record<T>(text, args),
			})),
		batch: async <T>(items: D1PreparedStatement[]) =>
			items.map((item) => {
				const { query, args } = boundStatement(item);

				return record<T>(query, args);
			}),
	});

	const bucket = double<R2Bucket>({
		get: async (key: string) => {
			seen.buckets.push(key);

			return null;
		},
	});

	const env = double<Parameters<typeof fileGET>[0]["locals"]["runtime"]["env"]>(
		{
			MUSIC_DB: db,
			AUDIO: bucket,
		},
	);

	const request = new Request(
		`https://thesuperhuman.us/api/agreements/${input.id}/file`,
		{
			headers: { cookie: input.cookie },
		},
	);

	const context = double<Parameters<typeof fileGET>[0]>({
		locals: double<Parameters<typeof fileGET>[0]["locals"]>({
			runtime: double<Parameters<typeof fileGET>[0]["locals"]["runtime"]>({
				env,
			}),
		}),
		request,
		params: { id: input.id },
	});

	const run = Promise.resolve(
		input.path === "file" ? fileGET(context) : attachmentGET(context),
	);

	return run.then(async (response) => ({
		status: response.status,
		headers: [...response.headers.entries()],
		body: await response.text(),
		seen,
	}));
}

const theirs = {
	id: "a1",
	offer_id: "o-other",
	request_id: "r-other",
	recipient_email: "other@example.test",
	status: "executed",
	archive_closed_at: null,
};

const sameClientOtherOffer = {
	id: "a1",
	offer_id: "o-other",
	request_id: "r-other",
	recipient_email: "me@example.test",
	status: "executed",
	archive_closed_at: null,
};

const project = (over: Row = {}) => ({
	request_id: "r-mine",
	agreement_id: "a-mine",
	linked_msa_id: null,
	request_status: "open",
	request_email: "me@example.test",
	revoked_at: null,
	content_deleted_at: null,
	...over,
});

const mine = {
	id: "a-mine",
	offer_id: "o-mine-agreement",
	request_id: "r-mine",
	recipient_email: "me@example.test",
	status: "executed",
	archive_closed_at: null,
};

describe("the file route for a verified visitor", () => {
	it("answers and reads the same for an unknown id and someone else's agreement", async () => {
		const unknown = await serve({
			path: "file",
			id: "a1",
			cookie: `agreement_archive=${TOKEN}`,
			agreement: null,
		});

		const other = await serve({
			path: "file",
			id: "a1",
			cookie: `agreement_archive=${TOKEN}`,
			agreement: theirs,
		});

		expect(other).toEqual(unknown);
		expect(unknown.status).toBe(404);
	});

	it("answers and reads the same for an unknown id and a signing session's other offer", async () => {
		const unknown = await serve({
			path: "file",
			id: "a1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
		});

		const other = await serve({
			path: "file",
			id: "a1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: sameClientOtherOffer,
		});

		expect(other).toEqual(unknown);
	});

	it("answers and reads the same for an unknown id and another client's studio project", async () => {
		const unknown = await serve({
			path: "file",
			id: "a1",
			cookie: `studio_session=${STUDIO}`,
			agreement: null,
		});

		const other = await serve({
			path: "file",
			id: "a1",
			cookie: `studio_session=${STUDIO}`,
			agreement: theirs,
		});

		expect(other).toEqual(unknown);
	});

	it("reads the same for a studio visitor with projects, whether the id is unknown or another client's", async () => {
		const projects = [project(), project({ request_id: "r-second" })];

		const unknown = await serve({
			path: "file",
			id: "a1",
			cookie: `studio_session=${STUDIO}`,
			agreement: null,
			projects,
		});

		const other = await serve({
			path: "file",
			id: "a1",
			cookie: `studio_session=${STUDIO}`,
			agreement: theirs,
			projects,
		});

		expect(other).toEqual(unknown);
		expect(unknown.status).toBe(404);

		expect(
			unknown.seen.statements.some((s) =>
				/FROM software_projects/.test(s.query),
			),
		).toBe(true);
	});

	it("lets a studio visitor reach the copy of their own project's agreement", async () => {
		const own = await serve({
			path: "file",
			id: "a-mine",
			cookie: `studio_session=${STUDIO}`,
			agreement: mine,
			projects: [project()],
			artifact: { status: "ready", pdf_key: "k", pdf_sha256: "d" },
		});

		expect(own.seen.buckets).toEqual(["k"]);
	});

	it("treats a studio session with an empty email as a verified visitor who is shown nothing", async () => {
		const empty = await serve({
			path: "file",
			id: "a1",
			cookie: `studio_session=${STUDIO}`,
			agreement: theirs,
			studioEmail: "",
		});

		// Not the 401 a visitor with no session gets: the session exists, and the agreement is not theirs.
		expect(empty.status).toBe(404);
		expect(empty.body).toBe("Not found");
	});

	it("reads no bucket object for anything it refuses", async () => {
		const other = await serve({
			path: "file",
			id: "a1",
			cookie: `agreement_archive=${TOKEN}`,
			agreement: theirs,
		});

		expect(other.seen.buckets).toEqual([]);
	});

	it("asks for a verification before it looks the agreement up", async () => {
		const none = await serve({
			path: "file",
			id: "a1",
			cookie: "",
			agreement: theirs,
		});

		const unknown = await serve({
			path: "file",
			id: "a1",
			cookie: "",
			agreement: null,
		});

		expect(none.status).toBe(401);
		expect(none).toEqual(unknown);
		expect(
			none.seen.statements.some((s) =>
				/software_agreements a JOIN/.test(s.query),
			),
		).toBe(false);
	});
});

describe("the attachment route for a signing session", () => {
	it("answers and reads the same for an unknown attachment and another request's", async () => {
		const unknown = await serve({
			path: "attachment",
			id: "a1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
			pinned: null,
		});

		const other = await serve({
			path: "attachment",
			id: "a1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: theirs,
			pinned: null,
		});

		expect(other.status).toBe(404);
		expect(other.body).toBe(unknown.body);
		expect(other.headers).toEqual(unknown.headers);
		expect(other.seen.buckets).toEqual([]);
		expect(other.seen).toEqual(unknown.seen);
	});

	it("reads the same for an unknown id and an attachment of another request, with the offer's details present", async () => {
		const offer = {
			request_id: "r-mine",
			agreement_details_json: JSON.stringify({
				attachments: [{ key: "k-other", sha256: "d-other" }],
			}),
		};

		const unknown = await serve({
			path: "attachment",
			id: "att-unknown",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
			pinned: null,
			attachmentOffer: offer,
		});

		const other = await serve({
			path: "attachment",
			id: "att-unknown",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
			pinned: {
				request_id: "r-other",
				object_key: "k-other",
				sha256: "d-other",
			},
			attachmentOffer: offer,
		});

		expect(other.status).toBe(404);
		expect(other).toEqual(unknown);
		expect(other.seen.buckets).toEqual([]);
	});

	it("answers its fixed 500 for an offer whose details are not JSON, only when the attachment is the offer's request's", async () => {
		const offer = { request_id: "r-mine", agreement_details_json: "{not json" };

		const own = await serve({
			path: "attachment",
			id: "att-1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
			pinned: { request_id: "r-mine", object_key: "k", sha256: "d" },
			attachmentOffer: offer,
		});

		const other = await serve({
			path: "attachment",
			id: "att-1",
			cookie: `agreement_session=${TOKEN}`,
			agreement: null,
			pinned: { request_id: "r-other", object_key: "k", sha256: "d" },
			attachmentOffer: offer,
		});

		expect(own.status).toBe(500);
		expect(own.body).toBe("Unavailable");
		expect(other.status).toBe(404);
	});
});
