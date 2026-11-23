import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { hashOfferToken } from "../../src/lib/software-offers";
import {
	AgreementMail,
	liveAgreementAllowance,
	type MailOutcome,
} from "../../src/server/agreement-services";
import { requestSigningLink } from "../../src/server/flows/signing-link";
import { MusicDb, Turnstile } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// The signing link flow (src/server/flows/signing-link.ts) as stories, on the real schema: a link mailed to the offer's
// recipient and its receipt; a refused mail, which takes back the link and the uses it counted; a token of another shape,
// refused before any read; and what the link batch's guards re-check, read just before each try (a project already
// started, another request's link, signing switched off after the read).

const SECRET = "k".repeat(40);
const RECIPIENT = "grace@example.test";
const TOKEN = "T".repeat(43);
const T = Date.parse("2026-11-13T12:00:00.000Z");

type World = ReturnType<typeof musicWorld>;

/** A sent offer of a software brief, linked by TOKEN, with signing on. Answers the offer link's token hash. */
async function seedOffer(world: World) {
	const { sql } = world;
	const tokenHash = await hashOfferToken(TOKEN);

	sql.exec("PRAGMA foreign_keys=OFF");
	sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1");
	sql
		.prepare(
			"INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r1','software','Grace Hopper',?,'A tool','reviewed','t','t')",
		)
		.run(RECIPIENT);
	sql
		.prepare(
			"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,msa_template_id,recipient_email_snapshot) VALUES('o1','r1',1,'sent',?,'t','t','tpl-msa',?)",
		)
		.run(JSON.stringify({ outcome: "A synthetic tool" }), RECIPIENT);
	sql
		.prepare(
			"INSERT INTO software_offer_links(request_id,token_hash,created_at) VALUES('r1',?,'t')",
		)
		.run(tokenHash);
	sql.exec("PRAGMA foreign_keys=ON");

	return tokenHash;
}

/** Seeds an open signing session for the offer and answers the cookie that names it. */
async function seedSession(world: World, tokenHash: string) {
	const token = "s".repeat(43);

	world.sql
		.prepare(
			"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at,used_at) VALUES('used','agreement','o1',?,?,'used-hash','2026-11-13T10:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T10:30:00.000Z')",
		)
		.run(tokenHash, RECIPIENT);
	world.sql
		.prepare(
			"INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,csrf_nonce) VALUES(?,'agreement','o1',?,?,'used','2026-11-13T11:00:00.000Z','2026-11-13T13:00:00.000Z','nonce')",
		)
		.run(await hashOfferToken(token), tokenHash, RECIPIENT);

	return `agreement_session=${token}`;
}

const run = (
	world: World,
	options: {
		readonly token?: string;
		readonly cookie?: string;
		readonly outcome?: MailOutcome;
		readonly clock?: () => Date;
		readonly mails?: string[];
	} = {},
) => {
	let id = 0;

	return Effect.runPromise(
		requestSigningLink({
			token: options.token ?? TOKEN,
			request: new Request(`https://thesuperhuman.us/api/offer/${TOKEN}/link`, {
				headers: options.cookie ? { cookie: options.cookie } : {},
			}),
			turnstileToken: "t",
			ip: "203.0.113.7",
			from: "site@example.test",
			origin: "https://thesuperhuman.us",
			now: options.clock ?? (() => new Date(T)),
			newId: () => `link-${++id}`,
			newToken: () => `key-${id}`.padEnd(43, "x"),
		}).pipe(
			Effect.match({
				onFailure: (refusal) => ({ refused: refusal._tag }),
				onSuccess: (answer) => ({ receipt: answer.receiptAddress }),
			}),
			Effect.provideContext(
				Context.make(MusicDb, world.db).pipe(
					Context.add(Turnstile, { verify: () => Effect.void }),
					Context.merge(liveAgreementAllowance(world.db, SECRET)),
					Context.add(AgreementMail, {
						send: (payload) =>
							Effect.sync(() => {
								options.mails?.push(payload.text);

								return options.outcome ?? "sent";
							}),
					}),
				),
			),
		),
	);
};

const links = (world: World) =>
	world.sql
		.prepare("SELECT id,used_at FROM software_agreement_links ORDER BY id")
		.all();

const uses = (world: World) =>
	world.sql
		.prepare("SELECT uses FROM audio_client_allowances ORDER BY uses")
		.all()
		.map((row) => row.uses);

