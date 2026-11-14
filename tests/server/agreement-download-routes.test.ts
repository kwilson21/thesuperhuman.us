import { describe, expect, it } from "vitest";
import { GET as fileGET } from "~/pages/api/agreements/[id]/file";
import { GET as attachmentGET } from "~/pages/api/agreements/attachments/[id]";
import { double, fakeD1, partial } from "../helpers/doubles";

// Non-interference of the two download routes for a verified visitor. Whatever a visitor observes (the status, the headers,
// the body, and the sequence of database statements with their arguments and bucket calls) is the same for an unknown id
// as for an agreement or attachment that belongs to someone else, and the same for a session that is not theirs. The
// answer may differ only for what the visitor is allowed to know: their own agreement.

const CLOCK = /^\d{4}-\d\d-\d\dT/;

const TOKEN = "a".repeat(43);
const STUDIO = "b".repeat(72);

type Row = Record<string, string | number | null> | null;

type Seen = {
	readonly statements: { readonly query: string; readonly args: unknown[] }[];
	readonly buckets: string[];
};

/** Serves one request against a world: the rows a statement finds, and the bucket. Records every call in order. */
function serve(input: {
	readonly path: "file" | "attachment";
	readonly id: string;
	readonly cookie: string;
	readonly agreement: Row;
	readonly pinned?: Row;
	readonly artifact?: Row;
	readonly linkedProject?: Row;
}): Promise<{
	readonly status: number;
	readonly headers: [string, string][];
	readonly body: string;
	readonly seen: Seen;
}> {
	const seen: Seen = { statements: [], buckets: [] };

	const answer = (query: string): Row => {
		if (/FROM software_agreement_sessions/.test(query))
			return {
				recipient_email: "me@example.test",
				offer_id: "o-mine",
				token_hash: "h",
			};

		if (
			/FROM software_offer_links|FROM software_offers o JOIN software_offer_links/.test(
				query,
			)
		)
			return { ok: 1 };

		if (/FROM audio_client_sessions/.test(query))
			return { email: "me@example.test" };

		if (/FROM software_agreement_attachments a JOIN/.test(query))
			return input.pinned ?? null;

		if (/FROM software_agreements a JOIN/.test(query)) return input.agreement;

		if (/FROM software_agreement_artifacts/.test(query))
			return input.artifact ?? null;

		if (/FROM software_projects/.test(query))
			return input.linkedProject ?? null;

		return null;
	};

	const db = fakeD1({
		prepare: (query: string) =>
			partial<D1PreparedStatement>({
				bind: (...args: unknown[]) => {
					// A clock reading differs between two runs; the instant itself is not what a visitor could compare.
					seen.statements.push({
						query,
						args: args.map((arg) => (CLOCK.test(String(arg)) ? "<time>" : arg)),
					});

					return partial<D1PreparedStatement>({
						first: async () => answer(query),
						all: async <T>() =>
							double<D1Result<T>>({ success: true, results: [] }),
					});
				},
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

const theirs: Row = {
	id: "a1",
	offer_id: "o-other",
	request_id: "r-other",
	recipient_email: "other@example.test",
};

const sameClientOtherOffer: Row = {
	id: "a1",
	offer_id: "o-other",
	request_id: "r-other",
	recipient_email: "me@example.test",
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
		expect(other.seen.buckets).toEqual([]);
		expect(other.seen.statements.map((s) => s.query)).toEqual(
			unknown.seen.statements.map((s) => s.query),
		);
	});
});
