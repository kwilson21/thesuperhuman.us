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

/** There is no software request with this id. */
export class OfferRequestMissing extends Data.TaggedError(
	"OfferRequestMissing",
) {}

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
};

const textOf = (details: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = details[key];

	return Predicate.isString(value) ? value.slice(0, 4000) : "";
};

type RequestRow = {
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
				`SELECT r.kind, r.status, r.details_json,
          EXISTS (SELECT 1 FROM software_projects WHERE request_id = r.id) AS started,
          COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?2 AND scope = ?3), 0) AS count,
          f.label AS fit_label, f.note AS fit_note
        FROM owner_requests r LEFT JOIN software_fit_reviews f ON f.request_id = r.id
        WHERE r.id = ?1`,
			)
			.bind(id, day, OFFER_OWNER_SCOPE)
			.first<RequestRow>(),
	).pipe(
		Effect.flatMap((row) =>
			row && row.kind === "software"
				? Effect.succeed(row)
				: Effect.fail(new OfferRequestMissing()),
		),
		Effect.map((row) => {
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
					}
				: null;

			return { facts, brief };
		}),
	);

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
 * unless the count is still under the limit, and the batch then writes nothing: that is ChangedSinceRead.
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
        ORDER BY o.sent_at DESC LIMIT 100`,
		)
		.bind(exceptRequest)
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
