import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import type { CanonicalJson } from "../../src/lib/agreement-artifacts";
import type { JsonValue } from "../../src/lib/json-value";
import {
	ArchiveChanged,
	accessCleanup,
	type AgreementScan,
	eligibleForRetention,
	ListedObjectGone,
	listedObject,
	ManifestStale,
	type MarkerRead,
	manifestFresh,
	manifestUsable,
	markerAfterApply,
	markerAfterPreview,
	ObjectChanged,
	OrphanChanged,
	objectFree,
	objectUnchanged,
	objectsToDelete,
	orphanCandidate,
	orphanFound,
	orphanStillOld,
	orphanUnchanged,
	orphanUnreferenced,
	projectEvidenceUnchanged,
	type ListedObject,
	type References,
	type RetentionAgreementRow,
	type RetentionFacts,
	type RetentionManifest,
	retentionEligible,
	type SentLists,
	retentionManifest,
	type StoredAccessLink,
	type StoredAccessSession,
	type StoredAttachment,
	scanCursor,
	textOrder,
	UnattachedChanged,
	unattachedRowKept,
	unattachedToDelete,
	unattachedUnchanged,
} from "../../src/server/rules/agreement-retention";

// The retention and access clean-up rules as stories: what a preview chooses, what an apply refuses and in which stage, the
// sentences, and the exact values written. The same decisions are held to today's SQL on sqlite in
// agreement-retention-sql.test.ts.

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

const NOW = new Date("2026-11-13T12:00:00.000Z");
const DAY = 86_400_000;

const at = (offsetMs: number) =>
	new Date(NOW.getTime() + offsetMs).toISOString();

const SHA = "0".repeat(64);
const OTHER_SHA = "f".repeat(64);
const key = (name: string) => `agreements/attachments/${name}.pdf`;

const STALE = {
	refused: "ManifestStale",
	say: "Review is stale or belongs to different storage.",
};

const CHANGED = {
	refused: "ArchiveChanged",
	say: "Archive changed. Preview again.",
};

describe("the sentences", () => {
	it("are today's, character for character", () => {
		expect(new ManifestStale().say).toBe(
			"Review is stale or belongs to different storage.",
		);
		expect(new ArchiveChanged().say).toBe("Archive changed. Preview again.");
		expect(new ListedObjectGone().say).toBe("Archive changed.");
		expect(new ObjectChanged().say).toBe("Object changed.");
		expect(new UnattachedChanged().say).toBe("Unattached PDF changed.");
		expect(new OrphanChanged().say).toBe("Orphan attachment changed.");
	});
});

describe("text order", () => {
	it("is SQLite's (UTF-8 bytes), not JavaScript's (UTF-16 code units)", () => {
		// U+FF5E encodes as EF BD 9E and U+1F600 as F0 9F 98 80, so SQLite sorts U+FF5E first; in UTF-16 the emoji's high
		// surrogate (D83D) sorts before FF5E.
		expect(textOrder("～", "\u{1f600}")).toBeLessThan(0);
		expect("～" < "\u{1f600}").toBe(false);
		expect(textOrder("a", "ab")).toBeLessThan(0);
		expect(textOrder("B", "a")).toBeLessThan(0);
		expect(textOrder(at(0), at(0))).toBe(0);
	});
});

describe("the access clean-up", () => {
	const session = (
		hash: string,
		over: Partial<StoredAccessSession> = {},
	): StoredAccessSession => ({
		token_hash: hash,
		link_id: `l-${hash}`,
		expires_at: at(3_600_000),
		revoked_at: null,
		...over,
	});

	const link = (id: string, expiresMs: number): StoredAccessLink => ({
		id,
		expires_at: at(expiresMs),
	});

	const clean = (
		sessions: StoredAccessSession[],
		links: StoredAccessLink[] = [],
	) => said(accessCleanup.decide({ now: NOW }, { sessions, links }));

	const before = "2026-10-14T12:00:00.000Z";

	it("deletes nothing when nothing is old, with the cutoff 30 days before now", () => {
		expect(clean([session("s")], [link("l-s", 3_600_000)])).toEqual({
			wrote: { before, sessions: [], links: [] },
		});
	});

	it("deletes a session expired or revoked strictly before the cutoff", () => {
		expect(
			clean([
				session("expired-31", { expires_at: at(-31 * DAY) }),
				session("expired-30-1ms", { expires_at: at(-30 * DAY - 1) }),
				session("expired-30", { expires_at: at(-30 * DAY) }),
				session("expired-29", { expires_at: at(-29 * DAY) }),
				session("revoked-30-1ms", { revoked_at: at(-30 * DAY - 1) }),
				session("revoked-30", { revoked_at: at(-30 * DAY) }),
				session("revoked-hour", { revoked_at: at(-3_600_000) }),
			]),
		).toEqual({
			wrote: {
				before,
				sessions: ["expired-31", "expired-30-1ms", "revoked-30-1ms"],
				links: [],
			},
		});
	});

	it("deletes a link expired strictly before the cutoff unless a kept session points at it", () => {
		expect(
			clean(
				[
					session("live", { link_id: "kept-by-live" }),
					session("old", {
						link_id: "freed-by-old",
						expires_at: at(-31 * DAY),
					}),
					session("old-of-mixed", {
						link_id: "mixed",
						expires_at: at(-31 * DAY),
					}),
					session("live-of-mixed", { link_id: "mixed" }),
				],
				[
					link("lone", -31 * DAY),
					link("at-the-line", -30 * DAY),
					link("kept-by-live", -31 * DAY),
					link("freed-by-old", -31 * DAY),
					link("mixed", -31 * DAY),
					link("young", -29 * DAY),
				],
			),
		).toEqual({
			wrote: {
				before,
				sessions: ["old", "old-of-mixed"],
				links: ["lone", "freed-by-old"],
			},
		});
	});
});

