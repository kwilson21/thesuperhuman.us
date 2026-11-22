// The studio sign-in area's store: the studio sign-in routes' statements and the access closure's (AR2, AR3, AR5), one
// function per statement or batch, over the MusicDb service. CLAUDE.md asks for one store file per area; the audio
// projects conversion (#365) opened this file with the statements that close a client's sign-in when a project's access
// closes, and the sign-in conversion (docs/plans/2026-11-studio-signin-conversion.md, section 4) adds the routes'
// statements beside them. Other areas read or write the same tables from their own files (the agreement store, the
// software projects' access closure, the audio project store's session joins); those statements are not here.
//
// The sign-in routes (POST /api/studio/code, /api/studio/session and /api/studio/sign-out), in the order of the
// design's section 4. A read returns the rows as facts, and the rules in src/server/rules/signin-*.ts and
// studio-allowance.ts decide from them; a write binds the values a rule decided and the values the flow read (the time,
// the hashes), and decides nothing. Its only SQL that can refuse is the guards C1 to C9 of the design, which re-check
// at write time what the rule read.
//
// Every statement's SQL text and every batch's statements and order are, byte for byte and with the same values bound,
// the ones the golden corpora (tests/golden/studio-*.test.ts) recorded from the routes' code in
// src/lib/audio-client-access.ts, and tests/api/studio-signin-noninterference.test.ts schedules a request's batches by
// their leading SQL and their length. tests/server/studio-signin-store.test.ts holds every text and batch to the
// corpora. The issue's and the entry's write batches run for every request, bound to do nothing when the rule or the
// machine refused, so every request makes the same round trips with the same statements whatever the address.
//
// Failures. One failure for the area: a rejected read or statement is a StudioSigninStoreFailed carrying what the
// database raised in `failure`, which the route logs once (logUnexpected) before its fixed answer. A batch whose guard
// raised (the issue's C1 and C2, the discard's C8; `raisedByJsonGuard`) is GuardRefused: the facts changed since the
// read. It is never retried: the code flow answers it as a refusal, and the discard swallows it. No statement here has
// a unique constraint that a rule's facts depend on (the browser's row is deleted before its new row is inserted), so
// nothing is ChangedSinceRead.
//
// The access closure's statements (AR2, AR3 and AR5 of docs/plans/2026-11-audio-projects-conversion.md, section 4) are
// at the end. They write `audio_client_sessions`, `audio_client_signin_codes` and the retired sign-in codes table. The
// first two are statements of the access revocation's batch, so they are built over the batch's database and run with
// the project's own statements; the third is run alone, after the batch. The client's email is selected by request id
// inside each statement (a lookup by key, not a decision), so the statement acts on the client's email as it is at the
// write, and binding an email read earlier would end the sessions of an address the request no longer has. AR2 and AR3
// are linked to the revocation by its id: a request that lost the revoke to another one ends no session and deletes no
// code.
//
// No statement reads the clock or makes a random value: the times, the hashes and the allowance's key are parameters.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { GuardRefused, raisedByJsonGuard } from "./guarded-save";
import { ATTEMPTS_PER_CODE } from "./machines/signin-code";
import type { EntryWrite, StoredCode } from "./rules/signin-complete";
import type { DiscardWrite } from "./rules/signin-discard";
import type {
	AddressCode,
	IssueFacts,
	IssueWrite,
	SigninProject,
} from "./rules/signin-issue";
import type { SweepWrite } from "./rules/signin-sweep";
import type { AllowanceCount, AllowanceTimes } from "./rules/studio-allowance";
import { MusicDb } from "./services";

/**
 * A statement of the studio sign-in tables failed, and no guard says the facts changed. `failure` is the cause, for the
 * caller's log.
 */
export class StudioSigninStoreFailed extends Data.TaggedError(
	"StudioSigninStoreFailed",
)<{ readonly failure: unknown }> {}

