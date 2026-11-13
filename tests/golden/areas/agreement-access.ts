// Shared seed builders and step builders for the agreement-access golden corpora: requesting a secure link
// (POST /api/agreements/link and POST /api/offer/[token]/link), saving draft details (POST /api/offer/[token]/draft) and
// reviewing the generated agreement (GET and POST /api/offer/[token]/review). Nothing here changes the harness. It only
// builds the rows a case starts from (an offer with a live link, a verified session, agreements in each state) and the
// two wire formats a client sends (JSON, and a native urlencoded form post).
import { completeAgreementLink } from "~/lib/agreement-access";
import { templateFields } from "~/lib/agreement-templates";
import { hashOfferToken } from "~/lib/software-offers";
import { isText } from "~/lib/type-guards";
import type { JsonValue } from "../../helpers/json";
import { mergeSeeds } from "./studio-access";
import {
	DEFAULT_ENV,
	byHost,
	json,
	rows,
	type Case,
	type Effect,
	type FetchAnswer,
	type Handler,
	type Prior,
	type Seed,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const ORIGIN = "https://thesuperhuman.us";
export const SAME_ORIGIN = { origin: ORIGIN };
export const FORM_TYPE = "application/x-www-form-urlencoded";
export const GRACE = "grace@example.test";
export const IP = "203.0.113.9";
export const KEY = DEFAULT_ENV.AUDIO_CLIENT_CODE_KEY ?? "";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const LATER = "2026-11-13T14:00:00.000Z";

/** The offer link token (43 URL-safe characters, which is what getLinkedOffer accepts). */
export const TOKEN = "Tk3mP9xQ7vR2sL8nB4cD6fG1hJ5wY0zA-_aEiOuT2kX";
export const OTHER_TOKEN = "Zy9wV7uT5sR3qP1oN8mL6kJ4hG2fD0cB-_aEiOuT2kX";

/** The agreement_session cookie value of the seeded session and its csrf nonce. */
export const SESSION = "Se5sS1oNt0kEnV4lUe9aBcDeFgHiJkLmNoPqRsTuVwX";
export const OTHER_SESSION = "Os5sS1oNt0kEnV4lUe9aBcDeFgHiJkLmNoPqRsTuVwY";
export const CSRF = "csrf-nonce-seeded-0001";

export const TOKEN_HASH = await hashOfferToken(TOKEN);
export const OTHER_TOKEN_HASH = await hashOfferToken(OTHER_TOKEN);
export const SESSION_HASH = await hashOfferToken(SESSION);
export const OTHER_SESSION_HASH = await hashOfferToken(OTHER_SESSION);

export const terms = {
	outcome: "A scheduling tool",
	summary: "A small tool that books appointments.",
	milestones: [
		{
			name: "Booking page",
			deliverables: ["A booking page"],
			acceptance: ["Visitors can book a slot"],
			feeCents: 250_000,
		},
	],
	paymentMode: "standard",
	clientInputs: "",
	exclusions: "",
	timing: "",
};

export const details = {
	planned_start: "2026-12-01",
	planned_end: "2026-12-20",
	environment: "Browser",
	operating_responsibilities: "Client operates",
	update_rhythm: "Weekly",
	milestones: [
		{
			start: "2026-12-01",
			target: "2026-12-20",
			handoff: "Source and notices",
		},
	],
};

export const contractor = {
	legal_name: "Example Contractor LLC",
	entity_jurisdiction: "Wyoming LLC",
	signer_name: "Example Owner",
	signer_title: "Representative",
	notice_email: "owner@example.test",
	business_address: "200 Example Business Street",
	registered_agent_confirmed: true,
};

/** Every field of a template, so a rendered agreement shows all the values it was given. */
const synthetic = (kind: "msa" | "sow") =>
	templateFields[kind]
		.filter((field) => !field.startsWith("milestone."))
		.map((field) => `${field}: {{${field}}}`)
		.join("\n") +
	(kind === "sow"
		? `\n{{#milestones}}\n${templateFields.sow
				.filter((field) => field.startsWith("milestone."))
				.map((field) => `${field}: {{${field}}}`)
				.join("\n")}\n{{/milestones}}`
		: "");

const SHA = "0".repeat(64);

export const templates = (): SeedRow[] => [
	{
		id: "tpl-msa",
		kind: "msa",
		version: 1,
		text: synthetic("msa"),
		sha256: SHA,
		published_at: EARLIER,
		published_by: "owner@example.test",
	},
	{
		id: "tpl-sow",
		kind: "sow",
		version: 1,
		text: synthetic("sow"),
		sha256: SHA,
		published_at: EARLIER,
		published_by: "owner@example.test",
	},
];

/** A complete set of client details, as the signing page sends them (the draft form's fields). */
export const values = (over: { [field: string]: string } = {}) => ({
	legal_name: "Hopper Systems LLC",
	entity_type: "LLC",
	state: "Virginia",
	country: "",
	business_address: "1 Main Street, Roanoke, VA 24011",
	signer_name: "Grace Hopper",
	signer_title: "Owner",
	portfolio_choice: "named",
	reviewer_name: "",
	reviewer_email: "",
	approver_name: "",
	approver_email: "",
	notice_email: "",
	...over,
});

export type Opts = {
	readonly request?: SeedRow;
	readonly offer?: SeedRow;
	/** Replaces the offer link row (set `revoked_at`), or `null` for no link row at all. */
	readonly offerLink?: SeedRow | null;
	/** The seeded verified session: columns to change, `null` for none. */
	readonly session?: SeedRow | null;
	readonly sessionLink?: SeedRow;
	/** Agreements of the offer, in this state, with the client they belong to. */
	readonly agreements?: "review" | "client_signed" | "executed" | "abandoned";
	/** Rows to add after the base ones. */
	readonly extra?: Seed;
	/** SQL run after seeding, off the record. */
	readonly sql?: readonly string[];
	/** Signing is on by default. */
	readonly signing?: boolean;
};

const agreementRow = (
	id: string,
	kind: "msa" | "sow",
	status: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	kind,
	offer_id: "o-r1",
	request_id: "r1",
	client_id: "client-1",
	template_id: kind === "msa" ? "tpl-msa" : "tpl-sow",
	msa_id: kind === "sow" ? "ag-msa" : null,
	sow_number: kind === "sow" ? "SOW-ag-sow" : null,
	status,
	canonical_text: `${kind.toUpperCase()} text of record\n`,
	text_sha256: SHA,
	values_json: "{}",
	created_at: EARLIER,
	effective_on: "2026-11-13",
	review_session_hash: SESSION_HASH,
	executed_at: status === "executed" ? EARLIER : null,
	client_signed_at:
		status === "client_signed" || status === "executed" ? EARLIER : null,
	...over,
});