const agreementRow = (
	id: string,
	over: Partial<RetentionAgreementRow> = {},
): RetentionAgreementRow => ({
	id,
	kind: "sow",
	offer_id: `o-${id}`,
	msa_id: null,
	status: "executed",
	text_sha256: SHA,
	attachment_manifest_json: "[]",
	ended_at: at(-DAY),
	retain_until: at(-DAY),
	legal_hold: 0,
	terminated_at: null,
	...over,
});

const emptyFacts: RetentionFacts = {
	agreements: [],
	artifacts: [],
	deliveries: [],
	notifications: [],
	projects: [],
	offers: [],
	signatures: [],
};

const project = (
	requestId: string,
	offerId: string,
	over: Partial<RetentionFacts["projects"][number]> = {},
): RetentionFacts["projects"][number] => ({
	request_id: requestId,
	offer_id: offerId,
	agreement_id: null,
	content_deleted_at: null,
	external_signature_details_json: null,
	...over,
});

describe("choosing the agreements a preview retires", () => {
	const chosen = (facts: Partial<RetentionFacts>) =>
		said(retentionEligible.decide({ now: NOW }, { ...emptyFacts, ...facts }));

	const ids = (facts: Partial<RetentionFacts>) =>
		Effect.runSync(
			retentionEligible.decide({ now: NOW }, { ...emptyFacts, ...facts }),
		).map((row) => row.id);

	const one = (
		over: Partial<RetentionAgreementRow> = {},
		facts: Partial<RetentionFacts> = {},
	) => ids({ agreements: [agreementRow("a1", over)], ...facts });

	it("chooses an executed or abandoned SOW that ended and whose retention is over, and writes the row as read", () => {
		const row = agreementRow("a1");

		expect(chosen({ agreements: [row] })).toEqual({ wrote: [row] });
		expect(one({ status: "abandoned" })).toEqual(["a1"]);
	});

	it("keeps a SOW in review or client-signed, not ended, without retain_until or with a legal hold", () => {
		expect(one({ status: "review" })).toEqual([]);
		expect(one({ status: "client_signed" })).toEqual([]);
		expect(one({ ended_at: null })).toEqual([]);
		expect(one({ retain_until: null })).toEqual([]);
		expect(one({ legal_hold: 1 })).toEqual([]);
	});

	it("chooses retain_until at this instant and keeps one a millisecond later", () => {
		expect(one({ retain_until: at(0) })).toEqual(["a1"]);
		expect(one({ retain_until: at(1) })).toEqual([]);
	});

	it("keeps an agreement whose copy is rendering, or whose copy or notice is sending, and no other status", () => {
		for (const status of ["pending", "ready", "failed"]) {
			expect(one({}, { artifacts: [{ agreement_id: "a1", status }] })).toEqual([
				"a1",
			]);
			expect(one({}, { deliveries: [{ agreement_id: "a1", status }] })).toEqual(
				["a1"],
			);
		}

		expect(
			one({}, { artifacts: [{ agreement_id: "a1", status: "rendering" }] }),
		).toEqual([]);
		expect(
			one({}, { deliveries: [{ agreement_id: "a1", status: "sending" }] }),
		).toEqual([]);
		expect(
			one({}, { notifications: [{ agreement_id: "a1", status: "sending" }] }),
		).toEqual([]);
		expect(
			one({}, { notifications: [{ agreement_id: "a1", status: "sent" }] }),
		).toEqual(["a1"]);
	});

	it("keeps an agreement a project with content uses, directly or through its offer", () => {
		expect(
			one(
				{},
				{ projects: [project("r1", "elsewhere", { agreement_id: "a1" })] },
			),
		).toEqual([]);
		expect(one({}, { projects: [project("r1", "o-a1")] })).toEqual([]);
		expect(
			one(
				{},
				{
					projects: [
						project("r1", "o-a1", {
							agreement_id: "a1",
							content_deleted_at: at(-DAY),
						}),
					],
				},
			),
		).toEqual(["a1"]);
		expect(one({}, { projects: [project("r1", "elsewhere")] })).toEqual(["a1"]);
	});

	it("does not take an MSA with no offer for the offer of a project (SQL's NULL is equal to nothing)", () => {
		expect(
			ids({
				agreements: [agreementRow("m1", { kind: "msa", offer_id: null })],
				projects: [project("r1", "o1")],
			}),
		).toEqual(["m1"]);
	});

	describe("an MSA", () => {
		const msa = (over: Partial<RetentionAgreementRow> = {}) =>
			agreementRow("m1", { kind: "msa", offer_id: null, ...over });

		const reused = (
			status: string,
			facts: Partial<RetentionFacts> = {},
		): Partial<RetentionFacts> => ({
			agreements: [msa(), ...(facts.agreements ?? [])],
			offers: [{ id: "o2", status, reused_msa_id: "m1" }],
			projects: facts.projects ?? [],
		});

		it("is chosen unsigned, or signed and terminated, and kept signed and not terminated", () => {
			expect(ids({ agreements: [msa()] })).toEqual(["m1"]);
			expect(
				ids({ agreements: [msa()], signatures: [{ agreement_id: "m1" }] }),
			).toEqual([]);
			expect(
				ids({
					agreements: [msa({ terminated_at: at(-DAY) })],
					signatures: [{ agreement_id: "m1" }],
				}),
			).toEqual(["m1"]);
		});

		it("is kept while a SOW names it as its MSA", () => {
			expect(
				ids({
					agreements: [
						msa(),
						agreementRow("a2", { status: "review", msa_id: "m1" }),
					],
				}),
			).toEqual([]);
		});

		it("is kept while a sent or draft offer reuses it, and chosen once that offer is superseded or withdrawn", () => {
			expect(ids(reused("sent"))).toEqual([]);
			expect(ids(reused("draft"))).toEqual([]);
			expect(ids(reused("superseded"))).toEqual(["m1"]);
			expect(ids(reused("withdrawn"))).toEqual(["m1"]);
		});

		it("is chosen when the sent offer reusing it has a project whose content was deleted", () => {
			expect(
				ids(
					reused("sent", {
						projects: [project("r2", "o2", { content_deleted_at: at(-DAY) })],
					}),
				),
			).toEqual(["m1"]);
		});

		it("is kept while any offer reusing it has a project with content, or an agreement of its own", () => {
			expect(
				ids(reused("superseded", { projects: [project("r2", "o2")] })),
			).toEqual([]);
			expect(
				ids(
					reused("superseded", {
						agreements: [
							agreementRow("a2", {
								status: "abandoned",
								offer_id: "o2",
								retain_until: at(DAY),
							}),
						],
					}),
				),
			).toEqual([]);
		});
	});

	it("chooses the first 20 eligible agreements in id order", () => {
		const agreements = Array.from({ length: 21 }, (_, index) =>
			agreementRow(`a${String(20 - index).padStart(3, "0")}`),
		);

		expect(ids({ agreements })).toEqual(
			Array.from(
				{ length: 20 },
				(_, index) => `a${String(index).padStart(3, "0")}`,
			),
		);
	});

	it("names each condition, in the order of today's SQL", () => {
		expect(
			eligibleForRetention({
				agreement: agreementRow("a1"),
				facts: emptyFacts,
				now: NOW.toISOString(),
			}),
		).toBe(true);
	});
});

