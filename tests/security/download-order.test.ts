import { expect, it } from "vitest";
import { agreementDownload } from "~/lib/agreement-download";
import { double, fakeD1, partial } from "../helpers/doubles";

// A visitor with no valid session learns nothing about which agreement ids exist: the session is checked first and the
// answer is the same for a known and an unknown id.

function world(known: boolean) {
	const sql: string[] = [];

	const db = fakeD1({
		prepare: (query: string) => {
			sql.push(query);

			return partial<D1PreparedStatement>({
				bind: () =>
					partial<D1PreparedStatement>({
						first: async () =>
							known && /FROM software_agreements a JOIN/.test(query)
								? {
										id: "a1",
										offer_id: "o1",
										request_id: "r1",
										recipient_email: "a@example.test",
									}
								: null,
					}),
			});
		},
	});

	const env = partial<Env>({ MUSIC_DB: db, AUDIO: double<R2Bucket>({}) });

	return { env, sql };
}

const visit = async (known: boolean, headers: HeadersInit = {}) => {
	const { env, sql } = world(known);

	const response = await agreementDownload(
		env,
		new Request("https://thesuperhuman.us/api/agreements/a1/file", { headers }),
		"a1",
	);

	return { status: response.status, body: await response.text(), sql };
};

it("answers a visitor with no session the same for a known and an unknown id", async () => {
	const known = await visit(true);
	const unknown = await visit(false);

	expect(known.status).toBe(401);
	expect(unknown.status).toBe(401);
	expect(unknown.body).toBe(known.body);
	expect(known.body).toBe("Verify your agreement email first.");
});

it("does not look the agreement up before the visitor has a session", async () => {
	const { sql } = await visit(true);

	expect(sql.filter((query) => /software_agreements/.test(query))).toEqual([]);
});

it("keeps the owner's 404 for an unknown id", async () => {
	const { env } = world(false);

	const response = await agreementDownload(
		env,
		new Request("https://thesuperhuman.us/api/owner/agreements/a1/file"),
		"a1",
		true,
	);

	expect(response.status).toBe(404);
});

// A visitor with a verified session is not told to verify again. Whatever they cannot download answers the same 404, so
// they cannot tell a known id from an unknown one either.

const TOKEN = "a".repeat(43);

type Row = { [column: string]: string } | null;

function verified(agreement: Row) {
	const db = fakeD1({
		prepare: (query: string) =>
			partial<D1PreparedStatement>({
				bind: () =>
					partial<D1PreparedStatement>({
						first: async () =>
							/FROM software_agreement_sessions/.test(query)
								? {
										recipient_email: "me@example.test",
										offer_id: "o-mine",
										token_hash: "h",
									}
								: /FROM software_agreements a JOIN/.test(query)
									? agreement
									: null,
					}),
			}),
	});

	return agreementDownload(
		partial<Env>({ MUSIC_DB: db, AUDIO: double<R2Bucket>({}) }),
		new Request("https://thesuperhuman.us/api/agreements/a1/file", {
			headers: { cookie: `agreement_archive=${TOKEN}` },
		}),
		"a1",
	);
}

const answer = async (response: Response) => ({
	status: response.status,
	body: await response.text(),
});

it.each([
	// The lookup only finds executed agreements that are not closed, so an agreement still in review and one closed by
	// retention come back as no row, as an unknown id does.
	["an unknown id", null],
	["their own agreement still in review", null],
	["their own agreement closed by retention", null],
	[
		"someone else's agreement",
		{
			id: "a1",
			offer_id: "o-other",
			request_id: "r-other",
			recipient_email: "other@example.test",
		},
	],
])("answers a verified visitor 404 for %s", async (_name, agreement) => {
	expect(await answer(await verified(agreement))).toEqual({
		status: 404,
		body: "Not found",
	});
});
