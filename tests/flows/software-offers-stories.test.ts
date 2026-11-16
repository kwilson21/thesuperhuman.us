import type { SQLInputValue } from "node:sqlite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { requestColumns } from "../../src/lib/owner-model";
import { declineSoftwareRequest } from "../../src/server/flows/offer-decline";
import { saveOfferDraft } from "../../src/server/flows/offer-draft";
import { askSoftwareQuestion } from "../../src/server/flows/offer-question";
import type { OfferAction } from "../../src/server/flows/offer-request";
import { closeOfferLink } from "../../src/server/flows/offer-revoke";
import { sendSoftwareOffer } from "../../src/server/flows/offer-send";
import { AgreementPreflight } from "../../src/server/offers-services";
import {
	AudioBucket,
	Mail,
	type MailMessage,
	MailRefused,
	MusicDb,
} from "../../src/server/services";
import {
	ATTACHMENT_KEY,
	attachment,
	attachmentRow,
	details,
	EARLIER,
	insertSql,
	liveLink,
	offer,
	PDF_BYTES,
	request,
	signingBase,
	terms,
} from "../golden/areas/software-offers";
import { freshMusicDb, seed, START, type Seed } from "../golden/harness";
import { boundStatement, preparedStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { sqliteD1, type SqliteDatabase } from "../helpers/sqlite-d1";

// The software offers flows (src/server/flows/offer-*.ts) as stories, on the real schema: what each reads, sends and
// writes, in order, around its decisions. The order is the route's as it has always been: no read is made before a
// decision that came before it, a question's or a decline's client email goes through the request machine before
// anything after it is saved, a draft whose version another writer took is read and decided again, and an attachment's
// bytes are read once, after its size.

/** One line per outside effect, in order: a statement (`read`), a batch (`batch`), an email (`mail`) or an R2 call (`r2`). */
type Story = string[];

/** A statement up to its WHERE, enough to tell it apart. */
const named = (query: string) =>
	query.replace(/\s+/g, " ").split(" WHERE ")[0] ?? "";

/** A music database on the real schema that writes each statement and batch it runs into the story. */
function storyDb(sql: SqliteDatabase, story: Story, beforeBatch?: () => void) {
	const real = sqliteD1(sql);

	const members = (query: string, args: SQLInputValue[]) => {
		const inner = real.prepare(query).bind(...args);

		return {
			// SAFETY: first() is generic over the row type, so a non-generic function cannot be typed as the member; the double returns what the real statement returns.
			first: (async () => {
				story.push(`read ${named(query)}`);

				return inner.first();
			}) as D1PreparedStatement["first"],
			// SAFETY: as for first(): all() is generic over the row type, and the double returns what the real statement does.
			all: (async () => {
				story.push(`read ${named(query)}`);

				return inner.all();
			}) as D1PreparedStatement["all"],
			// SAFETY: as for first().
			run: (async () => {
				story.push(`write ${named(query)}`);

				return inner.run();
			}) as D1PreparedStatement["run"],
		};
	};

	return double<D1Database>({
		prepare: (query: string) => preparedStatement(query, [], members),
		batch: async <T>(items: D1PreparedStatement[]) => {
			const queries = items.map((item) => boundStatement(item).query);

			if (queries.some((query) => !query.startsWith("SELECT ")))
				beforeBatch?.();

			story.push(`batch ${named(queries.at(-1) ?? "")}`);

			return real.batch<T>(items);
		},
	});
}

/** Mail that writes each email into the story and answers with the next of `answers` (accepted past the end). */
const storyMail = (story: Story, answers: ("accepted" | "refused")[] = []) =>
	Context.make(Mail, {
		send: (message: MailMessage) =>
			Effect.suspend(() => {
				story.push(`mail ${message.subject} to ${message.to.join(",")}`);

				return answers.shift() === "refused"
					? Effect.fail(new MailRefused())
					: Effect.void;
			}),
	});

/** R2 with the attachment's bytes, writing each object read and body read into the story. */
const storyBucket = (story: Story, bytes: Uint8Array) =>
	Context.make(
		AudioBucket,
		double<R2Bucket>({
			// SAFETY: get() is overloaded, so one function cannot be typed as the member; the flow reads only size and arrayBuffer().
			get: (async (key: string) => {
				story.push(`r2 get ${key}`);

				return partial<R2ObjectBody>({
					size: bytes.byteLength,
					arrayBuffer: async () => {
						story.push(`r2 body ${key}`);

						return bytes.slice().buffer;
					},
				});
			}) as R2Bucket["get"],
		}),
	);

const MAIL = { from: "site@example.test", owner: "owner@example.test" };

/** The audit insert, which every batch of this route ends with. */
const AUDIT =
	"INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at) VALUES (?,?,?,?,?)";

function world(start: Seed, beforeBatch?: () => void) {
	const sql = freshMusicDb();

	seed(sql, start);

	const story: Story = [];
	const db = storyDb(sql, story, beforeBatch);

	const action: OfferAction = {
		requestId: "r1",
		actor: "owner@example.test",
		now: () => START,
		sendingSince: () => new Date(Date.parse(START) - 20_000).toISOString(),
	};

	return { sql, story, db, action };
}

/** Runs a flow and answers what it answered: its value, or the tag of what it failed with. */
const outcome = <A, E extends { readonly _tag: string }>(
	program: Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		program.pipe(
			Effect.match({
				onFailure: (failure) => ({ failed: failure._tag }),
				onSuccess: (value) => ({ answered: value }),
			}),
		),
	);

describe("revoke", () => {
	it("refuses a request with no email before it reads the link", async () => {
		const { story, db, action } = world({
			owner_requests: [request({ email: "" })],
			software_offer_links: [liveLink()],
		});

		expect(
			await outcome(
				closeOfferLink({
					...action,
					command: { action: "revoke", expectedLinkCreatedAt: EARLIER },
				}).pipe(Effect.provideService(MusicDb, db)),
			),
		).toEqual({ failed: "RequestClosed" });
		expect(story).toEqual([
			`read SELECT ${requestColumns.replace(/\s+/g, " ")} FROM owner_requests`,
		]);
	});

	it("after a refused batch reads the page's link, then whether one is still sending, and answers that the link changed", async () => {
		const { sql, story, db, action } = world(
			{
				owner_requests: [request()],
				software_offers: [offer("sent")],
				software_offer_links: [liveLink()],
			},
			() => sql.exec("UPDATE software_offer_links SET revoked_at='x'"),
		);

		expect(
			await outcome(
				closeOfferLink({
					...action,
					command: {
						action: "revoke",
						expectedLinkCreatedAt: "2026-11-13T11:00:00.000Z",
					},
				}).pipe(Effect.provideService(MusicDb, db)),
			),
		).toEqual({ failed: "LinkChanged" });
		expect(story.slice(-2)).toEqual([
			`batch ${AUDIT}`,
			"read SELECT 1 FROM software_offer_links",
		]);
	});
});

describe("question and decline: the client email through the request machine", () => {
	it("a question reserves, emails the client and then the owner's copy, and only then records the question", async () => {
		const { story, db, action } = world({ owner_requests: [request()] });

		expect(
			await outcome(
				askSoftwareQuestion({
					...action,
					command: { action: "question", text: "Which users?" },
					mail: MAIL,
				}).pipe(
					Effect.provideContext(
						Context.make(MusicDb, db).pipe(Context.merge(storyMail(story))),
					),
				),
			),
		).toEqual({ answered: true });
		expect(story.slice(2)).toEqual([
			"batch UPDATE owner_requests SET updated_at=?",
			"mail A question about your project brief to grace@example.test",
			"mail Copy: A question about your project brief to owner@example.test",
			`batch ${AUDIT}`,
		]);
	});

	it("a decline with no mail settings writes nothing and reads no agreement or audio project", async () => {
		const { story, db, action, sql } = world({
			owner_requests: [request()],
			software_offers: [offer("sent")],
			software_offer_links: [liveLink()],
		});

		expect(
			await outcome(
				declineSoftwareRequest({
					...action,
					command: { action: "decline", text: "Not a fit." },
					mail: null,
				}).pipe(
					Effect.provideContext(
						Context.make(MusicDb, db).pipe(Context.merge(storyMail(story))),
					),
				),
			),
		).toEqual({ failed: "MailNotConfigured" });
		expect(
			story.some((line) => /software_agreements|audio_projects/.test(line)),
		).toBe(false);
		expect(story.some((line) => line.startsWith("batch UPDATE"))).toBe(false);
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "sent",
		});
	});

	it("a decline whose client email is refused keeps the offer withdrawn, sends no copy and resolves nothing", async () => {
		const { story, db, action, sql } = world({
			owner_requests: [request()],
			software_offers: [offer("sent")],
			software_offer_links: [liveLink()],
		});

		expect(
			await outcome(
				declineSoftwareRequest({
					...action,
					command: { action: "decline", text: "Not a fit." },
					mail: MAIL,
				}).pipe(
					Effect.provideContext(
						Context.make(MusicDb, db).pipe(
							Context.merge(storyMail(story, ["refused"])),
						),
					),
				),
			),
		).toEqual({ failed: "MailRefused" });
		expect(story.at(-1)).toBe(
			"mail About your project brief to grace@example.test",
		);
		expect(sql.prepare("SELECT status FROM owner_requests").get()).toEqual({
			status: "reviewed",
		});
		expect(sql.prepare("SELECT status FROM software_offers").get()).toEqual({
			status: "withdrawn",
		});
	});

	it("a decline that lands resolves the request after the email, once it read that no offer is left", async () => {
		const { story, db, action, sql } = world({
			owner_requests: [request()],
			software_offers: [offer("sent")],
			software_offer_links: [liveLink()],
		});

		expect(
			await outcome(
				declineSoftwareRequest({
					...action,
					command: { action: "decline", text: "Not a fit." },
					mail: MAIL,
				}).pipe(
					Effect.provideContext(
						Context.make(MusicDb, db).pipe(Context.merge(storyMail(story))),
					),
				),
			),
		).toEqual({ answered: true });
		expect(story.slice(-4)).toEqual([
			"mail About your project brief to grace@example.test",
			"mail Copy: About your project brief to owner@example.test",
			"read SELECT 1 FROM software_offers",
			`batch ${AUDIT}`,
		]);
		expect(sql.prepare("SELECT status FROM owner_requests").get()).toEqual({
			status: "resolved",
		});
	});
});