describe("an object the agreement's listing named", () => {
	it("goes into the manifest with its digest while it is stored", () => {
		expect(
			said(
				listedObject.decide(
					{ key: "agreements/a1/signed.pdf" },
					{ digest: SHA },
				),
			),
		).toEqual({ wrote: { key: "agreements/a1/signed.pdf", sha256: SHA } });
	});

	it("stops the preview when it is gone, with today's shorter sentence", () => {
		expect(
			said(
				listedObject.decide(
					{ key: "agreements/a1/signed.pdf" },
					{ digest: null },
				),
			),
		).toEqual({ refused: "ListedObjectGone", say: "Archive changed." });
	});
});

const references = (
	agreements: References["agreements"] = [],
	offers: References["offers"] = [],
): References => ({ agreements, offers });

describe("the objects a retiring agreement takes with it", () => {
	const listed = [
		{ key: "agreements/a1/signed.pdf", sha256: SHA },
		{ key: "agreements/a1/certificate.pdf", sha256: OTHER_SHA },
	];

	const decide = (
		id: string,
		retiring: { id: string; attachments: { key: string; sha256: string }[] }[],
		refs: References,
		own = id === "a1" ? listed : [],
	) =>
		said(
			objectsToDelete.decide(
				{ id },
				{ retiring, listed: own, references: refs },
			),
		);

	const named = (id: string, name: string) => ({
		agreement_id: id,
		key: key(name),
	});

	it("takes its own objects and its attachments, sorted by key with localeCompare", () => {
		expect(
			decide(
				"a1",
				[{ id: "a1", attachments: [{ key: key("att1"), sha256: SHA }] }],
				references([named("a1", "att1")]),
			),
		).toEqual({
			wrote: [
				{ key: "agreements/a1/certificate.pdf", sha256: OTHER_SHA },
				{ key: "agreements/a1/signed.pdf", sha256: SHA },
				{ key: key("att1"), sha256: SHA },
			],
		});
	});

	it("leaves an attachment a kept agreement names, or an open offer without a project pins", () => {
		const retiring = [
			{ id: "a1", attachments: [{ key: key("att1"), sha256: SHA }] },
		];

		expect(
			decide(
				"a1",
				retiring,
				references([named("a1", "att1"), named("k", "att1")]),
			),
		).toEqual({ wrote: listed.toSorted((a, b) => a.key.localeCompare(b.key)) });

		for (const status of ["draft", "sent"])
			expect(
				decide(
					"a1",
					retiring,
					references(
						[],
						[{ offer_id: "o2", status, key: key("att1"), projects: 0 }],
					),
				),
			).toEqual({
				wrote: listed.toSorted((a, b) => a.key.localeCompare(b.key)),
			});
	});

	it("takes an attachment pinned only by an offer with a project, or by a superseded or withdrawn offer", () => {
		const retiring = [
			{ id: "a1", attachments: [{ key: key("att1"), sha256: SHA }] },
		];

		for (const pin of [
			{ offer_id: "o2", status: "sent", key: key("att1"), projects: 1 },
			{ offer_id: "o2", status: "superseded", key: key("att1"), projects: 0 },
			{ offer_id: "o2", status: "withdrawn", key: key("att1"), projects: 0 },
			{ offer_id: "o2", status: "sent", key: 5, projects: 0 },
		])
			expect(decide("a1", retiring, references([], [pin]))).toEqual({
				wrote: [
					{ key: "agreements/a1/certificate.pdf", sha256: OTHER_SHA },
					{ key: "agreements/a1/signed.pdf", sha256: SHA },
					{ key: key("att1"), sha256: SHA },
				],
			});
	});

	it("gives an attachment two retiring agreements name to the last of them", () => {
		const retiring = [
			{ id: "a1", attachments: [{ key: key("att1"), sha256: SHA }] },
			{ id: "a2", attachments: [{ key: key("att1"), sha256: SHA }] },
		];

		const refs = references([named("a1", "att1"), named("a2", "att1")]);

		expect(decide("a1", retiring, refs)).toEqual({
			wrote: listed.toSorted((a, b) => a.key.localeCompare(b.key)),
		});
		expect(decide("a2", retiring, refs)).toEqual({
			wrote: [{ key: key("att1"), sha256: SHA }],
		});
	});
});

