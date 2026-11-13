import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/agreements";
import { PUT } from "~/pages/api/owner/requests/[id]/agreement-attachments";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	act,
	agreementSessionRow,
	form,
	linkRow,
	merge,
	offerSeed,
	ORIGIN,
	PDF,
	sql,
} from "./areas/agreement-admin";

// The golden corpus for POST /api/owner/agreements, actions "access-cleanup" (delete old agreement sessions and links) and
// "setting" (switch website signing on or off).
//
// Every response branch of the handler and cleanupAgreementAccess (src/lib/agreement-access.ts), and its cases:
//
//   access-cleanup
//     200 {ok:true} / form 303 to /owner/agreements   confirmed true; nothing to delete; every session and link age at, just before
//                         and just after the 30 day line (expires_at < cutoff or revoked_at < cutoff, both strict); a link that a session
//                         still points at (kept) and one whose only session was deleted in the same batch (deleted); both purposes; the
//                         clock moved 31 days; repeated; many rows
//     400 "Check required fields and limits."   confirmed missing, false, "true", 1, 0, null, a form without it or with yes
//     409 {error: message}                      the sessions delete or the links delete fails (the batch rolls back)
//   setting
//     200 {ok:true} / form 303                  enable, disable, enable twice, toggles, updated_at and updated_by recorded, a missing
//                         settings row (the UPDATE changes nothing and the answer is still ok), a second owner email, the clock moved, form
//                         values on, true, false, empty, yes, 1 and absent (absent means off), confirmed in each spelling
//     400                                       enabled not a boolean (text, number, null, array, object, absent in JSON), confirmed missing
//                         or not true
//     409                                       the UPDATE fails
//     sequences                                 switch on then attach a PDF (the setting is read by the attachment route), switch off then
//                         attach (404)

const DAY = 86_400_000;
const NOW_MS = Date.parse("2026-11-13T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();

const dumpAccess = {
	music: ["software_agreement_sessions", "software_agreement_links"],
};

const dumpSetting = { music: ["software_signing_settings"] };

const cleanup = (extra: Partial<Step> = {}) =>
	act(
		{ action: "access-cleanup", confirmed: true },
		{ dump: dumpAccess, ...extra },
	);

const cleanForm = (
	fields: { [name: string]: string } = { confirmed: "true" },
	extra: Partial<Step> = {},
) =>
	form({ action: "access-cleanup", ...fields }, { dump: dumpAccess, ...extra });

/** One link (kept unless it is old) and, optionally, one session of it. */
const linked = (
	id: string,
	over: {
		link?: SeedRow;
		session?: SeedRow | null;
		purpose?: "agreement" | "archive";
	} = {},
): Seed => {
	const purpose = over.purpose ?? "archive";

	return {
		software_agreement_links: [
			linkRow(`l-${id}`, purpose, {
				expires_at: at(3_600_000),
				...over.link,
				offer_id: purpose === "agreement" ? "o-r1" : null,
			}),
		],
		software_agreement_sessions:
			over.session === null
				? []
				: [
						agreementSessionRow({ value: "", hash: `h-${id}` }, purpose, {
							link_id: `l-${id}`,
							expires_at: at(3_600_000),
							...over.session,
							offer_id: purpose === "agreement" ? "o-r1" : null,
						}),
					],
	};
};

const withOffer = (...seeds: Seed[]) => merge(offerSeed("r1"), ...seeds);

const scene = (
	name: string,
	seed: Seed,
	step: Step | Step[] = cleanup(),
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: withOffer(seed) },
	steps: Array.isArray(step) ? step : [step],
	...extra,
});

const sessionAge = (name: string, session: SeedRow, link: SeedRow = {}) =>
	scene(name, linked("s", { session, link }));

const linkAge = (
	name: string,
	expiresMs: number,
	withSession: SeedRow | null = null,
) =>
	scene(
		name,
		linked("k", { link: { expires_at: at(expiresMs) }, session: withSession }),
	);

