// What the offer board's route reads from and writes to MUSIC_DB (docs/plans/2026-11-offer-board.md, section 5): the
// request and its brief, the owner's fit review, whether a project has started, the owner's count for the day (in
// `brief_suggestion_budget`, under OFFER_OWNER_SCOPE) and its guarded reservation, and the owner's past sent offers for
// the pricing panel. A read decides nothing; the rule in src/server/rules/offer-board.ts decides. Any database failure is
// an OfferStoreFailed, which the route answers with its fixed sentence.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type { JsonValue } from "../lib/json-value";
import { pricingKind } from "../lib/offer-board";
import { offerTotal } from "../lib/offer-pricing";
import { softwareQuestions } from "../lib/software-inquiry";
import type { PricingKind } from "../lib/pricing-reference";
import { ChangedSinceRead, raisedByJsonGuard } from "./guarded-save";
import type { OfferFacts, OfferReservation } from "./rules/offer-board";
import { OFFER_OWNER_SCOPE } from "./rules/offer-board";
import { MusicDb } from "./services";

/** The database failed. The error carries no text. */
export class OfferStoreFailed extends Data.TaggedError("OfferStoreFailed") {}

const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: () => new OfferStoreFailed(),
		});
	});

/** The brief as the model may read it: never the name, email, company or the current site's address. */
export type OfferBrief = {
	readonly kind: PricingKind;
	/** The path's written answers, by field name. */
	readonly answers: Readonly<Record<string, string>>;
	/** The brief's outline as stored with it, as text. */
	readonly outline: string;
	readonly existing: string;
	readonly updates: string;
	readonly timing: string;
	readonly timingDate: string;
	readonly budgetNote: string;
	readonly fitLabel: string;
	readonly fitNote: string;
	/**
	 * The client's name, email, company and current site as entered (the site also by its host). Never sent: wherever
	 * one appears in what the model reads, it is replaced first (`withheldFrom` in ./offer-board-model).
	 */
	readonly withheld: readonly { readonly text: string; readonly as: string }[];
};

/** The request's facts for the rule, and its brief for the model when it is a software brief the board prices. */
export type OfferRead = {
	readonly facts: OfferFacts;
	readonly brief: OfferBrief | null;
};

const textOf = (details: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = details[key];

	return Predicate.isString(value) ? value.slice(0, 4000) : "";
};

type RequestRow = {
	readonly name: string;
	readonly email: string;
	readonly kind: string;
	readonly status: string;
	readonly details_json: string;
	readonly started: number;
	readonly count: number;
	readonly fit_label: string | null;
	readonly fit_note: string | null;
};

/** The request's facts for the rule and its brief for the model, in one read; null when there is no such request. */
export const readOfferRequest = (id: string, day: string) =>
	asked((db) =>
		db
			.prepare(
				`SELECT r.name, r.email, r.kind, r.status, r.details_json,
          EXISTS (SELECT 1 FROM software_projects WHERE request_id = r.id) AS started,
          COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?2 AND scope = ?3), 0) AS count,
          f.label AS fit_label, f.note AS fit_note
        FROM owner_requests r LEFT JOIN software_fit_reviews f ON f.request_id = r.id
        WHERE r.id = ?1`,
			)
			.bind(id, day, OFFER_OWNER_SCOPE)
			.first<RequestRow>(),
	).pipe(
		Effect.map((row): OfferRead => {
			// No such software request: the rule refuses it (OfferRequestMissing), so the read decides nothing.
			if (!row || row.kind !== "software")
				return {
					facts: {
						found: false,
						kind: null,
						status: "",
						started: false,
						count: 0,
					},
					brief: null,
				};

			let details: Readonly<Record<string, JsonValue>> = {};

			try {
				const parsed: JsonValue = JSON.parse(row.details_json);

				if (Predicate.isObject(parsed) && !Array.isArray(parsed))
					details = parsed;
			} catch {
				// An unreadable brief has no path, so the rule refuses it.
			}

			const kind = pricingKind(details.path);

			const facts: OfferFacts = {
				found: true,
				kind,
				status: row.status,
				started: row.started === 1,
				count: row.count,
			};

			const brief: OfferBrief | null = kind
				? {
						kind,
						answers: Object.fromEntries(
							// The brief's written questions, never the current site's address; existing content and who
							// updates it are sent on their own below.
							softwareQuestions[kind].flatMap((key) =>
								key === "currentUrl" || key === "existing" || key === "updates"
									? []
									: [[key, textOf(details, key)]],
							),
						),
						outline: outlineText(details.outline),
						existing: textOf(details, "existing"),
						updates: textOf(details, "updates"),
						timing: textOf(details, "timing"),
						timingDate: textOf(details, "timingDate"),
						budgetNote: textOf(details, "budgetNote"),
						fitLabel: row.fit_label ?? "",
						fitNote: row.fit_note ?? "",
						withheld: withheldOf(row, details),
					}
				: null;

			return { facts, brief };
		}),
	);

/** Mail services whose domain says nothing about who the client is. */
const FREE_MAIL = new Set([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"ymail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"gmx.com",
	"gmx.de",
	"gmx.net",
	"web.de",
	"mail.com",
	"yandex.com",
	"yandex.ru",
	"zoho.com",
	"fastmail.com",
	"hey.com",
	"tutanota.com",
	"qq.com",
	"163.com",
	"naver.com",
]);

/** What stands in for the client's details where they appear in text the model reads. */
const CLIENT = "the client";
const CLIENT_SITE = "the client’s current site";