describe("the unattached PDFs a preview lists", () => {
	const row = (id: string, createdAt = at(-31 * DAY)) => ({
		id,
		object_key: key(id),
		sha256: SHA,
		created_at: createdAt,
	});

	const list = (
		rows: ReturnType<typeof row>[],
		refs: References = references(),
	) =>
		said(
			unattachedToDelete.decide(
				{ now: NOW },
				{ attachments: rows, references: refs },
			),
		);

	it("lists a row 30 days old or older, in the manifest's fields", () => {
		expect(list([row("u1"), row("u2", at(-30 * DAY))])).toEqual({
			wrote: [
				{
					id: "u1",
					key: key("u1"),
					sha256: SHA,
					created_at: at(-31 * DAY),
				},
				{
					id: "u2",
					key: key("u2"),
					sha256: SHA,
					created_at: at(-30 * DAY),
				},
			],
		});
	});

	it("leaves a row a millisecond too young, one an agreement names, and one an open offer pins", () => {
		expect(
			list(
				[row("young", at(-30 * DAY + 1)), row("named"), row("pinned")],
				references(
					[{ agreement_id: "a1", key: key("named") }],
					[
						{
							offer_id: "o1",
							status: "draft",
							key: key("pinned"),
							projects: 0,
						},
					],
				),
			),
		).toEqual({ wrote: [] });
	});

	it("lists the first 100 in id order", () => {
		const rows = Array.from({ length: 101 }, (_, index) =>
			row(`u${String(100 - index).padStart(3, "0")}`),
		);

		expect(
			Effect.runSync(
				unattachedToDelete.decide(
					{ now: NOW },
					{ attachments: rows, references: references() },
				),
			).map((entry) => entry.id),
		).toEqual(
			Array.from(
				{ length: 100 },
				(_, index) => `u${String(index).padStart(3, "0")}`,
			),
		);
	});
});

const read = (saved: JsonValue): MarkerRead => ({
	kind: "read",
	etag: "e1",
	saved,
});

describe("where the owner's preview starts the orphan scan", () => {
	const start = (marker: MarkerRead) =>
		said(scanCursor.decide(null, { marker }));

	it("is the marker's cursor when it is version 1 with text of 1 to 4096 characters", () => {
		expect(start(read({ version: 1, cursor: key("a") }))).toEqual({
			wrote: key("a"),
		});
		expect(start(read({ version: 1, cursor: "z".repeat(4096) }))).toEqual({
			wrote: "z".repeat(4096),
		});
	});

	it("is the first page for no marker, an unreadable one, null, version 2, or a cursor empty, too long or not text", () => {
		for (const marker of [
			{ kind: "absent" } as const,
			{ kind: "unreadable", etag: "e1" } as const,
			read(null),
			read(7),
			read("text"),
			read([]),
			read({ version: 2, cursor: key("a") }),
			read({ version: "1", cursor: key("a") }),
			read({ version: 1, cursor: "" }),
			read({ version: 1, cursor: "z".repeat(4097) }),
			read({ version: 1, cursor: 7 }),
			read({ version: 1, cursor: null }),
		])
			expect(start(marker)).toEqual({ wrote: null });
	});
});