/** Runs one database call; a rejection is a StudioSigninStoreFailed. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: (failure) => new StudioSigninStoreFailed({ failure }),
		});
	});

/** Runs one batch with a guard: a guard that raised is GuardRefused, any other rejection a StudioSigninStoreFailed. */
const guarded = (statements: (db: D1Database) => D1PreparedStatement[]) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () => db.batch(statements(db)),
			catch: (failure) =>
				failure instanceof Error && raisedByJsonGuard(failure)
					? new GuardRefused()
					: new StudioSigninStoreFailed({ failure }),
		});
	});

// ---- the statements the batches share ----

const studioProjects = `(SELECT request_id,revoked_at FROM audio_projects UNION ALL SELECT request_id,revoked_at FROM software_projects WHERE content_deleted_at IS NULL)`;

/** C1: the address's projects that are open (not revoked, their request not withdrawn). */
const activeProjects = `SELECT p.request_id FROM ${studioProjects} p
  JOIN owner_requests r ON r.id=p.request_id
  WHERE r.email=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL`;

/** The address's projects that are not closed, with whether each one's request is withdrawn. A read. */
const projectFacts = (db: D1Database, address: string) =>
	db
		.prepare(`SELECT p.request_id AS requestId,r.status='withdrawn' AS withdrawn
    FROM ${studioProjects} p JOIN owner_requests r ON r.id=p.request_id
    WHERE r.email=? AND p.revoked_at IS NULL ORDER BY p.request_id`)
		.bind(address);

type ProjectRow = { requestId: string; withdrawn: number };

const projectsOf = (rows: readonly ProjectRow[]): SigninProject[] =>
	rows.map((row) => ({
		requestId: row.requestId,
		withdrawn: Boolean(row.withdrawn),
	}));

/**
 * C7: an audit row for each project id given (a JSON array a rule decided), written only for a project that is still
 * open when the batch runs.
 */
