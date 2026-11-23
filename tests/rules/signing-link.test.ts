import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consumeOlderLinks } from "../../src/server/rules/agreement-link";
import type { SigningStateRow } from "../../src/server/rules/signing-offer";
import {
	type CountedUse,
	issueSigningLink,
	linkRecipient,
	MailRefused,
	refundAllowances,
	SIGNING_ADDRESS_ALLOWANCE,
	SIGNING_EMAIL_ALLOWANCE,
	type SigningLinkRequest,
	signingMail,
	signingOn,
	type StoredSigningLink,
} from "../../src/server/rules/signing-link";
import { DatabaseSync } from "../helpers/sqlite-d1";

// The signing link's rules as stories, stage by stage in the route's order (docs/plans/2026-11-signing-conversion.md,
// section 2): the setting, the recipient, the link and its receipt, what a refused mail takes back, the mail's words. Then,
// on sqlite with the real schema (db/music.sql): the cooldown held to the link batch's A4, on the links the flow reads
// (every one, and only those after the window's start); the reused `consumeOlderLinks` held to the consume (A6) the route
// ran before its conversion (`issueAgreementLink`, src/lib/agreement-access.ts, now deleted); and the uses a refused mail
// gives back, through the two refund statements. Each statement copied here is held to the store's own text
// (src/server/agreement-store.ts, `storeSigningLink`, `readSigningLinks`, `readRecentSigningLinks`, `removeRefusedLink`
// and `consumeLinks`, which do not export it). A1, the batch's other guard, is held to `openForSigning` in
// tests/rules/signing-offer.test.ts.

type Said =
	| { refused: string; say: string }
	| { nothing: true }
	| { wrote: unknown };

const said = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<Option.Option<W> | W, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (value) =>
				Option.isOption(value)
					? Option.isSome(value)
						? { wrote: value.value }
						: { nothing: true as const }
					: { wrote: value },
		}),
	);

const RECIPIENT = "client@example.com";
const AT = new Date("2026-11-23T12:00:00.000Z");

const SIGNING_OFF = { refused: "SigningOff", say: "Website signing is off." };

const UNAVAILABLE = {
	refused: "OfferUnavailable",
	say: "This offer is unavailable for signing.",
};

const COOLDOWN = {
	refused: "CooldownRunning",
	say: "Wait at least 30 seconds before requesting another link.",
};

describe("the signing setting", () => {
	it("lets a link be asked for only while signing is on; a missing row is off", () => {
		expect(
			said(signingOn.decide(null, { software_signing_enabled: 1 })),
		).toEqual({ wrote: {} });
		expect(
			said(signingOn.decide(null, { software_signing_enabled: 0 })),
		).toEqual(SIGNING_OFF);
		expect(said(signingOn.decide(null, null))).toEqual(SIGNING_OFF);
	});
});

describe("the recipient", () => {
	const recipient = (
		recipient_email_snapshot: string | null | undefined,
		msa_template_id: string | null | undefined,
	) =>
		said(
			linkRecipient.decide(null, { recipient_email_snapshot, msa_template_id }),
		);

	it("is the offer's recipient, trimmed and lower-cased", () => {
		expect(recipient("  Client@Example.COM ", "msa-1")).toEqual({
			wrote: RECIPIENT,
		});
	});

	it("makes the offer unavailable when it has no recipient or no MSA template, before the address is read", () => {
		for (const missing of [null, undefined, ""])
			expect(recipient(missing, "msa-1")).toEqual(UNAVAILABLE);

		for (const missing of [null, undefined, ""])
			expect(recipient("not an address", missing)).toEqual(UNAVAILABLE);
	});

	it("is refused when the recipient is not an email address", () => {
		expect(recipient("not an address", "msa-1")).toEqual({
			refused: "InvalidEmail",
			say: "Enter a valid email address.",
		});
	});
});

const open: SigningStateRow = {
	status: "sent",
	recipient_email_snapshot: RECIPIENT,
	request_status: "reviewed",
	link_hash: "offer-link-hash",
	link_revoked_at: null,
	software_signing_enabled: 1,
	project_offer_id: null,
};