const cleaningCases: Case[] = [
	scene("nothing to clean", {}),
	sessionAge("a session expired 31 days ago", { expires_at: at(-31 * DAY) }),
	sessionAge("a session expired 30 days and a millisecond ago", {
		expires_at: at(-30 * DAY - 1),
	}),
	sessionAge("a session expiring exactly at the 30 day line is kept", {
		expires_at: at(-30 * DAY),
	}),
	sessionAge("a session expired 30 days less a millisecond ago is kept", {
		expires_at: at(-30 * DAY + 1),
	}),
	sessionAge("a session expired 29 days ago is kept", {
		expires_at: at(-29 * DAY),
	}),
	sessionAge("a session expired an hour ago is kept", {
		expires_at: at(-3_600_000),
	}),
	sessionAge("a live session is kept", { expires_at: at(3_600_000) }),
	sessionAge("a session that expires in 40 days is kept", {
		expires_at: at(40 * DAY),
	}),
	sessionAge("a session revoked 31 days ago is deleted", {
		revoked_at: at(-31 * DAY),
	}),
	sessionAge("a session revoked 30 days and a millisecond ago is deleted", {
		revoked_at: at(-30 * DAY - 1),
	}),
	sessionAge("a session revoked exactly 30 days ago is kept", {
		revoked_at: at(-30 * DAY),
	}),
	sessionAge("a session revoked 29 days ago is kept", {
		revoked_at: at(-29 * DAY),
	}),
	sessionAge("a session revoked an hour ago is kept", {
		revoked_at: at(-3_600_000),
	}),
	sessionAge("a never-revoked session has no revoked_at to compare", {
		revoked_at: null,
	}),
	scene(
		"an agreement-purpose session is cleaned the same way",
		linked("g", {
			purpose: "agreement",
			session: { expires_at: at(-31 * DAY) },
		}),
	),
	linkAge(
		"a link that expired 31 days ago with no session is deleted",
		-31 * DAY,
	),
	linkAge(
		"a link that expired 30 days and a millisecond ago is deleted",
		-30 * DAY - 1,
	),
	linkAge("a link expiring exactly at the 30 day line is kept", -30 * DAY),
	linkAge("a link that expired 29 days ago is kept", -29 * DAY),
	linkAge("a link that has not expired is kept", 3_600_000),
	linkAge("an old link that a live session points at is kept", -31 * DAY, {
		expires_at: at(3_600_000),
	}),
	linkAge(
		"an old link whose only session is old is deleted with it",
		-31 * DAY,
		{ expires_at: at(-31 * DAY) },
	),
	linkAge(
		"an old link whose session is revoked long ago is deleted with it",
		-31 * DAY,
		{ revoked_at: at(-31 * DAY) },
	),
	scene(
		"an old link with one old and one live session is kept",
		merge(
			linked("a", {
				link: { expires_at: at(-31 * DAY) },
				session: { expires_at: at(-31 * DAY) },
			}),
			{
				software_agreement_sessions: [
					agreementSessionRow({ value: "", hash: "h-live" }, "archive", {
						link_id: "l-a",
						expires_at: at(3_600_000),
						offer_id: null,
					}),
				],
			},
		),
	),
	scene(
		"old and live rows together",
		merge(
			linked("a", {
				link: { expires_at: at(-40 * DAY) },
				session: { expires_at: at(-40 * DAY) },
			}),
			linked("b"),
			linked("c", { link: { expires_at: at(-35 * DAY) }, session: null }),
			linked("d", { session: { revoked_at: at(-33 * DAY) } }),
		),
	),
	scene(
		"fifty old sessions",
		merge(
			...Array.from({ length: 50 }, (_, index) =>
				linked(`n${index}`, {
					link: { expires_at: at(-31 * DAY) },
					session: { expires_at: at(-31 * DAY) },
				}),
			),
		),
	),
	scene(
		"rows fresh now are old thirty-one days later",
		linked("a", {
			link: { expires_at: at(3_600_000) },
			session: { expires_at: at(3_600_000) },
		}),
		[cleanup(), cleanup({ advanceMs: 31 * DAY + 3_600_001 })],
	),
	scene(
		"the same cleanup twice",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		[cleanup(), cleanup({ advanceMs: 1000 })],
	),
	scene(
		"the owner may be anyone the middleware lets through",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		cleanup({ as: asOwner("second@example.test") }),
	),
	scene(
		"a visitor cannot clean",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		cleanup({ as: asVisitor() }),
	),

	// the body
	scene(
		"confirmed missing",
		{},
		act({ action: "access-cleanup" }, { dump: dumpAccess }),
	),
	scene(
		"confirmed false",
		{},
		act({ action: "access-cleanup", confirmed: false }, { dump: dumpAccess }),
	),
	scene(
		"confirmed as the text true",
		{},
		act({ action: "access-cleanup", confirmed: "true" }, { dump: dumpAccess }),
	),
	scene(
		"confirmed as the number one",
		{},
		act({ action: "access-cleanup", confirmed: 1 }, { dump: dumpAccess }),
	),
	scene(
		"confirmed as zero",
		{},
		act({ action: "access-cleanup", confirmed: 0 }, { dump: dumpAccess }),
	),
	scene(
		"confirmed null",
		{},
		act({ action: "access-cleanup", confirmed: null }, { dump: dumpAccess }),
	),
	scene(
		"extra fields are ignored",
		{},
		act(
			{
				action: "access-cleanup",
				confirmed: true,
				manifest: { x: 1 },
				kind: "msa",
			},
			{ dump: dumpAccess },
		),
	),
	scene(
		"a native form redirects",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		cleanForm(),
	),
	scene("a native form with confirmed on", {}, cleanForm({ confirmed: "on" })),
	scene(
		"a native form with confirmed false",
		{},
		cleanForm({ confirmed: "false" }),
	),
	scene(
		"a native form with confirmed yes",
		{},
		cleanForm({ confirmed: "yes" }),
	),
	scene("a native form without confirmed", {}, cleanForm({})),

	// outages
	scene(
		"the sessions delete fails",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		cleanup(),
		{
			failures: [
				{ on: /DELETE FROM software_agreement_sessions/, message: "d1 down" },
			],
		},
	),
	scene(
		"the links delete fails and the batch rolls back",
		linked("a", {
			link: { expires_at: at(-31 * DAY) },
			session: { expires_at: at(-31 * DAY) },
		}),
		cleanup(),
		{
			failures: [
				{ on: /DELETE FROM software_agreement_links/, message: "d1 down" },
			],
		},
	),
	scene(
		"a form post whose cleanup fails shows the error page",
		{},
		cleanForm(),
		{
			failures: [
				{
					on: /DELETE FROM software_agreement_sessions/,
					message: 'd1 <down> & "out"',
				},
			],
		},
	),
];

