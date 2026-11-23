import { afterAll, describe, expect, it } from "vitest";
import { POST as archiveLinkRoute } from "~/pages/api/agreements/link";
import { POST as signingLinkRoute } from "~/pages/api/offer/[token]/link";
import { isObject, isText } from "~/lib/type-guards";
import {
	asVisitor,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
	type Step,
} from "../golden/harness";
import { astroPages } from "../golden/harness/page";
import type { Recorded } from "../golden/harness/plain";
import * as access from "../golden/areas/agreement-access";

// How the two verify pages (src/pages/offer/[token]/verify.astro and src/pages/agreements/verify.astro) and the redeem
// they call (completeAgreementLink, src/lib/agreement-access.ts) answer a failure on the site's side, after the behaviour
// fixes of docs/plans/2026-11-signing-conversion.md, section 5 (B1, B2, B5's verify-page cases), on the owner's decisions
// of 2026-11-14 (an unexpected store failure answers 500, never the error's text, logged once) and 2026-11-23 (Q2's
// failure page). A refusal (a key that names no live link, a guard that raised, a lost race) keeps the 401 and the
// expired page and logs nothing. Each case runs on the golden harness: the real schema on SQLite, the page rendered by
// Astro's container as production renders it, the statements a failure names made to throw.

const pages = await astroPages({
	signing: "src/pages/offer/[token]/verify.astro",
	archive: "src/pages/agreements/verify.astro",
});

afterAll(pages.remove);

const DOWN = "D1_ERROR: private details for grace@example.test";

const FAILED_TITLE = "This link could not be opened.";

const FAILED_TEXT =
	"Something went wrong on my side. Try the link again in a few minutes.";

const EXPIRED_TITLE = "This link has expired.";

const LINK_READ = /SELECT \* FROM software_agreement_links WHERE token_hash=\?/;

