import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import { hashOfferToken } from "../../src/lib/software-offers";
import {
	draftBody,
	saveSigningFormDraft,
} from "../../src/server/flows/signing-draft";
import { MusicDb } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// The signing form's draft (src/server/flows/signing-draft.ts) as stories, on the real schema: a draft saved and saved
// again; the front checks in the route's order (no session, another offer's session, signing off, the nonce, the
// values); what only the batch's guards checked before, now read first (a project, a signed agreement); and a session
// revoked between the read and the batch, whose guard refuses it.

const TOKEN = "T".repeat(43);
const SESSION_TOKEN = "s".repeat(43);
const RECIPIENT = "grace@example.test";
const NONCE = "nonce";
const T = Date.parse("2026-11-13T12:00:00.000Z");

type World = ReturnType<typeof musicWorld>;

/** A sent offer linked by TOKEN with signing on, and the visitor's open signing session for it. */
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
	sql
		.prepare(
			"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at,used_at) VALUES('used','agreement','o1',?,?,'used-hash','2026-11-13T10:00:00.000Z','2026-11-13T11:00:00.000Z','2026-11-13T10:30:00.000Z')",
		)
		.run(linkHash, RECIPIENT);
	sql
		.prepare(
			"INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,csrf_nonce) VALUES(?,'agreement','o1',?,?,'used','2026-11-13T11:00:00.000Z','2026-11-13T13:00:00.000Z',?)",
		)
		.run(await hashOfferToken(SESSION_TOKEN), linkHash, RECIPIENT, NONCE);
}

const save = (
	world: World,
	body: RawValue = {
		csrf_nonce: NONCE,
		values: { legal_name: "Hopper Systems LLC" },
	},
	token: string | undefined = TOKEN,
	clock: () => Date = () => new Date(T),
) =>
	Effect.runPromise(
		saveSigningFormDraft({
			token,
			request: new Request(
				`https://thesuperhuman.us/api/offer/${TOKEN}/draft`,
				{
					headers: { cookie: `agreement_session=${SESSION_TOKEN}` },
				},
			),
			body: draftBody(body),
			now: clock,
		}).pipe(
			Effect.match({
				onFailure: (refusal) => ({ refused: refusal._tag }),
				onSuccess: () => ({ saved: true }),
			}),
			Effect.provideContext(Context.make(MusicDb, world.db)),
		),
	);

const drafts = (world: World) =>
	world.sql
		.prepare(
			"SELECT offer_id,recipient_email,json_extract(values_json,'$.legal_name') AS legal_name,updated_at FROM software_agreement_drafts",
		)
		.all();

describe("saving the signing form's draft", () => {
	it("saves the draft for the session's address, and replaces it on the next save", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await save(world)).toEqual({ saved: true });
		expect(
			await save(
				world,
				{ csrf_nonce: NONCE, values: { legal_name: "Hopper Industries Inc" } },
				TOKEN,
				() => new Date(T + 60_000),
			),
		).toEqual({ saved: true });
		expect(drafts(world)).toEqual([
			{
				offer_id: "o1",
				recipient_email: RECIPIENT,
				legal_name: "Hopper Industries Inc",
				updated_at: "2026-11-13T12:01:00.000Z",
			},
		]);
	});

	it("refuses without a session for the offer: no token, an unknown token, a revoked session, or signing off", async () => {
		const world = musicWorld();

		await seed(world);

		expect(await save(world, undefined, "")).toEqual({
			refused: "SessionMissing",
		});
		expect(await save(world, undefined, "U".repeat(43))).toEqual({
			refused: "SessionMissing",
		});
		world.sql.exec(
			"UPDATE software_signing_settings SET software_signing_enabled=0",
		);
		expect(await save(world)).toEqual({ refused: "SessionMissing" });
		world.sql.exec(
			"UPDATE software_signing_settings SET software_signing_enabled=1; UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:30:00.000Z'",
		);
		expect(await save(world)).toEqual({ refused: "SessionMissing" });
		expect(drafts(world)).toEqual([]);
	});

	it("refuses a nonce that is not the session's, then values that do not read, before reading the agreements", async () => {
		const world = musicWorld({
			beforeStatement: [
				/FROM software_agreements WHERE offer_id/,
				() => {
					throw new Error("the agreements were read");
				},
			],
		});

		await seed(world);

		expect(await save(world, null)).toEqual({ refused: "CsrfMismatch" });
		expect(await save(world, { csrf_nonce: "other", values: {} })).toEqual({
			refused: "CsrfMismatch",
		});
		expect(await save(world, { csrf_nonce: NONCE, values: [] })).toEqual({
			refused: "DraftRefused",
		});
	});

	it("refuses once a project started or an agreement is signed, read before the batch, with nothing saved", async () => {
		const world = musicWorld();

		await seed(world);
		world.sql.exec("PRAGMA foreign_keys=OFF");
		world.sql.exec(
			"INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag1','msa','o1','r1','c1','t1','client_signed','x','" +
				"0".repeat(64) +
				"','{}','t','2026-11-13','h')",
		);
		world.sql.exec("PRAGMA foreign_keys=ON");

		expect(await save(world)).toEqual({ refused: "AlreadySigned" });

		world.sql.exec(
			"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','t','t','t','o','t','t')",
		);

		expect(await save(world)).toEqual({ refused: "SigningStarted" });
		expect(drafts(world)).toEqual([]);
	});

	it("is refused by the batch's guard when the session is revoked between the read and the batch", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO software_agreement_drafts/,
				() => {
					world.sql.exec(
						"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
					);
				},
			],
		});

		await seed(world);

		expect(await save(world)).toEqual({ refused: "GuardRefused" });
		expect(drafts(world)).toEqual([]);
	});
});