describe("the orphan scan", () => {
	const object = (uploaded: Date) => ({ key: key("lost"), uploaded });

	const consider = (uploaded: Date, found = 0) =>
		said(
			orphanCandidate.decide({ now: NOW }, { object: object(uploaded), found }),
		);

	it("checks an object uploaded 30 days ago or earlier, and skips a younger one", () => {
		expect(consider(new Date(at(-30 * DAY)))).toEqual({ wrote: "check" });
		expect(consider(new Date(at(-31 * DAY)))).toEqual({ wrote: "check" });
		expect(consider(new Date(at(-30 * DAY + 1)))).toEqual({ wrote: "skip" });
	});

	it("skips an object whose upload time is not a date", () => {
		// R2 always gives a Date; this is the check today's code keeps for anything else, fed a listing parsed from JSON.
		const odd: ListedObject = JSON.parse(
			JSON.stringify({ key: key("lost"), uploaded: at(-31 * DAY) }),
		);

		expect(
			said(orphanCandidate.decide({ now: NOW }, { object: odd, found: 0 })),
		).toEqual({ wrote: "skip" });
	});

	it("stops once 100 orphans are found, before looking at the object", () => {
		expect(consider(new Date(at(-31 * DAY)), 99)).toEqual({ wrote: "check" });
		expect(consider(new Date(at(-31 * DAY)), 100)).toEqual({ wrote: "stop" });
	});

	const unreferenced = (
		rows: { object_key: string }[],
		refs: References = references(),
	) =>
		said(
			orphanUnreferenced.decide(
				{ key: key("lost") },
				{ rows, references: refs },
			),
		);

	it("fetches an old object nothing references", () => {
		expect(unreferenced([])).toEqual({ wrote: { key: key("lost") } });
		expect(
			unreferenced(
				[{ object_key: key("other") }],
				references(
					[{ agreement_id: "a1", key: key("other") }],
					[{ offer_id: "o1", status: "sent", key: key("lost"), projects: 1 }],
				),
			),
		).toEqual({ wrote: { key: key("lost") } });
	});

	it("leaves an object a metadata row, an agreement or an open offer names", () => {
		expect(unreferenced([{ object_key: key("lost") }])).toEqual({
			nothing: true,
		});
		expect(
			unreferenced([], references([{ agreement_id: "a1", key: key("lost") }])),
		).toEqual({ nothing: true });
		expect(
			unreferenced(
				[],
				references(
					[],
					[{ offer_id: "o1", status: "sent", key: key("lost"), projects: 0 }],
				),
			),
		).toEqual({ nothing: true });
	});

	it("lists a fetched object with its digest and upload time, and skips one that is gone", () => {
		const uploaded = new Date(at(-31 * DAY));

		expect(
			said(orphanFound.decide({ object: object(uploaded) }, { digest: SHA })),
		).toEqual({
			wrote: { key: key("lost"), sha256: SHA, uploaded_at: at(-31 * DAY) },
		});
		expect(
			said(orphanFound.decide({ object: object(uploaded) }, { digest: null })),
		).toEqual({ nothing: true });
	});

	const after = (reviewed: boolean, found: number, nextCursor: string | null) =>
		said(markerAfterPreview.decide({ reviewed, nextCursor }, { found }));

	it("moves the marker on after the owner's preview found no orphans", () => {
		expect(after(false, 0, null)).toEqual({
			wrote: {
				key: "agreements/retention/attachment-cursor.json",
				body: '{"version":1,"cursor":null}',
			},
		});
		expect(after(false, 0, key("o099"))).toEqual({
			wrote: {
				key: "agreements/retention/attachment-cursor.json",
				body: `{"version":1,"cursor":"${key("o099")}"}`,
			},
		});
	});

	it("leaves the marker after a scan that found orphans, or the apply's scan", () => {
		expect(after(false, 1, null)).toEqual({ nothing: true });
		expect(after(true, 0, null)).toEqual({ nothing: true });
	});
});

describe("the manifest", () => {
	const scan: AgreementScan = {
		row: { id: "a1", text_sha256: SHA },
		rowHash: "1".repeat(64),
		projectEvidence: [
			{ request_id: "r2", external_signature_details_json: null },
			{ request_id: "r1", external_signature_details_json: '{"who":"x"}' },
		],
		objects: [{ key: "agreements/a1/signed.pdf", sha256: SHA }],
	};

	it("is written field for field in today's order, evidence by request id, orphans by key", () => {
		const answer = said(
			retentionManifest.decide(
				{
					now: NOW,
					binding: "AUDIO:superhuman-audio",
					scanCursor: null,
					nextCursor: key("z"),
				},
				{
					agreements: [scan],
					unattached: [
						{
							id: "u1",
							key: key("u1"),
							sha256: SHA,
							created_at: at(-31 * DAY),
						},
					],
					orphans: [
						{ key: key("b"), sha256: SHA, uploaded_at: at(-31 * DAY) },
						{ key: key("a"), sha256: SHA, uploaded_at: at(-31 * DAY) },
					],
				},
			),
		);

		expect("wrote" in answer && JSON.stringify(answer.wrote)).toBe(
			JSON.stringify({
				version: 1,
				created_at: "2026-11-13T12:00:00.000Z",
				binding: "AUDIO:superhuman-audio",
				agreements: [
					{
						id: "a1",
						sha256: SHA,
						row_hash: "1".repeat(64),
						project_evidence: [
							{
								request_id: "r1",
								external_signature_details_json: '{"who":"x"}',
							},
							{ request_id: "r2", external_signature_details_json: null },
						],
						objects: [{ key: "agreements/a1/signed.pdf", sha256: SHA }],
					},
				],
				unattached_attachments: [
					{ id: "u1", key: key("u1"), sha256: SHA, created_at: at(-31 * DAY) },
				],
				orphan_attachments: [
					{ key: key("a"), sha256: SHA, uploaded_at: at(-31 * DAY) },
					{ key: key("b"), sha256: SHA, uploaded_at: at(-31 * DAY) },
				],
				orphan_scan_cursor: null,
				orphan_next_cursor: key("z"),
			}),
		);
	});
});