describe("draft", () => {
	it("makes a new id only for a new version, once per try, and saves the next version when another writer took one", async () => {
		const { sql, db, action } = world({ owner_requests: [request()] });
		let taken = false;
		const ids: string[] = [];

		const racing = double<D1Database>({
			prepare: (query: string) => db.prepare(query),
			batch: async <T>(items: D1PreparedStatement[]) => {
				if (!taken) {
					taken = true;
					sql.exec(insertSql("software_offers", offer("sent")));
				}

				return db.batch<T>(items);
			},
		});

		expect(
			await outcome(
				saveOfferDraft({
					...action,
					command: {
						action: "draft",
						terms: terms(),
						removedAttachmentKeys: [],
						expectedUpdatedAt: null,
					},
					newId: () => {
						const id = `draft-${ids.length + 1}`;

						ids.push(id);

						return id;
					},
				}).pipe(Effect.provideService(MusicDb, racing)),
			),
		).toEqual({
			answered: {
				version: 2,
				updatedAt: START,
				attachmentCleanupPending: false,
			},
		});
		expect(ids).toEqual(["draft-1", "draft-2"]);
		expect(
			sql
				.prepare(
					"SELECT id,version,status FROM software_offers ORDER BY version",
				)
				.all(),
		).toEqual([
			{ id: "o1", version: 1, status: "sent" },
			{ id: "draft-2", version: 2, status: "draft" },
		]);
	});

	it("reads the time before the offers, as the route always did: a slow offers read does not move the draft's time", async () => {
		const { sql, db, action } = world({ owner_requests: [request()] });
		const LATER = new Date(Date.parse(START) + 5_000).toISOString();
		let clock = START;

		// The offers read takes five seconds: the clock has moved by the time it answers.
		const slow = double<D1Database>({
			prepare: (query: string) => {
				if (query.startsWith("SELECT * FROM software_offers")) clock = LATER;

				return db.prepare(query);
			},
			batch: <T>(items: D1PreparedStatement[]) => db.batch<T>(items),
		});

		expect(
			await outcome(
				saveOfferDraft({
					...action,
					now: () => clock,
					command: {
						action: "draft",
						terms: terms(),
						removedAttachmentKeys: [],
						expectedUpdatedAt: null,
					},
					newId: () => "draft-1",
				}).pipe(Effect.provideService(MusicDb, slow)),
			),
		).toEqual({
			answered: {
				version: 1,
				updatedAt: START,
				attachmentCleanupPending: false,
			},
		});
		expect(clock).toBe(LATER);
		expect(
			sql.prepare("SELECT created_at,updated_at FROM software_offers").all(),
		).toEqual([{ created_at: START, updated_at: START }]);
		expect(
			sql
				.prepare(
					"SELECT occurred_at FROM owner_request_audit WHERE action='offer-draft-saved'",
				)
				.all(),
		).toEqual([{ occurred_at: START }]);
	});
});