const link = (over: Partial<StoredSigningLink> = {}): StoredSigningLink => ({
	id: "older",
	issued_at: "2026-11-23T11:50:00.000Z",
	used_at: null,
	...over,
});

const request = (
	over: Partial<SigningLinkRequest> = {},
): SigningLinkRequest => ({
	at: AT,
	offerId: "o1",
	recipient: RECIPIENT,
	session: null,
	...over,
});

const issue = (
	signing: SigningStateRow | null,
	links: StoredSigningLink[] = [],
	over: Partial<SigningLinkRequest> = {},
) => said(issueSigningLink.decide(request(over), { signing, links }));

const issued = (receiptAddress: string) => ({
	wrote: {
		at: "2026-11-23T12:00:00.000Z",
		since: "2026-11-23T11:59:30.000Z",
		expiresAt: "2026-11-23T13:00:00.000Z",
		receiptAddress,
	},
});

describe("issuing a signing link", () => {
	it("writes a link that lasts an hour, with the 30-second window before it, and a masked receipt", () => {
		expect(issue(open)).toEqual(issued("c•••@example.com"));
	});

	it("shows the full address only to a visitor who holds an open signing session for this offer", () => {
		expect(issue(open, [], { session: { offer_id: "o1" } })).toEqual(
			issued(RECIPIENT),
		);
		expect(issue(open, [], { session: { offer_id: "o2" } })).toEqual(
			issued("c•••@example.com"),
		);
		expect(issue(open, [], { session: { offer_id: null } })).toEqual(
			issued("c•••@example.com"),
		);
	});

	it("masks the address after its first character, a whole code point", () => {
		expect(
			issue({ ...open, recipient_email_snapshot: "😀x@example.com" }, [], {
				recipient: "😀x@example.com",
			}),
		).toEqual(issued("😀•••@example.com"));
	});

	it("is refused for a link issued after the window's start, used or not, and not for one issued exactly at it", () => {
		expect(
			issue(open, [link({ issued_at: "2026-11-23T11:59:30.001Z" })]),
		).toEqual(COOLDOWN);
		expect(
			issue(open, [
				link({
					issued_at: "2026-11-23T11:59:50.000Z",
					used_at: "2026-11-23T11:59:55.000Z",
				}),
			]),
		).toEqual(COOLDOWN);
		expect(
			issue(open, [link({ issued_at: "2026-11-23T11:59:30.000Z" })]),
		).toEqual(issued("c•••@example.com"));
	});

	it("answers the real reason first, in Q1's order: signing off, then unavailable, then started, then the cooldown", () => {
		const recent = [link({ issued_at: "2026-11-23T11:59:59.000Z" })];

		expect(
			issue(
				{
					...open,
					software_signing_enabled: 0,
					status: "superseded",
					project_offer_id: "o1",
				},
				recent,
			),
		).toEqual(SIGNING_OFF);
		expect(issue(null, recent)).toEqual(UNAVAILABLE);
		expect(
			issue(
				{ ...open, link_revoked_at: AT.toISOString(), project_offer_id: "o1" },
				recent,
			),
		).toEqual(UNAVAILABLE);
		expect(issue({ ...open, project_offer_id: "o1" }, recent)).toEqual({
			refused: "SigningStarted",
			say: "This offer is unavailable for signing.",
		});
		expect(issue(open, recent)).toEqual(COOLDOWN);
	});

	it("is unavailable when the offer stopped being open for signing to the recipient", () => {
		for (const over of [
			{ status: "superseded" },
			{ status: "withdrawn" },
			{ link_hash: null },
			{ link_revoked_at: AT.toISOString() },
			{ recipient_email_snapshot: "other@example.com" },
			{ request_status: "withdrawn" },
			{ request_status: "resolved" },
		])
			expect(issue({ ...open, ...over })).toEqual(UNAVAILABLE);
	});
});