const BINDING = "AUDIO:superhuman-audio";

const reviewed = (over: { [field: string]: CanonicalJson } = {}) => ({
	version: 1,
	created_at: NOW.toISOString(),
	binding: BINDING,
	agreements: [],
	unattached_attachments: [],
	orphan_attachments: [],
	orphan_scan_cursor: null,
	orphan_next_cursor: null,
	...over,
});

describe("stage 1 of the apply: a usable manifest", () => {
	const usable = (manifest: CanonicalJson, now = NOW) =>
		said(manifestUsable.decide({ now, binding: BINDING }, { manifest }));

	it("accepts the preview's manifest, with no cursor, and the lists to compare", () => {
		expect(usable(reviewed())).toEqual({
			wrote: {
				cursor: null,
				sent: { agreements: [], unattached: [], orphans: [] },
			},
		});
	});

	it("accepts a manifest exactly 24 hours old, orphans left out (as none), and a cursor of 4096 characters", () => {
		expect(usable(reviewed(), new Date(NOW.getTime() + DAY))).toEqual({
			wrote: {
				cursor: null,
				sent: { agreements: [], unattached: [], orphans: [] },
			},
		});
		expect(usable(reviewed({ orphan_attachments: undefined }))).toEqual({
			wrote: {
				cursor: null,
				sent: { agreements: [], unattached: [], orphans: [] },
			},
		});
		expect(usable(reviewed({ orphan_scan_cursor: "z".repeat(4096) }))).toEqual({
			wrote: {
				cursor: "z".repeat(4096),
				sent: { agreements: [], unattached: [], orphans: [] },
			},
		});
	});

	it("refuses anything that is not an object with a list of agreements", () => {
		for (const manifest of [
			undefined,
			null,
			"manifest",
			7,
			[],
			{},
			{ version: 1, binding: BINDING, created_at: NOW.toISOString() },
			reviewed({ agreements: undefined }),
			reviewed({ agreements: {} }),
		])
			expect(usable(manifest), JSON.stringify(manifest)).toEqual(STALE);
	});

	it("refuses another version, another binding, a created_at that is not a date, in the future or over 24 hours old", () => {
		for (const manifest of [
			reviewed({ version: 2 }),
			reviewed({ version: "1" }),
			reviewed({ binding: "AUDIO:other" }),
			reviewed({ created_at: "nope" }),
			reviewed({ created_at: undefined }),
			reviewed({ created_at: "2026-11-13T13:00:00.000Z" }),
			reviewed({ created_at: "2026-11-13T12:00:00.001Z" }),
		])
			expect(usable(manifest), JSON.stringify(manifest)).toEqual(STALE);

		expect(usable(reviewed(), new Date(NOW.getTime() + DAY + 1))).toEqual(
			STALE,
		);
	});

	it("refuses lists over their limits or not lists, and a cursor that is empty, too long or not text", () => {
		for (const manifest of [
			reviewed({ agreements: Array.from({ length: 21 }, () => ({})) }),
			reviewed({ unattached_attachments: "x" }),
			reviewed({ unattached_attachments: undefined }),
			reviewed({
				unattached_attachments: Array.from({ length: 101 }, () => ({})),
			}),
			reviewed({ orphan_attachments: {} }),
			reviewed({ orphan_attachments: null }),
			reviewed({ orphan_attachments: Array.from({ length: 101 }, () => ({})) }),
			reviewed({ orphan_scan_cursor: 5 }),
			reviewed({ orphan_scan_cursor: "" }),
			reviewed({ orphan_scan_cursor: "z".repeat(4097) }),
		])
			expect(usable(manifest)).toEqual(STALE);
	});

	it("accepts lists at their limits (their items are compared in stage 2)", () => {
		const agreements = Array.from({ length: 20 }, () => ({}));

		expect(
			usable(
				reviewed({
					agreements,
					unattached_attachments: Array.from({ length: 100 }, () => 1),
					orphan_attachments: Array.from({ length: 100 }, () => 2),
					orphan_scan_cursor: key("a"),
				}),
			),
		).toEqual({
			wrote: {
				cursor: key("a"),
				sent: {
					agreements,
					unattached: Array.from({ length: 100 }, () => 1),
					orphans: Array.from({ length: 100 }, () => 2),
				},
			},
		});
	});
});