const otherRequestsLink = (world: World) =>
	world.sql
		.prepare(
			"INSERT OR IGNORE INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('other','agreement','o1','h',?,'other-hash',?,?)",
		)
		.run(
			RECIPIENT,
			new Date(T - 20_000).toISOString(),
			new Date(T + 3_000_000).toISOString(),
		);

describe("a signing link request", () => {
	it("stores a link, mails it to the offer's recipient and names the address masked", async () => {
		const world = musicWorld();

		await seedOffer(world);
		const mails: string[] = [];

		expect(await run(world, { mails })).toEqual({
			receipt: "g•••@example.test",
		});
		expect(links(world)).toEqual([{ id: "link-1", used_at: null }]);
		expect(uses(world)).toEqual([1, 1]);
		expect(mails).toHaveLength(1);
		expect(mails[0]).toContain("Hi Grace,");
		expect(mails[0]).toContain("the agreement for A synthetic tool.");
		expect(mails[0]).toContain(
			`https://thesuperhuman.us/offer/${TOKEN}/verify?key=key-1`,
		);
	});

	it("names the address in full to a visitor whose open signing session is this offer's", async () => {
		const world = musicWorld();
		const tokenHash = await seedOffer(world);
		const cookie = await seedSession(world, tokenHash);

		expect(await run(world, { cookie })).toEqual({ receipt: RECIPIENT });
	});

	it("consumes the recipient's older unused link once the mail went out", async () => {
		const world = musicWorld();

		await seedOffer(world);
		world.sql
			.prepare(
				"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('older','agreement','o1','h',?,'older-hash','2026-11-13T11:00:00.000Z','2026-11-13T12:30:00.000Z')",
			)
			.run(RECIPIENT);

		expect(await run(world)).toEqual({ receipt: "g•••@example.test" });
		expect(links(world)).toEqual([
			{ id: "link-1", used_at: null },
			{ id: "older", used_at: "2026-11-13T12:00:00.000Z" },
		]);
	});

	it("takes back the link and the two uses it counted when the mail is refused", async () => {
		const world = musicWorld();

		await seedOffer(world);

		expect(await run(world, { outcome: "refused" })).toEqual({
			refused: "MailRefused",
		});
		expect(links(world)).toEqual([]);
		expect(uses(world)).toEqual([]);
	});

	it("keeps the link when the mail's outcome is uncertain", async () => {
		const world = musicWorld();

		await seedOffer(world);

		expect(await run(world, { outcome: "uncertain" })).toEqual({
			receipt: "g•••@example.test",
		});
		expect(links(world)).toEqual([{ id: "link-1", used_at: null }]);
	});

	it("refuses a token of another shape before any statement runs", async () => {
		const world = musicWorld({
			beforeStatement: [
				/FROM software_offers/,
				() => {
					throw new Error("the offer was read");
				},
			],
		});

		await seedOffer(world);

		expect(await run(world, { token: "short" })).toEqual({
			refused: "OfferUnavailable",
		});
		expect(uses(world)).toEqual([]);
	});

	it("refuses an offer whose project started, from the read before the batch, with nothing stored", async () => {
		const world = musicWorld();

		await seedOffer(world);
		world.sql.exec(
			"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','t','t','t','o','t','t')",
		);

		expect(await run(world)).toEqual({ refused: "SigningStarted" });
		expect(links(world)).toEqual([]);
	});

	it("reads and decides again when signing is switched off between its read and its batch: SigningOff", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO software_agreement_links/,
				() => {
					world.sql.exec(
						"UPDATE software_signing_settings SET software_signing_enabled=0",
					);
				},
			],
		});

		await seedOffer(world);

		expect(await run(world)).toEqual({ refused: "SigningOff" });
		expect(links(world)).toEqual([]);
	});

	it("keeps its first instant when another request's link commits before its batch, so it is refused as it was", async () => {
		// The other link was issued 20 seconds before this request's instant, and more than 30 seconds before a clock read
		// a minute later. A retry that read the clock again would find the window free and issue a second link.
		let reads = 0;

		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO software_agreement_links/,
				() => {
					otherRequestsLink(world);
				},
			],
		});

		await seedOffer(world);

		const clock = () => {
			reads += 1;

			// The session's and the link's instants, then a minute later.
			return new Date(reads <= 2 ? T : T + 60_000);
		};

		const mails: string[] = [];

		expect(await run(world, { clock, mails })).toEqual({
			refused: "CooldownRunning",
		});
		expect(links(world)).toEqual([{ id: "other", used_at: null }]);
		expect(mails).toEqual([]);
	});
});