/**
 * The client's name, email, company and current site, each with what replaces it. The site is withheld in every form a
 * text may give it: as entered; without its scheme, "www." or a trailing slash ("facebook.com/AcmeBakery"); its host as
 * typed ("bücher.de") and as the browser reads it ("xn--bcher-kva.de"). The email's own domain is withheld as a site too,
 * unless it is a free mail service.
 */
function withheldOf(
	row: RequestRow,
	details: Readonly<Record<string, JsonValue>>,
): OfferBrief["withheld"] {
	const site = textOf(details, "currentUrl").trim();

	const bare = site
		.replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
		.replace(/^www\./i, "");

	const typedHost = bare.split(/[/:?#]/)[0] ?? "";
	let readHost = "";

	try {
		readHost = new URL(`https://${bare}`).hostname.replace(/^www\./i, "");
	} catch {
		// Not a link: the text itself is withheld.
	}

	// The email's domain names the client too ("jane@acmebakery.com"), unless it is a free mail service.
	const mailDomain = row.email.split("@")[1]?.trim().toLowerCase() ?? "";
	const ownDomain = FREE_MAIL.has(mailDomain) ? "" : mailDomain;

	const forms = [
		site,
		site.replace(/\/+$/, ""),
		...[bare, typedHost, readHost, ownDomain].flatMap((form) => [
			form,
			form.replace(/\/+$/, ""),
			form && `www.${form}`,
		]),
	];

	const seen = new Set<string>();

	return [
		{ text: row.name, as: CLIENT },
		{ text: row.email, as: CLIENT },
		{ text: textOf(details, "company"), as: CLIENT },
		...forms.map((text) => ({ text, as: CLIENT_SITE })),
	].flatMap(({ text, as }) => {
		const trimmed = String(text ?? "").trim();
		const key = trimmed.toLowerCase();

		if (trimmed.length < 2 || seen.has(key)) return [];
		seen.add(key);

		return [{ text: trimmed, as }];
	});
}

/** The stored outline as lines of "lane: text", for the model; empty when there is none. */
function outlineText(raw: JsonValue | undefined): string {
	if (!Array.isArray(raw)) return "";

	return raw
		.flatMap((item) =>
			Predicate.isObject(item) &&
			!Array.isArray(item) &&
			Predicate.isString(item.lane) &&
			Predicate.isString(item.text)
				? [`${item.lane}: ${item.text}`]
				: [],
		)
		.slice(0, 20)
		.join("\n");
}

/**
 * Counts one suggestion for the owner, in one batch. The guard raises (the site's form, `json_extract` of a sentence)
 * unless the count is still under the limit, and the batch then writes nothing: that is ChangedSinceRead. The brief
 * board's guard with one scope; verification/daily-allowance.qnt checks both under concurrent requests.
 */
export const reserveOfferBudget = (write: OfferReservation) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(
							`SELECT CASE WHEN
                COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?1 AND scope = ?2), 0) < ?3
              THEN 1 ELSE json_extract('Offer budget changed', '$') END`,
						)
						.bind(write.day, write.scope, write.limit),
					db
						.prepare(
							`INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, 1)
              ON CONFLICT (day, scope) DO UPDATE SET count = count + 1`,
						)
						.bind(write.day, write.scope),
				]),
			catch: (cause) =>
				cause instanceof Error && raisedByJsonGuard(cause)
					? new ChangedSinceRead()
					: new OfferStoreFailed(),
		});
	});

/** One of the owner's sent offers, for the pricing panel: its total, what it was for and when it was sent. */
export type PastOffer = {
	readonly totalCents: number;
	readonly outcome: string;
	readonly sentAt: string;
	readonly requestId: string;
};

/**
 * The five most recent offers the owner has sent on briefs of this kind (the version each client last received, not
 * superseded or withdrawn ones), other than this request's, each with its total
 * (the sum of its milestone fees). For an owner page; not an Effect program. Offers whose terms cannot be read are left
 * out.
 */
export async function pastOffers(
	db: D1Database,
	kind: PricingKind,
	exceptRequest: string,
): Promise<PastOffer[]> {
	const { results } = await db
		.prepare(
			`SELECT o.terms_json, o.sent_at, o.request_id, r.details_json
        FROM software_offers o JOIN owner_requests r ON r.id = o.request_id
        WHERE o.status = 'sent' AND o.sent_at IS NOT NULL AND o.request_id != ?
          AND CASE WHEN json_valid(r.details_json) THEN json_extract(r.details_json, '$.path') END = ?
        ORDER BY o.sent_at DESC LIMIT 100`,
		)
		.bind(exceptRequest, kind)
		.all<{
			terms_json: string;
			sent_at: string;
			request_id: string;
			details_json: string;
		}>();

	const offers: PastOffer[] = [];

	for (const row of results) {
		try {
			const details: JsonValue = JSON.parse(row.details_json);
			const terms: JsonValue = JSON.parse(row.terms_json);

			if (
				!Predicate.isObject(details) ||
				Array.isArray(details) ||
				pricingKind(details.path) !== kind ||
				!Predicate.isObject(terms) ||
				Array.isArray(terms) ||
				!Array.isArray(terms.milestones)
			)
				continue;

			const fees = terms.milestones.flatMap((milestone) =>
				Predicate.isObject(milestone) &&
				!Array.isArray(milestone) &&
				Predicate.isNumber(milestone.feeCents)
					? [milestone.feeCents]
					: [],
			);

			if (fees.length === 0) continue;
			offers.push({
				totalCents: offerTotal(fees),
				outcome: Predicate.isString(terms.outcome) ? terms.outcome : "",
				sentAt: row.sent_at,
				requestId: row.request_id,
			});
		} catch {
			// Unreadable terms are left out.
		}

		if (offers.length === 5) break;
	}

	return offers;
}