const SETTING_ON =
	"UPDATE software_signing_settings SET software_signing_enabled=1,updated_by='earlier',updated_at='2026-11-01T00:00:00.000Z'";

const setting = (
	body: { [key: string]: JsonValue | undefined },
	extra: Partial<Step> = {},
) => act({ action: "setting", ...body }, { dump: dumpSetting, ...extra });

const settingForm = (
	fields: { [name: string]: string },
	extra: Partial<Step> = {},
) => form({ action: "setting", ...fields }, { dump: dumpSetting, ...extra });

/** The migration stamps the settings row with the real clock, so each case pins it before it starts. */
const PIN =
	"UPDATE software_signing_settings SET updated_at='2026-11-01T00:00:00.000Z'";

const settingScene = (
	name: string,
	step: Step | Step[],
	extra: Partial<Case> = {},
): Case => ({
	name,
	steps: Array.isArray(step) ? step : [step],
	...extra,
	setup: async (world) => {
		world.music.exec(PIN);
		await extra.setup?.(world);
	},
});

const settingCases: Case[] = [
	settingScene(
		"signing is switched on",
		setting({ enabled: true, confirmed: true }),
	),
	settingScene(
		"signing is switched off",
		setting({ enabled: false, confirmed: true }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene("switching on twice keeps it on and moves updated_at", [
		setting({ enabled: true, confirmed: true }),
		setting({ enabled: true, confirmed: true }, { advanceMs: 60_000 }),
	]),
	settingScene("on, off, on", [
		setting({ enabled: true, confirmed: true }),
		setting({ enabled: false, confirmed: true }, { advanceMs: 1000 }),
		setting({ enabled: true, confirmed: true }, { advanceMs: 1000 }),
	]),
	settingScene(
		"a second owner is recorded",
		setting(
			{ enabled: true, confirmed: true },
			{ as: asOwner("second@example.test") },
		),
	),
	settingScene(
		"a visitor cannot switch signing",
		setting({ enabled: true, confirmed: true }, { as: asVisitor() }),
	),
	settingScene(
		"the settings row is missing and the answer is still ok",
		setting({ enabled: true, confirmed: true }),
		{ setup: sql("DELETE FROM software_signing_settings") },
	),
	settingScene(
		"the UPDATE fails",
		setting({ enabled: true, confirmed: true }),
		{
			failures: [
				{ on: /UPDATE software_signing_settings/, message: "d1 down" },
			],
		},
	),

	// JSON bodies
	settingScene(
		"enabled as the text true",
		setting({ enabled: "true", confirmed: true }),
	),
	settingScene(
		"enabled as the text false",
		setting({ enabled: "false", confirmed: true }),
	),
	settingScene(
		"enabled as the number one",
		setting({ enabled: 1, confirmed: true }),
	),
	settingScene("enabled as zero", setting({ enabled: 0, confirmed: true })),
	settingScene("enabled null", setting({ enabled: null, confirmed: true })),
	settingScene(
		"enabled the text on",
		setting({ enabled: "on", confirmed: true }),
	),
	settingScene(
		"enabled an array",
		setting({ enabled: [true], confirmed: true }),
	),
	settingScene("enabled an object", setting({ enabled: {}, confirmed: true })),
	settingScene("enabled left out", setting({ confirmed: true })),
	settingScene(
		"the setting with confirmed missing",
		setting({ enabled: true }),
	),
	settingScene(
		"the setting with confirmed false",
		setting({ enabled: true, confirmed: false }),
	),
	settingScene(
		"the setting with confirmed as the text true",
		setting({ enabled: true, confirmed: "true" }),
	),
	settingScene(
		"the setting with confirmed as the number one",
		setting({ enabled: true, confirmed: 1 }),
	),
	settingScene(
		"the setting with confirmed null",
		setting({ enabled: true, confirmed: null }),
	),
	settingScene(
		"the setting with extra fields are ignored",
		setting({ enabled: true, confirmed: true, kind: "msa", junk: [1] }),
	),

	// forms
	settingScene(
		"a form with enabled on",
		settingForm({ enabled: "on", confirmed: "true" }),
	),
	settingScene(
		"a form with enabled true",
		settingForm({ enabled: "true", confirmed: "true" }),
	),
	settingScene(
		"a form with enabled false turns it off",
		settingForm({ enabled: "false", confirmed: "true" }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene(
		"a form with enabled empty turns it off",
		settingForm({ enabled: "", confirmed: "true" }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene(
		"a form with enabled yes turns it off",
		settingForm({ enabled: "yes", confirmed: "true" }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene(
		"a form with enabled 1 turns it off",
		settingForm({ enabled: "1", confirmed: "true" }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene(
		"a form with enabled absent turns it off",
		settingForm({ confirmed: "true" }),
		{ setup: sql(SETTING_ON) },
	),
	settingScene(
		"a form with confirmed on",
		settingForm({ enabled: "on", confirmed: "on" }),
	),
	settingScene("a form with confirmed missing", settingForm({ enabled: "on" })),
	settingScene(
		"a form with confirmed false",
		settingForm({ enabled: "on", confirmed: "false" }),
	),
	settingScene(
		"a form with confirmed yes",
		settingForm({ enabled: "on", confirmed: "yes" }),
	),
	settingScene(
		"a form whose update fails shows the error page",
		settingForm({ enabled: "on", confirmed: "true" }),
		{
			failures: [
				{ on: /UPDATE software_signing_settings/, message: "d1 down" },
			],
		},
	),
	settingScene(
		"a form from another origin",
		settingForm(
			{ enabled: "on", confirmed: "true" },
			{
				headers: {
					origin: "https://evil.example",
					"content-type": "application/x-www-form-urlencoded",
				},
			},
		),
	),

	// the setting is read by the attachment route
	{
		name: "switching on lets an attachment in, switching off turns it away",
		setup: sql(PIN),
		music: {
			seed: {
				owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
			},
		},
		steps: [
			{
				as: asOwner(),
				handler: PUT,
				method: "PUT",
				path: "/api/owner/requests/r1/agreement-attachments?filename=a.pdf&version=1&date=2026-10-01",
				params: { id: "r1" },
				headers: { origin: ORIGIN, "content-type": "application/pdf" },
				body: PDF,
			},
			setting({ enabled: true, confirmed: true }),
			{
				as: asOwner(),
				handler: PUT,
				method: "PUT",
				path: "/api/owner/requests/r1/agreement-attachments?filename=a.pdf&version=1&date=2026-10-01",
				params: { id: "r1" },
				headers: { origin: ORIGIN, "content-type": "application/pdf" },
				body: PDF,
				dump: { music: ["software_agreement_attachments"] },
			},
			setting({ enabled: false, confirmed: true }),
			{
				as: asOwner(),
				handler: PUT,
				method: "PUT",
				path: "/api/owner/requests/r1/agreement-attachments?filename=a.pdf&version=1&date=2026-10-01",
				params: { id: "r1" },
				headers: { origin: ORIGIN, "content-type": "application/pdf" },
				body: PDF,
				dump: { music: ["software_agreement_attachments"] },
			},
		],
	},
];

defineCorpus("owner-agreements-access", POST, [
	...cleaningCases,
	...settingCases,
]);