const auditInsert = (
	db: D1Database,
	action: "code-issued" | "code-delivery-failed",
	at: string,
	ids: readonly string[],
) =>
	db
		.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
    SELECT j.value,'${action}',? FROM json_each(?) j
    WHERE EXISTS (SELECT 1 FROM ${studioProjects} p WHERE p.request_id=j.value AND p.revoked_at IS NULL)`)
		.bind(at, JSON.stringify(ids));

// ---- the code request (POST /api/studio/code) ----

/** The issue's read, one batch: the address's projects that are not closed, and the address's code rows. */
export const readIssueFacts = (address: string) =>
	asked(async (db): Promise<IssueFacts> => {
		const [projectRows, codeRows] = await db.batch<ProjectRow & AddressCode>([
			projectFacts(db, address),
			db
				.prepare(`SELECT nonce_hash AS nonceHash,email,code_hash AS codeHash,used_at AS usedAt,expires_at AS expiresAt
      FROM audio_client_signin_codes WHERE email=?`)
				.bind(address),
		]);

		return {
			projects: projectsOf(projectRows.results),
			codes: codeRows.results.map((row) => ({
				nonceHash: row.nonceHash,
				email: row.email,
				codeHash: row.codeHash,
				usedAt: row.usedAt,
				expiresAt: row.expiresAt,
			})),
		};
	});

/** The sweep's batch: the address, the time the request read, and the rows the sweep rule named. */
export type SweepBatch = {
	readonly address: string;
	readonly at: string;
	readonly sweep: SweepWrite;
};

/**
 * The sweep, one batch for every request: the address's rows the sweep rule named, deleted by key. C3 re-checks at write
 * time that each is still expired and still holds the code that was read, so a fresh code stored under the same key since
 * the read is never deleted.
 */
export const sweepExpired = (batch: SweepBatch) =>
	asked((db) =>
		db.batch([
			db
				.prepare(`DELETE FROM audio_client_signin_codes WHERE email=? AND expires_at<=?
        AND (nonce_hash,code_hash) IN (SELECT json_extract(j.value,'$[0]'),json_extract(j.value,'$[1]') FROM json_each(?) j)`)
				.bind(
					batch.address,
					batch.at,
					JSON.stringify(
						batch.sweep.expired.map((row) => [row.nonceHash, row.codeHash]),
					),
				),
		]),
	).pipe(Effect.asVoid);

/** The issue's write batch: the request's values, bound in every statement, and what the issue rule decided. */
export type IssueBatch = {
	readonly address: string;
	/** The hash of the browser's cookie value. */
	readonly nonceHash: string;
	/** The new code's keyed hash. */
	readonly codeHash: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
	/** The issue rule's write, or null when it refused: every statement is then bound to do nothing. */
	readonly issue: IssueWrite | null;
};

/**
 * The issue's write, one batch for every request: the guard (C1, C2), the browser's row for the address deleted, the new
 * row inserted, and the audit `code-issued` (C7). Each statement is bound to do nothing when the rule refused. A raised
 * guard writes nothing and is GuardRefused.
 */
export const writeIssue = (batch: IssueBatch) => {
	const issue = batch.issue;

	return guarded((db) => [
		db
			.prepare(`SELECT CASE WHEN ?=0 OR (EXISTS (${activeProjects})
        AND (SELECT COUNT(*) FROM audio_client_signin_codes WHERE email=? AND nonce_hash<>?
          AND used_at IS NULL AND expires_at>?)<?)
        THEN 1 ELSE json_extract('changed','$') END`)
			.bind(
				issue ? 1 : 0,
				batch.address,
				batch.address,
				batch.nonceHash,
				batch.issuedAt,
				issue ? issue.liveOthersBelow : 0,
			),
		// The table has one row per (cookie value, address), so the insert below never collides on it, however requests
		// sharing a cookie interleave, and no row of another address is touched.
		db
			.prepare(
				"DELETE FROM audio_client_signin_codes WHERE nonce_hash=? AND email=?",
			)
			.bind(issue ? batch.nonceHash : "", issue ? batch.address : ""),
		db
			.prepare(`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at,used_at,session_token_hash)
        SELECT ?,?,?,0,?,?,NULL,NULL WHERE ?=1`)
			.bind(
				batch.nonceHash,
				batch.address,
				batch.codeHash,
				batch.issuedAt,
				batch.expiresAt,
				issue ? 1 : 0,
			),
		auditInsert(
			db,
			"code-issued",
			batch.issuedAt,
			issue?.auditRequestIds ?? [],
		),
	]);
};

/** The key of the code the discard reads and removes: the address, the cookie value's hash and the code's keyed hash. */
export type DiscardKey = {
	readonly address: string;
	readonly nonceHash: string;
	readonly codeHash: string;
};

const sameCode = `email=? AND nonce_hash=? AND code_hash=?`;

/** The discard's read, one batch: the code's `used_at` (no row when it is gone), and the address's projects. */
export const readDiscardFacts = (key: DiscardKey) =>
	asked(async (db) => {
		const [stored, projectRows] = await db.batch<
			ProjectRow & { usedAt: string | null }
		>([
			db
				.prepare(
					`SELECT used_at AS usedAt FROM audio_client_signin_codes WHERE ${sameCode}`,
				)
				.bind(key.address, key.nonceHash, key.codeHash),
			projectFacts(db, key.address),
		]);

		const row = stored.results[0];

		return {
			code: row ? { usedAt: row.usedAt } : null,
			projects: projectsOf(projectRows.results),
		};
	});

/** The discard's write batch: the code's key, the time read after the email, and what the discard rule decided. */
export type DiscardBatch = DiscardKey & {
	readonly at: string;
	readonly discard: DiscardWrite;
};

/**
 * The discard's write, one batch: the guard (C8, the code is still the unused one that was read), the audit
 * `code-delivery-failed` (C7), and the row deleted while unused. A raised guard writes nothing and is GuardRefused.
 */
export const writeDiscard = (batch: DiscardBatch) =>
	guarded((db) => [
		db
			.prepare(
				`SELECT CASE WHEN EXISTS (SELECT 1 FROM audio_client_signin_codes WHERE ${sameCode} AND used_at IS NULL) THEN 1 ELSE json_extract('changed','$') END`,
			)
			.bind(batch.address, batch.nonceHash, batch.codeHash),
		auditInsert(
			db,
			"code-delivery-failed",
			batch.at,
			batch.discard.auditRequestIds,
		),
		db
			.prepare(
				`DELETE FROM audio_client_signin_codes WHERE ${sameCode} AND used_at IS NULL`,
			)
			.bind(batch.address, batch.nonceHash, batch.codeHash),
	]);

// ---- the code entry (POST /api/studio/session) ----

/** The browser's row for the address: the address and the cookie value's hash. */
export type EntryKey = {
	readonly address: string;
	readonly nonceHash: string;
};

/** The entry's read, one batch: the browser's code row for the address (null when there is none), and the address's projects. */
export const readEntryFacts = (key: EntryKey) =>
	asked(async (db) => {
		const [codeRows, projectRows] = await db.batch<
			ProjectRow & {
				attempts: number;
				usedAt: string | null;
				expiresAt: string;
				codeHash: string;
			}
		>([
			db
				.prepare(`SELECT attempts,used_at AS usedAt,expires_at AS expiresAt,code_hash AS codeHash
      FROM audio_client_signin_codes WHERE email=? AND nonce_hash=?`)
				.bind(key.address, key.nonceHash),
			projectFacts(db, key.address),
		]);

		const row = codeRows.results[0];

		const code: StoredCode | null = row
			? {
					attempts: Number(row.attempts),
					usedAt: row.usedAt,
					expiresAt: row.expiresAt,
					codeHash: row.codeHash,
				}
			: null;

		return { code, projects: projectsOf(projectRows.results) };
	});

/** The entry's write batch: the request's values, bound in every statement, and what the entry rule decided. */
export type EntryBatch = EntryKey & {
	/** The stored hash of the code that was read, or "" when there was no row. */
	readonly readHash: string;
	/** The time the request read, as ISO text. */
	readonly at: string;
	/** The hash of the session token made for this entry, accepted or not. */
	readonly tokenHash: string;
	/** When the session ends, if one is made. */
	readonly sessionExpiresAt: string;
	/** The entry rule's write, or null when the machine refused ENTER: every statement then matches no row. */
	readonly entry: EntryWrite | null;
};

/**
 * The entry's write, one batch of four guarded statements for every entry: the attempt counted (C4), the code accepted
 * (C5, with C1's open project), the session made for the accepted code's token (C6), and the audit `signed-in` (C7).
 * Answers whether the accept's `RETURNING` row came back: only then was a session made.
 */
export const writeEntry = (batch: EntryBatch) => {
	const counted = batch.entry !== null;
	const accepted = batch.entry?.accept === true;

	return asked(async (db) => {
		const [, used] = await db.batch([
			db
				.prepare(`UPDATE audio_client_signin_codes SET attempts=attempts+1
      WHERE ?=1 AND email=? AND nonce_hash=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND attempts<?`)
				.bind(
					counted ? 1 : 0,
					batch.address,
					batch.nonceHash,
					batch.readHash,
					batch.at,
					ATTEMPTS_PER_CODE,
				),
			db
				.prepare(`UPDATE audio_client_signin_codes SET used_at=?,session_token_hash=?
      WHERE ?=1 AND email=? AND nonce_hash=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND changes()=1 AND EXISTS (${activeProjects})
      RETURNING nonce_hash`)
				.bind(
					batch.at,
					batch.tokenHash,
					accepted ? 1 : 0,
					batch.address,
					batch.nonceHash,
					batch.readHash,
					batch.at,
					batch.address,
				),
			db
				.prepare(`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      SELECT ?,email,?,?,? FROM audio_client_signin_codes WHERE nonce_hash=? AND email=? AND session_token_hash=?`)
				.bind(
					batch.tokenHash,
					batch.at,
					batch.sessionExpiresAt,
					batch.at,
					batch.nonceHash,
					batch.address,
					batch.tokenHash,
				),
			db
				.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      SELECT j.value,'signed-in',? FROM json_each(?) j
      WHERE EXISTS(SELECT 1 FROM audio_client_sessions WHERE token_hash=?)
        AND EXISTS (SELECT 1 FROM ${studioProjects} p WHERE p.request_id=j.value AND p.revoked_at IS NULL)`)
				.bind(
					batch.at,
					JSON.stringify(batch.entry?.auditRequestIds ?? []),
					batch.tokenHash,
				),
		]);

		return { accepted: used.results.length > 0 };
	});
};