describe("a refused mail", () => {
	const uses: CountedUse[] = [
		{ key: "ip-key", window_start: "2026-11-23T11:58:00.000Z" },
		{ key: "email-key", window_start: "2026-11-23T12:00:00.000Z" },
	];

	const refund = (outcome: "sent" | "refused" | "uncertain") =>
		said(refundAllowances.decide({ linkId: "new" }, { outcome, uses }));

	it("takes the link back and gives back one use of each allowance it counted, in the order counted", () => {
		expect(refund("refused")).toEqual({ wrote: { linkId: "new", uses } });
	});

	it("has nothing to take back when the mail was sent or its outcome is uncertain", () => {
		expect(refund("sent")).toEqual({ nothing: true });
		expect(refund("uncertain")).toEqual({ nothing: true });
	});

	it("is answered with the 502's sentence", () => {
		expect(new MailRefused().say).toBe(
			"That email didn’t go through. Please try again.",
		);
	});

	it("counts the address first and the recipient after, as today", () => {
		expect(SIGNING_ADDRESS_ALLOWANCE).toEqual({
			scope: "agreement-link-ip",
			limit: 20,
		});
		expect(SIGNING_EMAIL_ALLOWANCE).toEqual({
			scope: "agreement-link-email",
			limit: 3,
		});
	});
});

describe("the mail's words", () => {
	const url = "https://thesuperhuman.us/offer/t/verify?key=k&x=<y>";

	it("are today's, greeting the brief's first name and naming the offer's outcome", () => {
		expect(
			signingMail({ name: "  Grace Hopper ", outcome: "A <new> site", url }),
		).toEqual({
			subject: "Open your agreement",
			text: `Hi Grace,\n\nTap below to review and sign the agreement for A <new> site.\n\nReview and sign: ${url}\n\nThis link works once and expires in an hour. If you didn’t ask for it, you can ignore this email.\n\nKazon`,
			html: `<p>Hi Grace,</p><p>Tap below to review and sign the agreement for A &lt;new&gt; site.</p><p><a href="https://thesuperhuman.us/offer/t/verify?key=k&amp;x=&lt;y&gt;">Review and sign</a></p><p>This link works once and expires in an hour. If you didn’t ask for it, you can ignore this email.</p><p>Kazon</p>`,
		});
	});

	it('greet "there" with no name, and print an outcome that is not text as a template literal does', () => {
		const mail = signingMail({ name: undefined, outcome: undefined, url });

		expect(mail.text.startsWith("Hi there,\n\n")).toBe(true);
		expect(mail.text).toContain("the agreement for undefined.");
		expect(signingMail({ name: "", outcome: null, url }).text).toContain(
			"Hi there,\n\nTap below to review and sign the agreement for null.",
		);
	});
});

const database = new DatabaseSync(":memory:");

beforeAll(() => {
	database.exec(readFileSync("db/music.sql", "utf8"));

	const T = "2026-11-20T10:00:00.000Z";

	database
		.prepare(
			"INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
		)
		.run("r1", "software", RECIPIENT, "A brief", "reviewed", T, T);

	for (const [id, version, status] of [
		["o1", 1, "sent"],
		["o2", 2, "superseded"],
	] as const)
		database
			.prepare(
				"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
			)
			.run(id, "r1", version, status, "{}", T, T);
});

beforeEach(() => {
	database.exec(
		"DELETE FROM software_agreement_links; DELETE FROM audio_client_allowances",
	);
});

type LinkRow = {
	id: string;
	purpose: "agreement" | "archive";
	offer_id: string | null;
	recipient_email: string;
	issued_at: string;
	used_at: string | null;
};

let stored = 0;

function store(row: Omit<LinkRow, "id"> & { id?: string }) {
	stored += 1;
	database
		.prepare(
			"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at,used_at) VALUES(?,?,?,?,?,?,?,?,?)",
		)
		.run(
			row.id ?? `l${stored}`,
			row.purpose,
			row.offer_id,
			row.offer_id === null ? null : "offer-link-hash",
			row.recipient_email,
			`key-hash-${stored}`,
			row.issued_at,
			"2026-11-23T13:00:00.000Z",
			row.used_at,
		);
}

/** The store's statements copied below, by the source they are held to. */
const STORE = readFileSync("src/server/agreement-store.ts", "utf8");

/** The store's read of the recipient's signing links of the offer (`readSigningLinks`), copied. */
const LINKS =
	"SELECT id,issued_at,used_at FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ?";

