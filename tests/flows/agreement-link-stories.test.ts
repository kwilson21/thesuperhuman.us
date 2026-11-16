import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { newOfferToken } from "../../src/lib/software-offers";
import {
	AgreementMail,
	liveAgreementAllowance,
} from "../../src/server/agreement-services";
import { requestArchiveLink } from "../../src/server/flows/agreement-link";
import { MusicDb, Turnstile } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// The archive link flow as stories, on the real schema: the clock a request reads, and another request's link that commits
// between this request's read and its batch.

const SECRET = "k".repeat(40);
const EMAIL = "grace@example.test";
const T = Date.parse("2026-11-13T12:00:00.000Z");

const seedExecuted = (sql: ReturnType<typeof musicWorld>["sql"]) => {
	sql.exec("PRAGMA foreign_keys=OFF");

	sql
		.prepare(
			"INSERT INTO software_agreement_clients(id,recipient_email,legal_name,legal_name_key,entity_type,jurisdiction,business_address,notice_email,created_at) VALUES('c1',?,'Grace','grace','llc','VA','1 Main','n@example.test','2026-01-01T00:00:00.000Z')",
		)
		.run(EMAIL);

	sql
		.prepare(
			"INSERT INTO software_agreements(id,kind,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag1','msa','r1','c1','t1','executed','x',?,'{}','2026-01-01T00:00:00.000Z','2026-01-01','h')",
		)
		.run("0".repeat(64));
};

const run = (
	world: ReturnType<typeof musicWorld>,
	clock: () => Date,
	mails: string[] = [],
) => {
	let id = 0;

	return Effect.runPromise(
		requestArchiveLink({
			email: EMAIL,
			turnstileToken: "t",
			ip: "203.0.113.7",
			from: "site@example.test",
			origin: "https://thesuperhuman.us",
			now: clock,
			newId: () => `link-${++id}`,
			newToken: newOfferToken,
		}).pipe(
			Effect.match({
				onFailure: (refusal) => ({ refused: refusal._tag }),
				onSuccess: (answer) => ({ sent: answer.sent }),
			}),
			Effect.provideContext(
				Context.make(MusicDb, world.db).pipe(
					Context.add(Turnstile, { verify: () => Effect.void }),
					Context.merge(liveAgreementAllowance(world.db, SECRET)),
					Context.add(AgreementMail, {
						send: (payload) =>
							Effect.sync(() => {
								mails.push(payload.subject);

								return "sent" as const;
							}),
					}),
				),
			),
		),
	);
};

const links = (world: ReturnType<typeof musicWorld>) =>
	world.sql
		.prepare("SELECT id FROM software_agreement_links ORDER BY id")
		.all()
		.map((row) => row.id);

const otherRequestsLink = (sql: ReturnType<typeof musicWorld>["sql"]) =>
	sql
		.prepare(
			"INSERT OR IGNORE INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('other','archive',NULL,NULL,?,'other-hash',?,?)",
		)
		.run(
			EMAIL,
			new Date(T - 20_000).toISOString(),
			new Date(T + 3_000_000).toISOString(),
		);

describe("an archive link request", () => {
	it("stores a link and mails it for an address with an executed agreement", async () => {
		const world = musicWorld();

		seedExecuted(world.sql);
		const mails: string[] = [];

		expect(await run(world, () => new Date(T), mails)).toEqual({ sent: true });
		expect(links(world)).toEqual(["link-1"]);
		expect(mails).toEqual(["Your signed documents"]);
	});

	it("keeps its first instant when another request's link commits before its batch, so it is refused as it was", async () => {
		// The other link was issued 20 seconds before this request's first instant, and more than 30 seconds before a
		// clock read a minute later. A retry that read the clock again would find the window free and issue a second link.
		let reads = 0;

		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO software_agreement_links/,
				() => {
					otherRequestsLink(world.sql);
				},
			],
		});

		seedExecuted(world.sql);

		const clock = () => {
			reads += 1;

			// The cooldown's instant and the link's first instant, then a minute later.
			return new Date(reads <= 2 ? T : T + 60_000);
		};

		const mails: string[] = [];

		expect(await run(world, clock, mails)).toEqual({
			refused: "CooldownRunning",
		});
		expect(links(world)).toEqual(["other"]);
		expect(mails).toEqual([]);
	});
});
