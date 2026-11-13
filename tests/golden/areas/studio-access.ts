// Shared seed builders for the studio-access golden corpora: client sign-in (studio/code, studio/session, studio/sign-out)
// and client file access (the audio file route and the software visual route). Nothing here is a harness change; it only
// builds rows and hashes the way src/lib/audio-client-access.ts does, so a case can start from an exact state.
import { hashValue, keyedHash } from "~/lib/audio-client-access";
import {
	DEFAULT_ENV,
	rows,
	type Seed,
	type SeedRow,
	type World,
} from "../harness";

export const ORIGIN = "https://thesuperhuman.us";

/** The same-origin header every JSON sign-in request carries (musicRequest checks it before anything else). */
export const SAME_ORIGIN = { origin: ORIGIN };

/** The code key the default env uses. */
export const KEY = DEFAULT_ENV.AUDIO_CLIENT_CODE_KEY ?? "";

export const GRACE = "grace@example.test";
export const OTHER = "ada@example.test";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const LATER = "2026-11-27T11:00:00.000Z";

/** A studio_session cookie value (two UUID-shaped halves, 72 characters) and its SHA-256, which the database holds. */
export type Token = { readonly value: string; readonly hash: string };

export async function makeToken(n: number): Promise<Token> {
	const half = (m: number) =>
		`00000000-0000-4000-8000-${m.toString(16).padStart(12, "0")}`;

	const value = `${half(n)}${half(n + 5000)}`;

	return { value, hash: await hashValue(value) };
}

export const T1 = await makeToken(1);
export const T2 = await makeToken(2);
export const T3 = await makeToken(3);

/** A session row. */
export const sessionRow = (
	token: Token,
	email: string,
	over: SeedRow = {},
): SeedRow => ({
	token_hash: token.hash,
	email,
	created_at: EARLIER,
	expires_at: LATER,
	last_seen_at: EARLIER,
	...over,
});

/** A sign-in code row for a code the case knows, so it can be right, wrong, used or expired. */
export async function codeRow(
	email: string,
	code: string,
	over: SeedRow = {},
): Promise<SeedRow> {
	return {
		email,
		code_hash: await keyedHash(KEY, `${email}:${code}`),
		attempts: 0,
		created_at: "2026-11-13T11:55:00.000Z",
		expires_at: "2026-11-13T12:05:00.000Z",
		used_at: null,
		session_token_hash: null,
		...over,
	};
}

/** An allowance row: `uses` of a scope and subject in the window that began at `windowStart`. */
export async function allowanceRow(
	scope: string,
	subject: string,
	uses: number,
	windowStart = NOW,
): Promise<SeedRow> {
	return {
		key: await keyedHash(KEY, `${scope}:${subject}`),
		window_start: windowStart,
		uses,
	};
}

/** Joins seeds table by table, keeping the first-seen order of the tables (a foreign key needs its parent first). */
export function mergeSeeds(...seeds: Seed[]): Seed {
	const out: { [table: string]: SeedRow[] } = {};

	for (const one of seeds)
		for (const [table, list] of Object.entries(one))
			out[table] = [...(out[table] ?? []), ...list];

	return out;
}

/**
 * A service (audio) request. The database trigger adds its project at insert, so the project is changed afterwards
 * with `stageSql` or `sql`, never seeded.
 */
export const audioClient = (
	id: string,
	email: string,
	over: SeedRow = {},
): Seed => ({
	owner_requests: [rows.ownerRequest(id, { email, ...over })],
});

/** A software request, its offer and its started project. */
export const softwareClient = (
	id: string,
	email: string,
	over: { request?: SeedRow; project?: SeedRow } = {},
): Seed => ({
	owner_requests: [
		rows.softwareRequest(id, { email, status: "reviewed", ...over.request }),
	],
	software_offers: [rows.softwareOffer(`o-${id}`, id)],
	software_projects: [rows.softwareProject(id, `o-${id}`, over.project)],
});

export const audioPayment = (id: string, over: SeedRow = {}): SeedRow => ({
	request_id: id,
	approved_service: "mixing",
	total_amount_cents: 20_000,
	booking_amount_cents: 10_000,
	balance_amount_cents: 10_000,
	offer_accepted_at: EARLIER,
	booking_status: "paid",
	balance_status: "not_created",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

export const FILE_BODY = "0123456789abcdef".repeat(4);
export const FILE_SIZE = FILE_BODY.length;

export const audioFile = (
	id: string,
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	version: "review",
	object_key: `studio/projects/${requestId}/${id}.mp3`,
	display_name: "Mix v1",
	media_type: "audio/mpeg",
	byte_size: FILE_SIZE,
	downloadable: 0,
	status: "published",
	uploaded_at: EARLIER,
	published_at: EARLIER,
	expires_at: null,
	revoked_at: null,
	...over,
});

/** Runs raw SQL on MUSIC_DB before the first step (off the record), to set up a state the seed cannot. */
export const sql =
	(...statements: string[]) =>
	(world: World) => {
		for (const statement of statements) world.music.exec(statement);
	};

/** The project of request `id` is in `stage`. */
export const stageSql = (stage: string, id = "r1") =>
	`UPDATE audio_projects SET stage='${stage}' WHERE request_id='${id}'`;

/** The software update row a visual is read from. */
export const softwareUpdate = (
	id: string,
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	kind: "progress",
	status: "shared",
	milestone_index: 0,
	title: "First look",
	evidence_type: "prototype",
	visual_key: `software/${requestId}/${id}/v1.png`,
	visual_media_type: "image/png",
	visual_alt: "A first look",
	shared_at: EARLIER,
	shared_by: "owner@example.test",
	created_by: "owner@example.test",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});