export const clientRow = (over: SeedRow = {}): SeedRow => ({
	id: "client-1",
	recipient_email: GRACE,
	legal_name: "Hopper Systems LLC",
	legal_name_key: "hopper systems llc",
	entity_type: "LLC",
	jurisdiction: "Virginia",
	business_address: "1 Main Street, Roanoke, VA 24011",
	notice_email: GRACE,
	created_at: EARLIER,
	...over,
});

/** The rows every agreement-access case starts from, changed by `opts`. */
export function seedFor(opts: Opts = {}): Seed {
	const offer: Seed = {
		owner_requests: [
			rows.softwareRequest("r1", {
				email: GRACE,
				status: "reviewed",
				...opts.request,
			}),
		],
		software_agreement_templates: templates(),
		software_offers: [
			rows.softwareOffer("o-r1", "r1", {
				terms_json: JSON.stringify(terms),
				agreement_details_json: JSON.stringify(details),
				msa_template_id: "tpl-msa",
				sow_template_id: "tpl-sow",
				contractor_snapshot_json: JSON.stringify(contractor),
				recipient_email_snapshot: GRACE,
				...opts.offer,
			}),
		],
	};

	const link: Seed =
		opts.offerLink === null
			? {}
			: {
					software_offer_links: [
						rows.offerLink("r1", { token_hash: TOKEN_HASH, ...opts.offerLink }),
					],
				};

	const agreements: Seed = opts.agreements
		? {
				software_agreement_clients: [clientRow()],
				software_agreements: [
					agreementRow("ag-msa", "msa", opts.agreements),
					agreementRow("ag-sow", "sow", opts.agreements),
				],
			}
		: {};

	const session: Seed =
		opts.session === null
			? {}
			: {
					software_agreement_links: [
						{
							id: "link-seed",
							purpose: "agreement",
							offer_id: "o-r1",
							link_hash: TOKEN_HASH,
							recipient_email: GRACE,
							token_hash: "token-hash-of-the-seeded-link",
							issued_at: "2026-11-13T11:30:00.000Z",
							expires_at: "2026-11-13T12:30:00.000Z",
							used_at: "2026-11-13T11:31:00.000Z",
							...opts.sessionLink,
						},
					],
					software_agreement_sessions: [
						{
							token_hash: SESSION_HASH,
							purpose: "agreement",
							offer_id: "o-r1",
							link_hash: TOKEN_HASH,
							recipient_email: GRACE,
							link_id: "link-seed",
							verified_at: "2026-11-13T11:31:00.000Z",
							expires_at: LATER,
							revoked_at: null,
							csrf_nonce: CSRF,
							...opts.session,
						},
					],
				};

	return mergeSeeds(offer, link, agreements, session, opts.extra ?? {});
}