/** The store's read of those issued after the window's start (`readRecentSigningLinks`), copied. */
const RECENT_LINKS =
	"SELECT id,issued_at,used_at FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?";

/** The recipient's signing links of the offer, read as the store reads them after the mail. */
const readLinks = (email: string, offerId: string) =>
	// SAFETY: the statement selects exactly the three columns of StoredSigningLink, which the schema stores as text.
	database
		.prepare(LINKS)
		.all("agreement", email, offerId) as StoredSigningLink[];

/** Those issued after `since`, read as the store reads them before each try of the link batch. */
const readRecentLinks = (email: string, offerId: string, since: string) =>
	// SAFETY: the statement selects exactly the three columns of StoredSigningLink, which the schema stores as text.
	database
		.prepare(RECENT_LINKS)
		.all("agreement", email, offerId, since) as StoredSigningLink[];

/** A4 as the link batch runs it (src/server/agreement-store.ts, `storeSigningLink`), copied. */
const A4 =
	"SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another link','$') END";

const a4Refuses = (email: string, offerId: string, since: string) => {
	try {
		database.prepare(A4).get("agreement", email, offerId, since);

		return false;
	} catch {
		return true;
	}
};

const SINCE = "2026-11-23T11:59:30.000Z";

const ISSUED = [
	"2026-11-23T11:59:29.999Z",
	SINCE,
	"2026-11-23T11:59:30.001Z",
	AT.toISOString(),
] as const;

describe("A4 and the cooldown", () => {
	it("refuse exactly together, for a link of every purpose, recipient, offer, time and use", () => {
		let compared = 0;
		let cooling = 0;

		for (const purpose of ["agreement", "archive"] as const)
			for (const recipient_email of [RECIPIENT, "other@example.com"])
				for (const offer_id of ["o1", "o2", null])
					for (const issued_at of ISSUED)
						for (const used_at of [null, "2026-11-23T11:59:59.000Z"]) {
							database.exec("DELETE FROM software_agreement_links");
							store({ purpose, offer_id, recipient_email, issued_at, used_at });

							const label = JSON.stringify({
								purpose,
								recipient_email,
								offer_id,
								issued_at,
								used_at,
							});

							const rule =
								"refused" in
								said(
									issueSigningLink.decide(request(), {
										signing: open,
										links: readLinks(RECIPIENT, "o1"),
									}),
								);

							const onRecent =
								"refused" in
								said(
									issueSigningLink.decide(request(), {
										signing: open,
										links: readRecentLinks(RECIPIENT, "o1", SINCE),
									}),
								);

							expect(
								{ label, refuses: a4Refuses(RECIPIENT, "o1", SINCE) },
								label,
							).toEqual({ label, refuses: rule });
							expect(onRecent, label).toBe(rule);
							compared += 1;

							if (rule) cooling += 1;
						}

		// Only a signing link of this recipient and offer issued after the window's start, used or not.
		expect(compared).toBe(96);
		expect(cooling).toBe(4);
	});
});

/** A6 as `issueAgreementLink` consumed the older links before the conversion, copied (that code is deleted). */
const TODAY_CONSUME =
	"UPDATE software_agreement_links SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL AND id<>? AND issued_at<=?";

/** The store's consume (`consumeLinks`), copied. */
const CONSUME =
	"UPDATE software_agreement_links SET used_at=? WHERE id IN (SELECT value FROM json_each(?)) AND used_at IS NULL";

/** The store's two refund statements (`removeRefusedLink`), copied. */
const REFUND_LAST =
	"DELETE FROM audio_client_allowances WHERE key=? AND window_start=? AND uses=1";

const REFUND_ONE =
	"UPDATE audio_client_allowances SET uses=uses-1 WHERE key=? AND window_start=? AND uses>1";

describe("the statements copied here", () => {
	it("are the store's own texts", () => {
		for (const sql of [
			LINKS,
			RECENT_LINKS,
			A4,
			CONSUME,
			REFUND_LAST,
			REFUND_ONE,
		])
			expect(STORE, sql).toContain(sql);
	});
});