// ---- the allowance (the code, session and agreement link routes) ----

/**
 * One use of an allowance, one batch: the windows that started at or before `staleAt` pruned, then the use counted under
 * `key` (a keyed hash of the scope and subject), a new window starting at `at`. Answers the uses the upsert returned.
 */
export const countAllowance = (key: string, times: AllowanceTimes) =>
	asked(async (db): Promise<AllowanceCount> => {
		const [, counted] = await db.batch<{ uses: number | null }>([
			db
				.prepare("DELETE FROM audio_client_allowances WHERE window_start<=?")
				.bind(times.staleAt),
			db
				.prepare(`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET uses=uses+1 RETURNING uses,window_start`)
				.bind(key, times.at),
		]);

		const row = counted.results[0];

		// No row, or a row without a count, is no count: the rule refuses it, as today's `Infinity` did. The schema makes
		// `uses` NOT NULL, so this is only a guard.
		return { uses: row?.uses == null ? null : Number(row.uses) };
	});

// ---- sign-out (POST /api/studio/sign-out) ----

/** Sign-out, one statement: the session with this token hash revoked at `at`, only while it is not revoked (C9). */
export const revokeSession = (tokenHash: string, at: string) =>
	asked((db) =>
		db
			.prepare(
				"UPDATE audio_client_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
			)
			.bind(at, tokenHash)
			.run(),
	).pipe(Effect.asVoid);