describe("stage 2 of the apply: a fresh scan finds what was reviewed", () => {
	const entry = {
		id: "a1",
		sha256: SHA,
		row_hash: "1".repeat(64),
		project_evidence: [],
		objects: [{ key: "agreements/a1/signed.pdf", sha256: SHA }],
	};

	const fresh: RetentionManifest = {
		...reviewed(),
		version: 1,
		agreements: [entry],
		unattached_attachments: [
			{ id: "u1", key: key("u1"), sha256: SHA, created_at: at(-31 * DAY) },
		],
		orphan_attachments: [],
		orphan_next_cursor: key("next"),
	};

	const compare = (sent: SentLists) =>
		said(manifestFresh.decide(null, { sent, fresh }));

	const same = {
		agreements: [entry],
		unattached: fresh.unattached_attachments,
		orphans: [],
	};

	it("writes the fresh scan's lists and next cursor when they equal the reviewed ones, in any key order", () => {
		const written = {
			wrote: {
				agreements: [entry],
				unattached: fresh.unattached_attachments,
				orphans: [],
				nextCursor: key("next"),
			},
		};

		expect(compare(same)).toEqual(written);
		expect(
			compare({
				...same,
				agreements: [
					{
						objects: entry.objects,
						project_evidence: [],
						row_hash: entry.row_hash,
						sha256: SHA,
						id: "a1",
					},
				],
			}),
		).toEqual(written);
	});

	it("refuses any difference: a digest, an object, an extra agreement, the row hash, an unattached PDF or an orphan", () => {
		for (const sent of [
			{ ...same, agreements: [{ ...entry, sha256: OTHER_SHA }] },
			{ ...same, agreements: [{ ...entry, objects: [] }] },
			{ ...same, agreements: [entry, { ...entry, id: "a9" }] },
			{ ...same, agreements: [{ ...entry, row_hash: "0" }] },
			{ ...same, agreements: [{ ...entry, extra: 1 }] },
			{ ...same, unattached: [] },
			{
				...same,
				orphans: [{ key: key("x"), sha256: SHA, uploaded_at: at(-40 * DAY) }],
			},
		])
			expect(compare(sent)).toEqual(CHANGED);
	});
});

describe("each object of a closing agreement", () => {
	const object = { key: "agreements/a1/signed.pdf", sha256: SHA };

	const check = (digest: string | null) =>
		said(objectUnchanged.decide({ object }, { digest }));

	it("is deleted when it has the reviewed digest, and when it is already gone", () => {
		expect(check(SHA)).toEqual({ wrote: { key: object.key } });
		expect(check(null)).toEqual({ wrote: { key: object.key } });
	});

	it("stops the apply when its bytes have another digest", () => {
		expect(check(OTHER_SHA)).toEqual({
			refused: "ObjectChanged",
			say: "Object changed.",
		});
	});
});

describe("an unattached PDF in the apply", () => {
	const entry = {
		id: "u1",
		key: key("u1"),
		sha256: SHA,
		created_at: at(-31 * DAY),
	};

	const row: StoredAttachment = {
		id: "u1",
		request_id: "r1",
		filename: "u1.pdf",
		version: "1",
		document_date: "2026-10-01",
		object_key: key("u1"),
		sha256: SHA,
		bytes: 10,
		created_at: at(-31 * DAY),
		created_by: "owner@example.test",
	};

	it("keeps its metadata row to put back, when the row is the reviewed one", () => {
		expect(said(unattachedRowKept.decide({ entry }, { row }))).toEqual({
			wrote: row,
		});
	});

	it("refuses with the archive's sentence when the row is gone or changed", () => {
		for (const changed of [
			null,
			{ ...row, object_key: key("other") },
			{ ...row, sha256: OTHER_SHA },
			{ ...row, created_at: at(-32 * DAY) },
			{ ...row, id: "u2" },
		])
			expect(
				said(unattachedRowKept.decide({ entry }, { row: changed })),
			).toEqual(CHANGED);
	});

	const unchanged = (digest: string | null) =>
		said(unattachedUnchanged.decide({ entry, now: NOW }, { digest }));

	it("is deleted under the 30-day cutoff, with its object when it was stored", () => {
		expect(unchanged(SHA)).toEqual({
			wrote: { cutoff: "2026-10-14T12:00:00.000Z", deleteObject: true },
		});
		expect(unchanged(null)).toEqual({
			wrote: { cutoff: "2026-10-14T12:00:00.000Z", deleteObject: false },
		});
	});

	it("stops the apply when the stored bytes have another digest", () => {
		expect(unchanged(OTHER_SHA)).toEqual({
			refused: "UnattachedChanged",
			say: "Unattached PDF changed.",
		});
	});
});