describe("send with signing on", () => {
	const signingSeed = (bytes: number): Seed => ({
		...signingBase(),
		owner_requests: [request()],
		software_offers: [
			offer("draft", 1, {
				agreement_details_json: JSON.stringify(
					details({ attachments: [attachment({ bytes })] }),
				),
			}),
		],
		software_agreement_attachments: [attachmentRow({ bytes })],
	});

	const send = (start: Seed) => {
		const { sql, story, db, action } = world(start);

		sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1");

		return {
			story,
			run: () =>
				outcome(
					sendSoftwareOffer({
						...action,
						command: {
							action: "send",
							version: 1,
							expectedUpdatedAt: "2026-11-13T11:00:00.000Z",
						},
						mail: MAIL,
						siteOrigin: "https://thesuperhuman.us",
						newToken: () => "t".repeat(43),
					}).pipe(
						Effect.provideContext(
							Context.make(MusicDb, db).pipe(
								Context.merge(storyMail(story)),
								Context.merge(storyBucket(story, PDF_BYTES)),
								Context.merge(
									Context.make(AgreementPreflight, {
										check: () => Effect.void,
									}),
								),
							),
						),
					),
				),
		};
	};

	it("reads an attachment's row, then its object, then its bytes once, after the size", async () => {
		const sending = send(signingSeed(PDF_BYTES.length));

		expect(await sending.run()).toMatchObject({
			answered: { version: 1, emailSent: true },
		});

		const r2 = sending.story.filter((line) => line.startsWith("r2 "));

		expect(r2).toEqual([
			`r2 get ${ATTACHMENT_KEY}`,
			`r2 body ${ATTACHMENT_KEY}`,
		]);
		expect(
			sending.story.indexOf(
				"read SELECT 1 FROM software_agreement_attachments",
			),
		).toBeLessThan(sending.story.indexOf(`r2 get ${ATTACHMENT_KEY}`));
	});

	it("never reads the bytes of an object whose size is not the attachment's", async () => {
		const sending = send(signingSeed(PDF_BYTES.length + 1));

		expect(await sending.run()).toEqual({ failed: "DetailsIncomplete" });
		expect(sending.story.filter((line) => line.startsWith("r2 "))).toEqual([
			`r2 get ${ATTACHMENT_KEY}`,
		]);
		expect(sending.story.some((line) => line.startsWith("batch UPDATE"))).toBe(
			false,
		);
	});
});