// ---- access closure (the audio project's access revocation, #365) ----

/** AR2, compare-and-set: every open session of the client the request names is ended, while the revocation is this request's. */
export const endClientSessions = (
	db: D1Database,
	requestId: string,
	revocationId: string,
	at: string,
) =>
	db
		.prepare(`UPDATE audio_client_sessions SET revoked_at=? WHERE revoked_at IS NULL AND email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
		.bind(at, requestId, revocationId);

/** AR3, compare-and-set: the sign-in codes of the client the request names are deleted, while the revocation is this request's. */
export const deleteClientSigninCodes = (
	db: D1Database,
	requestId: string,
	revocationId: string,
) =>
	db
		.prepare(`DELETE FROM audio_client_signin_codes WHERE email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
		.bind(requestId, revocationId);

/**
 * AR5, write guarded by key, best effort after the revocation: the codes of the retired sign-in table. A table that is already
 * dropped (migration 0028, issue 271) is silent and not a failure; any other failure is a `StudioSigninStoreFailed` the
 * caller logs and goes on from.
 */
export const deleteRetiredClientCodes = (requestId: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(
						"DELETE FROM audio_client_codes WHERE email=(SELECT email FROM owner_requests WHERE id=?)",
					)
					.bind(requestId)
					.run(),
			catch: (cause) => new StudioSigninStoreFailed({ failure: cause }),
		}).pipe(
			Effect.catchTag("StudioSigninStoreFailed", (failure) =>
				failure.failure instanceof Error &&
				/no such table/i.test(failure.failure.message)
					? Effect.void
					: Effect.fail(failure),
			),
		);
	});