describe("A6 and consumeOlderLinks", () => {
	const usedAfter = (consume: () => void) => {
		database.exec("BEGIN");
		consume();

		// SAFETY: the statement selects the id column alone, which the schema stores as text.
		const used = (
			database
				.prepare(
					"SELECT id FROM software_agreement_links WHERE used_at=? ORDER BY id",
				)
				.all(AT.toISOString()) as { id: string }[]
		).map((row) => row.id);

		database.exec("ROLLBACK");

		return used;
	};

	it("consume the same links: the recipient's unused signing links of the offer issued no later than the new one", () => {
		const at = AT.toISOString();

		store({
			id: "new",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: RECIPIENT,
			issued_at: at,
			used_at: null,
		});
		store({
			id: "a-older",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: RECIPIENT,
			issued_at: "2026-11-23T11:00:00.000Z",
			used_at: null,
		});
		store({
			id: "b-same-instant",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: RECIPIENT,
			issued_at: at,
			used_at: null,
		});
		store({
			id: "c-used",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: RECIPIENT,
			issued_at: "2026-11-23T11:00:00.000Z",
			used_at: "2026-11-23T11:30:00.000Z",
		});
		store({
			id: "d-later",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: RECIPIENT,
			issued_at: "2026-11-23T12:00:00.001Z",
			used_at: null,
		});
		store({
			id: "e-other-offer",
			purpose: "agreement",
			offer_id: "o2",
			recipient_email: RECIPIENT,
			issued_at: "2026-11-23T11:00:00.000Z",
			used_at: null,
		});
		store({
			id: "f-other-recipient",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: "other@example.com",
			issued_at: "2026-11-23T11:00:00.000Z",
			used_at: null,
		});
		store({
			id: "g-archive",
			purpose: "archive",
			offer_id: null,
			recipient_email: RECIPIENT,
			issued_at: "2026-11-23T11:00:00.000Z",
			used_at: null,
		});

		const today = usedAfter(() =>
			database
				.prepare(TODAY_CONSUME)
				.run(at, "agreement", RECIPIENT, "o1", "new", at),
		);

		const chosen = Effect.runSync(
			consumeOlderLinks.decide({ id: "new", at }, readLinks(RECIPIENT, "o1")),
		);

		// The store's consume (src/server/agreement-store.ts, `consumeLinks`), over the ids the rule chose.
		const converted = usedAfter(() =>
			database.prepare(CONSUME).run(at, JSON.stringify(chosen.ids)),
		);

		expect(today).toEqual(["a-older", "b-same-instant"]);
		expect(converted).toEqual(today);
		expect(chosen).toEqual({ at, ids: ["a-older", "b-same-instant"] });
	});
});

describe("the uses a refused mail gives back", () => {
	/** One use counted as the allowance counts it (src/server/studio-signin-store.ts, `countAllowance`). */
	const count = (key: string, at: string): CountedUse => {
		// SAFETY: the upsert always returns its one row, whose window_start the schema stores as text.
		const row = database
			.prepare(
				"INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET uses=uses+1 RETURNING uses,window_start",
			)
			.get(key, at) as { window_start: string };

		return { key, window_start: row.window_start };
	};

	/** The two refund statements for each use (src/server/agreement-store.ts, `removeRefusedLink`), copied. */
	const giveBack = (uses: readonly CountedUse[]) => {
		for (const use of uses) {
			database.prepare(REFUND_LAST).run(use.key, use.window_start);
			database.prepare(REFUND_ONE).run(use.key, use.window_start);
		}
	};

	it("are one of each counted allowance, by the window its count answered: a window's only use goes with its row", () => {
		count("ip-key", "2026-11-23T11:58:00.000Z");

		const uses = [
			count("ip-key", AT.toISOString()),
			count("email-key", AT.toISOString()),
		];

		expect(uses[0]).toEqual({
			key: "ip-key",
			window_start: "2026-11-23T11:58:00.000Z",
		});

		const refund = Effect.runSync(
			refundAllowances.decide({ linkId: "new" }, { outcome: "refused", uses }),
		);

		giveBack(Option.getOrThrow(refund).uses);

		expect(
			database
				.prepare("SELECT key,uses FROM audio_client_allowances ORDER BY key")
				.all(),
		).toEqual([{ key: "ip-key", uses: 1 }]);
	});
});