/** The music seed and the setup (signing switched on, then raw SQL) of a case. */
export function agreementWorld(opts: Opts = {}): Pick<Case, "music" | "setup"> {
	return {
		music: { seed: seedFor(opts) },
		setup: (world: World) => {
			if (opts.signing !== false)
				world.music.exec(
					"UPDATE software_signing_settings SET software_signing_enabled=1",
				);

			for (const statement of opts.sql ?? []) world.music.exec(statement);
		},
	};
}

export const cookie = (value = SESSION) => ({
	cookie: `agreement_session=${value}`,
});

/** A urlencoded form body: what a native `<form method="post">` sends. */
export const formBody = (fields: { [name: string]: string }) =>
	new URLSearchParams(fields).toString();

export const formHeaders = (extra: { [name: string]: string } = {}) => ({
	...SAME_ORIGIN,
	"content-type": FORM_TYPE,
	...extra,
});

export const mail = byHost({
	turnstile: json(200, { success: true }),
	resend: json(200, { id: "em_1" }),
});

export const withResend = (answer: FetchAnswer | readonly FetchAnswer[]) =>
	byHost({ turnstile: json(200, { success: true }), resend: answer });

export const withTurnstile = (answer: FetchAnswer | readonly FetchAnswer[]) =>
	byHost({ turnstile: answer, resend: json(200, { id: "em_1" }) });

const isResendMail = (
	effect: Effect,
): effect is Extract<Effect, { kind: "fetch" }> =>
	effect.kind === "fetch" && effect.host === "resend";

/** The `key` in the n-th emailed link, read from what Resend was asked to send. */
export function issuedKey(prior: Prior, n = 0): string {
	const body = prior.effects.filter(isResendMail)[n]?.body;

	if (!isText(body))
		throw new Error("agreement-access: no email was sent to read a key from.");

	const text: unknown = JSON.parse(body).text;
	const found = /key=([A-Za-z0-9_-]{43})/.exec(String(text));

	if (!found) throw new Error("agreement-access: the email has no key.");

	return found[1];
}

