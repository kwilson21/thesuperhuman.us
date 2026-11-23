import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { hashOfferToken } from "../../src/lib/software-offers";
import { redeemAgreementLink } from "../../src/server/flows/signing-redeem";
import { MusicDb } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// The redeem flow (src/server/flows/signing-redeem.ts) as stories, on the real schema: a signing link opened (GET) and
// used (POST), once; an archive link; a key of another shape, refused before any statement; a signing link of another
// offer, or whose offer stopped being open for signing; and another tab that uses the link between the read and the
// batch, whose guard refuses the batch.

const TOKEN = "T".repeat(43);
const OTHER_TOKEN = "U".repeat(43);
const KEY = "K".repeat(43);
const ARCHIVE_KEY = "A".repeat(43);
const RECIPIENT = "grace@example.test";
const T = Date.parse("2026-11-13T12:00:00.000Z");

type World = ReturnType<typeof musicWorld>;

/** A sent offer linked by TOKEN with signing on, an unused signing link for KEY and an archive link for ARCHIVE_KEY. */
async function seed(world: World) {
	const { sql } = world;
	const linkHash = await hashOfferToken(TOKEN);

	sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1");
	sql
		.prepare(
			"INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r1','software','Grace Hopper',?,'A tool','reviewed','t','t')",
		)
		.run(RECIPIENT);
	sql
		.prepare(
			"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,recipient_email_snapshot) VALUES('o1','r1',1,'sent','{}','t','t',?)",
		)
		.run(RECIPIENT);
	sql
		.prepare(
			"INSERT INTO software_offer_links(request_id,token_hash,created_at) VALUES('r1',?,'t')",
		)
		.run(linkHash);

	const link = sql.prepare(
		"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,'2026-11-13T11:30:00.000Z','2026-11-13T12:30:00.000Z')",
	);

	link.run(
		"signing",
		"agreement",
		"o1",
		linkHash,
		RECIPIENT,
		await hashOfferToken(KEY),
	);
	link.run(
		"archive",
		"archive",
		null,
		null,
		RECIPIENT,
		await hashOfferToken(ARCHIVE_KEY),
	);
}

const redeem = (
	world: World,
	request: { key?: string; token?: string; method?: string } = {},
) => {
	let drawn = 0;

	return Effect.runPromise(
		redeemAgreementLink({
			key: request.key ?? KEY,
			token: "token" in request ? request.token : TOKEN,
			method: request.method ?? "POST",
			now: () => new Date(T),
			newToken: () => `drawn-${++drawn}`.padEnd(43, "x"),
		}).pipe(
			Effect.match({
				onFailure: (refusal) => ({ refused: refusal._tag }),
				onSuccess: (answer) => answer,
			}),
			Effect.provideContext(Context.make(MusicDb, world.db)),
		),
	);
};

const sessions = (world: World) =>
	world.sql
		.prepare(
			"SELECT purpose,offer_id,link_id,csrf_nonce,expires_at FROM software_agreement_sessions",
		)
		.all();

const used = (world: World) =>
	world.sql
		.prepare("SELECT id,used_at FROM software_agreement_links ORDER BY id")
		.all();

describe("redeeming an emailed link", () => {
	it("opens a signing link with a GET, writing nothing", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await redeem(world, { method: "GET" })).toEqual({ method: "GET" });
		expect(sessions(world)).toEqual([]);
	});

	it("uses a signing link with a POST, once: the session lasts two hours, the second POST is refused", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await redeem(world)).toEqual({
			method: "POST",
			purpose: "agreement",
			location: `/offer/${TOKEN}/sign`,
			sessionToken: "drawn-1".padEnd(43, "x"),
		});
		expect(sessions(world)).toEqual([
			{
				purpose: "agreement",
				offer_id: "o1",
				link_id: "signing",
				csrf_nonce: "drawn-2".padEnd(43, "x"),
				expires_at: "2026-11-13T14:00:00.000Z",
			},
		]);
		expect(await redeem(world)).toEqual({ refused: "LinkExpired" });
		expect(used(world)).toEqual([
			{ id: "archive", used_at: null },
			{ id: "signing", used_at: "2026-11-13T12:00:00.000Z" },
		]);
	});

	it("uses an archive link on the archive page, and refuses a signing link there", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await redeem(world, { token: undefined })).toEqual({
			refused: "LinkExpired",
		});
		expect(
			await redeem(world, { key: ARCHIVE_KEY, token: undefined }),
		).toMatchObject({
			method: "POST",
			purpose: "archive",
			location: "/agreements",
		});
	});

	it("refuses a key of another shape before any statement runs", async () => {
		const world = musicWorld({
			beforeStatement: [
				/software_agreement_links/,
				() => {
					throw new Error("the link was read");
				},
			],
		});

		await seed(world);

		expect(await redeem(world, { key: "short" })).toEqual({
			refused: "LinkExpired",
		});
	});

	it("refuses a signing link on another offer's page", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await redeem(world, { token: OTHER_TOKEN, method: "GET" })).toEqual({
			refused: "LinkExpired",
		});
	});

	it("refuses a GET once the offer is superseded, from the offer's signing state", async () => {
		const world = musicWorld();

		await seed(world);
		world.sql.exec("UPDATE software_offers SET status='superseded'");

		expect(await redeem(world, { method: "GET" })).toEqual({
			refused: "LinkExpired",
		});
	});

	it("is refused by the batch's guard when another tab uses the link after the read", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE software_agreement_links SET used_at=\? WHERE token_hash=\?/,
				() => {
					world.sql.exec(
						"UPDATE software_agreement_links SET used_at='2026-11-13T11:59:00.000Z' WHERE id='signing'",
					);
				},
			],
		});

		await seed(world);

		expect(await redeem(world)).toEqual({ refused: "GuardRefused" });
		expect(sessions(world)).toEqual([]);
	});
});