const LIVE_CHECK =
	/SELECT CASE WHEN EXISTS\(SELECT 1 FROM software_offers o JOIN software_offer_links/;

const OFFER_READ =
	/SELECT o\.\* FROM software_offers o JOIN software_offer_links/;

const SESSION_INSERT = /INSERT INTO software_agreement_sessions/;

const CONSUME =
	/UPDATE software_agreement_links SET used_at=\? WHERE token_hash=\?/;

/** What a step answered, and every console line the case wrote. */
type Seen = {
	readonly status: number | "rejected";
	readonly body: string;
	readonly headers: { readonly [name: string]: string };
	readonly logs: readonly string[];
};

const isTable = (
	value: Recorded | undefined,
): value is { [key: string]: Recorded } =>
	isObject(value) && !Array.isArray(value);

/** The rows of a music table that a step dumped. */
function dumped(record: CaseRecord, table: string, step: number): Recorded[] {
	const state = record.steps[step]?.state ?? undefined;
	const music = isTable(state) ? state.music : undefined;
	const rows = isTable(music) ? music[table] : undefined;

	return Array.isArray(rows) ? rows : [];
}

const logsOf = (record: CaseRecord) =>
	record.effects.flatMap((effect) =>
		effect.kind === "console" ? [effect.args.map(String).join(" ")] : [],
	);

function seen(record: CaseRecord, step: number): Seen {
	const answer = record.steps[step].answer;

	if (answer.outcome !== "response")
		return { status: "rejected", body: "", headers: {}, logs: logsOf(record) };

	return {
		status: answer.status,
		body: isText(answer.body) ? answer.body : "",
		headers: answer.headers,
		logs: logsOf(record),
	};
}

/** The one line a fault logs: the page's label and the error's name and message, the address in it redacted. */
const logged = (label: string) => [
	`${label} failed unexpectedly: Error D1_ERROR: private details for [email]`,
];

const failing = (on: RegExp, nth = 1) => ({
	failures: [{ on, nth, message: DOWN }],
});

/** The signing link of the offer, issued through its route, as a client asks for it. */
const issueSigning: Step = {
	handler: signingLinkRoute,
	as: asVisitor({ ip: access.IP }),
	path: `/api/offer/${access.TOKEN}/link`,
	params: { token: access.TOKEN },
	json: { turnstileToken: "tok" },
	headers: access.SAME_ORIGIN,
	dump: { music: access.LINK_TABLES },
};

/** The archive link for the client's email, issued through its route. */
const issueArchive: Step = {
	handler: archiveLinkRoute,
	as: asVisitor({ ip: access.IP }),
	path: "/api/agreements/link",
	json: { email: access.GRACE, turnstileToken: "tok" },
	headers: access.SAME_ORIGIN,
	dump: { music: access.LINK_TABLES },
};

type Page = "signing" | "archive";

const visit = (page: Page): access.PageVisit =>
	page === "archive" ? { archive: true } : {};

const label = (page: Page) =>
	page === "archive" ? "Archive verify" : "Agreement verify";

/**
 * A sent offer with its link and signing on, and no session yet; for the archive page, its executed agreements, so the
 * archive link is mailed.
 */
const seedFor = (page: Page) =>
	page === "archive"
		? access.agreementWorld({ session: null, agreements: "executed" })
		: access.agreementWorld({ session: null });

/** A case on one page: the link issued, then the page steps, with the case's own failures or races. */
const run = (
	page: Page,
	steps: readonly Step[],
	over: Omit<Case, "name" | "steps"> = {},
) =>
	runCase(pages.page(page), {
		name: "verify page outage",
		...seedFor(page),
		fetches: access.mail,
		steps: [page === "archive" ? issueArchive : issueSigning, ...steps],
		...over,
	});

const open = (page: Page, extra: Partial<Step> = {}) =>
	access.openPage(visit(page), extra);

const post = (page: Page, extra: Partial<Step> = {}) =>
	access.postPage(visit(page), extra);

/** The failure page: Q2's heading and text, no link to ask for a new one (the emailed link still works). */
function expectFailurePage(answer: Seen, page: Page) {
	expect(answer.status).toBe(500);
	expect(answer.body).toContain(`<h1 class="page-title">${FAILED_TITLE}</h1>`);
	expect(answer.body).toContain(`<p class="page-lede">${FAILED_TEXT}</p>`);
	expect(answer.body).toContain("<title>This link could not be opened</title>");
	expect(answer.body).not.toContain("Send a new link");
	expect(answer.body).not.toContain("D1_ERROR");
	expect(answer.body).not.toContain("private details");
	expect(answer.headers["cache-control"]).toBe("no-store");
	expect(answer.headers["referrer-policy"]).toBe("no-referrer");
	expect(answer.logs).toEqual(logged(label(page)));
}

function expectExpiredPage(answer: Seen) {
	expect(answer.status).toBe(401);
	expect(answer.body).toContain(`<h1 class="page-title">${EXPIRED_TITLE}</h1>`);
	expect(answer.logs).toEqual([]);
}

describe.each<Page>(["signing", "archive"])("the %s verify page", (page) => {
	it("answers a failed link read on a GET with the failure page, logged once (B2)", async () => {
		const record = await run(page, [open(page)], failing(LINK_READ));

		expectFailurePage(seen(record, 1), page);
	});

	it("answers a failed link read on a POST with the failure page, and makes no session (B2)", async () => {
		const record = await run(page, [post(page)], failing(LINK_READ));

		expectFailurePage(seen(record, 1), page);
		expect(dumped(record, "software_agreement_sessions", 1)).toEqual([]);
	});

	it("answers a consume batch that failed for no guard with the failure page, the link left unused (B1)", async () => {
		const record = await run(
			page,
			[post(page), open(page)],
			failing(SESSION_INSERT),
		);

		expectFailurePage(seen(record, 1), page);
		expect(dumped(record, "software_agreement_sessions", 1)).toEqual([]);
		expect(
			dumped(record, "software_agreement_links", 1).map((row) =>
				isTable(row) ? row.used_at : "not a row",
			),
		).toEqual([null]);
		// The emailed link still works, as the failure page says.
		expect(seen(record, 2).status).toBe(200);
	});

	it("keeps the expired page when a guard of the consume batch raised (another tab used the link), and logs nothing", async () => {
		const record = await run(page, [post(page)], {
			interleave: [
				{
					on: CONSUME,
					label: "another tab consumed the link",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_agreement_links SET used_at='${access.NOW}'`,
						),
				},
			],
		});

		expectExpiredPage(seen(record, 1));
		expect(dumped(record, "software_agreement_sessions", 1)).toEqual([]);
	});

	it.each([
		[
			"JSON",
			{
				body: undefined,
				json: (prior) => ({ key: access.pageKey(visit(page))(prior) }),
				headers: access.SAME_ORIGIN,
			},
		],
		[
			"plain text",
			{
				body: (prior) => `key=${access.pageKey(visit(page))(prior)}`,
				headers: access.SAME_ORIGIN,
			},
		],
	] satisfies [string, Partial<Step>][])(
		"answers a POST whose body is %s, not a form, as a POST with no key: the expired page, nothing written (B5)",
		async (_name, extra) => {
			const record = await run(page, [post(page, extra)]);

			expectExpiredPage(seen(record, 1));
			expect(seen(record, 1).body).toContain("Send a new link");
			expect(dumped(record, "software_agreement_sessions", 1)).toEqual([]);
			expect(
				dumped(record, "software_agreement_links", 1).map((row) =>
					isTable(row) ? row.used_at : "not a row",
				),
			).toEqual([null]);
		},
	);

	it("answers a POST whose body is not a form from another host 404, as a POST with no key from there (B5)", async () => {
		const record = await run(page, [
			post(page, {
				origin: "https://www.thesuperhuman.us",
				body: undefined,
				json: (prior) => ({ key: access.pageKey(visit(page))(prior) }),
				headers: { origin: "https://www.thesuperhuman.us" },
			}),
		]);

		const answer = seen(record, 1);

		expect(answer.status).toBe(404);
		expect(answer.body).toContain(
			`<h1 class="page-title">${EXPIRED_TITLE}</h1>`,
		);
		expect(answer.logs).toEqual([]);
	});
});

describe("the signing verify page", () => {
	// The first match of each pattern is the link route's own statement; the second is the page's.
	it("answers a failed live check on a GET with the failure page, logged once (B1)", async () => {
		const record = await run(
			"signing",
			[open("signing")],
			failing(LIVE_CHECK, 2),
		);

		expectFailurePage(seen(record, 1), "signing");
	});

	it("keeps the expired page when the GET's live check refuses (signing switched off), and logs nothing", async () => {
		const record = await run("signing", [
			open("signing", {
				before: {
					label: "signing is switched off",
					run: (w) =>
						w.music.exec(
							"UPDATE software_signing_settings SET software_signing_enabled=0",
						),
				},
			}),
		]);

		expectExpiredPage(seen(record, 1));
	});

	it("answers a failed offer read with the failure page, logged once (B2)", async () => {
		const record = await run(
			"signing",
			[open("signing")],
			failing(OFFER_READ, 2),
		);

		expectFailurePage(seen(record, 1), "signing");
	});

	it("keeps the expired page when the consume batch's live check refuses (the offer superseded since the read)", async () => {
		const record = await run("signing", [post("signing")], {
			interleave: [
				{
					on: CONSUME,
					label: "the offer is superseded",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE software_offers SET status='superseded' WHERE id='o-r1'",
						),
				},
			],
		});

		expectExpiredPage(seen(record, 1));
	});
});

describe("completeAgreementLink, called directly", () => {
	/** A step that follows the emailed link (the golden corpora's `follow`): the redeem's own Response is recorded. */
	const redeem = (handler: Handler, page: Page, over: Partial<Case> = {}) =>
		runCase(handler, {
			name: "redeem outage",
			...seedFor(page),
			fetches: access.mail,
			steps: [
				page === "archive" ? issueArchive : issueSigning,
				access.follow("POST", { archive: page === "archive" }),
			],
			...over,
		});

	it.each<Page>(["signing", "archive"])(
		"answers the %s link's failed consume batch 500 with its JSON, logged once (B1)",
		async (page) => {
			const record = await redeem(access.verify, page, failing(SESSION_INSERT));

			expect(seen(record, 1)).toMatchObject({
				status: 500,
				body: JSON.stringify({ ok: false, error: FAILED_TITLE }),
				logs: logged(label(page)),
			});
		},
	);
});