/** What src/pages/offer/[token]/verify.astro does: complete the emailed link. */
export const verify: Handler = (context) =>
	completeAgreementLink(
		context.locals.runtime.env,
		context.request,
		new URL(context.request.url).searchParams.get("key") ?? "",
		context.params.token,
	);

/** A step that follows the emailed link of the n-th email, as GET (preview) or POST (consume). */
export const follow = (
	method: "GET" | "POST",
	options: { mail?: number; archive?: boolean; key?: string } = {},
	extra: Partial<Step> = {},
): Step => ({
	handler: verify,
	method,
	path: (prior) =>
		`${options.archive ? "/agreements" : `/offer/${TOKEN}`}/verify?key=${options.key ?? issuedKey(prior, options.mail ?? 0)}`,
	params: options.archive ? {} : { token: TOKEN },
	headers: SAME_ORIGIN,
	dump: { music: ["software_agreement_links", "software_agreement_sessions"] },
	...extra,
});

/** The agreement_session cookie the n-th step set. */
export function sessionCookieOf(prior: Prior, step: number): string {
	const answer = prior.steps[step]?.answer;

	if (answer?.outcome !== "response")
		throw new Error("agreement-access: that step has no answer.");

	const found = answer.setCookies
		.map((line) => /agreement_session=([^;]+)/.exec(line)?.[1])
		.find(Boolean);

	if (!found) throw new Error("agreement-access: that step set no session.");

	return found;
}

/** The csrf nonce of the newest session row, read just before a step by `readCsrf`. */
let csrfOfSession = "";

export const readCsrf: NonNullable<Step["before"]> = {
	label: "read the csrf nonce of the newest session",
	run: (world) => {
		const row = world.music
			.prepare(
				"SELECT csrf_nonce FROM software_agreement_sessions ORDER BY rowid DESC LIMIT 1",
			)
			.get();

		csrfOfSession = String(row?.csrf_nonce ?? "");
	},
};

export const csrfRead = () => csrfOfSession;

export const LINK_TABLES = [
	"software_agreement_links",
	"software_agreement_sessions",
	"software_agreement_events",
	"audio_client_allowances",
];

export const DRAFT_TABLES = [
	"software_agreement_drafts",
	"software_agreement_sessions",
	"software_agreement_events",
];

export const REVIEW_TABLES = [
	"software_agreements",
	"software_agreement_clients",
	"software_agreement_drafts",
	"software_agreement_events",
];

export type Fields = { [name: string]: JsonValue };

export type Wire = "json" | "form";

/** Builds one step of the case in its wire format: the fields as a JSON body, or as a native form post. */
export type Make = (fields?: Fields, extra?: Partial<Step>) => Step;

const textOf = (value: JsonValue) =>
	isText(value) ? value : JSON.stringify(value);

/**
 * A step builder for one wire format. In the form format a field is sent as text, an object or list as its JSON text
 * (what the signing page puts in a hidden input), and `turnstileToken` under the name the Turnstile widget gives it.
 */
export function maker(
	wire: Wire,
	base: Partial<Step> & { path: Step["path"] },
): Make {
	return (fields, extra = {}) => {
		if (wire === "json")
			return {
				...base,
				json: fields,
				...extra,
				headers: { ...SAME_ORIGIN, ...extra.headers },
			};

		return {
			...base,
			body: formBody(
				Object.fromEntries(
					Object.entries(fields ?? {}).map(([name, value]) => [
						name === "turnstileToken" ? "cf-turnstile-response" : name,
						textOf(value),
					]),
				),
			),
			...extra,
			headers: formHeaders(extra.headers),
		};
	};
}

/** A case recorded once for each wire format. The name says which. */
export function bothWires(
	name: string,
	base: Partial<Step> & { path: Step["path"] },
	build: (make: Make, wire: Wire) => Omit<Case, "name">,
): Case[] {
	return (["json", "form"] as const).map((wire) => ({
		name: `${name} (${wire})`,
		...build(maker(wire, base), wire),
	}));
}