describe("an orphan in the apply", () => {
	const orphan = {
		key: key("lost"),
		sha256: SHA,
		uploaded_at: at(-30 * DAY),
	};

	const old = (over: Partial<typeof orphan>) =>
		said(
			orphanStillOld.decide({ now: NOW }, { orphan: { ...orphan, ...over } }),
		);

	it("is read again when it is 30 days old under the attachment prefix", () => {
		expect(old({})).toEqual({ wrote: { key: key("lost") } });
	});

	it("refuses with the archive's sentence when it is younger, its time is not a date, or it is outside the prefix", () => {
		expect(old({ uploaded_at: at(-30 * DAY + 1) })).toEqual(CHANGED);
		expect(old({ uploaded_at: "nope" })).toEqual(CHANGED);
		expect(old({ key: "agreements/other/lost.pdf" })).toEqual(CHANGED);
	});

	const unchanged = (digest: string | null) =>
		said(orphanUnchanged.decide({ orphan }, { digest }));

	it("is deleted when still stored with the reviewed digest, and refused when gone or changed", () => {
		expect(unchanged(SHA)).toEqual({ wrote: { key: key("lost") } });

		const refused = {
			refused: "OrphanChanged",
			say: "Orphan attachment changed.",
		};

		expect(unchanged(null)).toEqual(refused);
		expect(unchanged(OTHER_SHA)).toEqual(refused);
	});
});

describe("the marker after an apply", () => {
	const after = (marker: MarkerRead, reviewedCursor: string | null) =>
		said(
			markerAfterApply.decide(
				{ reviewedCursor, nextCursor: key("next") },
				{ marker },
			),
		);

	const body = `{"version":1,"cursor":"${key("next")}"}`;
	const KEY = "agreements/retention/attachment-cursor.json";

	it("is created only if there is still none, when the reviewed scan started at the first page", () => {
		expect(after({ kind: "absent" }, null)).toEqual({
			wrote: { key: KEY, body, onlyIf: { etagDoesNotMatch: "*" } },
		});
	});

	it("is replaced only if unchanged when it holds the reviewed cursor, or none (unreadable, null, another version)", () => {
		const replaced = {
			wrote: { key: KEY, body, onlyIf: { etagMatches: "e1" } },
		};

		expect(after(read({ version: 1, cursor: key("a") }), key("a"))).toEqual(
			replaced,
		);
		expect(after({ kind: "unreadable", etag: "e1" }, null)).toEqual(replaced);
		expect(after(read(null), null)).toEqual(replaced);
		expect(after(read({ version: 2, cursor: key("a") }), null)).toEqual(
			replaced,
		);
	});

	it("is left when it holds another cursor than the reviewed one", () => {
		expect(after(read({ version: 1, cursor: key("b") }), key("a"))).toEqual({
			nothing: true,
		});
		expect(after({ kind: "absent" }, key("a"))).toEqual({ nothing: true });
		expect(after(read({ version: 1, cursor: key("a") }), null)).toEqual({
			nothing: true,
		});
	});

	it("reads a cursor of any length, unlike the preview", () => {
		expect(after(read({ version: 1, cursor: "" }), null)).toEqual({
			nothing: true,
		});
		expect(
			after(read({ version: 1, cursor: "z".repeat(5000) }), "z".repeat(5000)),
		).toEqual({ wrote: { key: KEY, body, onlyIf: { etagMatches: "e1" } } });
	});
});

describe("what A25 re-checks", () => {
	const item = (
		evidence: {
			request_id: string;
			external_signature_details_json: string | null;
		}[],
	) => ({
		id: "a1",
		project_evidence: evidence,
	});

	const agreements = [{ id: "a1", offer_id: "o1" }];

	it("holds the project evidence when the offer's projects are the reviewed ones, details compared with IS", () => {
		const projects = [
			project("r1", "o1", { external_signature_details_json: null }),
			project("r2", "o1", { external_signature_details_json: "{}" }),
			project("r3", "elsewhere"),
		];

		expect(
			projectEvidenceUnchanged(
				item([
					{ request_id: "r1", external_signature_details_json: null },
					{ request_id: "r2", external_signature_details_json: "{}" },
				]),
				agreements,
				projects,
			),
		).toBe(true);
		expect(
			projectEvidenceUnchanged(
				item([{ request_id: "r1", external_signature_details_json: null }]),
				agreements,
				projects,
			),
		).toBe(false);
		expect(
			projectEvidenceUnchanged(
				item([
					{ request_id: "r1", external_signature_details_json: "{}" },
					{ request_id: "r2", external_signature_details_json: "{}" },
				]),
				agreements,
				projects,
			),
		).toBe(false);
	});

	it("counts no project for an agreement that is gone or has no offer", () => {
		expect(projectEvidenceUnchanged(item([]), [], [project("r1", "o1")])).toBe(
			true,
		);
		expect(
			projectEvidenceUnchanged(
				item([]),
				[{ id: "a1", offer_id: null }],
				[project("r1", "o1")],
			),
		).toBe(true);
	});

	it("frees an object no other agreement names and no open offer pins", () => {
		const refs = references([{ agreement_id: "a1", key: key("k") }]);

		expect(objectFree(key("k"), "a1", refs)).toBe(true);
		expect(objectFree(key("k"), "a2", refs)).toBe(false);
		expect(
			objectFree(
				key("k"),
				"a1",
				references(
					[],
					[{ offer_id: "o", status: "draft", key: key("k"), projects: 0 }],
				),
			),
		).toBe(false);
	});
});
