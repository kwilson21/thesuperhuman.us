import { z } from "zod";
import { decideComplete, decideIssue } from "./signin-code-rules";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const codeLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 14 * 24 * 60 * 60 * 1000;

export function normalizeClientEmail(input: unknown): string | null {
	const parsed = emailSchema.safeParse(input);

	return parsed.success ? parsed.data : null;
}

export function clientPortalEnabled(env: Env | undefined): boolean {
	return env?.AUDIO_CLIENT_PORTAL_ENABLED === "true";
}

export async function hashValue(value: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

export async function keyedHash(
	secret: string,
	message: string,
): Promise<string> {
	if (secret.length < 32) throw new Error("Studio code key is not configured.");

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const bytes = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
	);

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

// A code belongs to the browser that asked for it. The browser holds a random value (the pending sign-in cookie); the
// stored row is keyed by its hash and the code's hash covers it, so a code only works with the cookie it was issued to.
const codeHash = (
	email: string,
	nonceHash: string,
	code: string,
	secret: string,
) => keyedHash(secret, `${email}:${nonceHash}:${code}`);

const pendingFormat = /^[0-9a-f]{64}$/;

// Two allowance windows of codes (3 emails per five minutes, ten-minute lifetime); see verification/signin-codes.qnt.
const liveCodesPerAddress = 6;

function newCode(): string {
	const values = new Uint32Array(1);
	crypto.getRandomValues(values);

	return String(values[0] % 100_000_000).padStart(8, "0");
}

/** A fresh random pending sign-in value: 256 bits, hex. */
export function newPendingNonce(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

const studioProjects = `(SELECT request_id,revoked_at FROM audio_projects UNION ALL SELECT request_id,revoked_at FROM software_projects WHERE content_deleted_at IS NULL)`;

const activeProjects = `SELECT p.request_id FROM ${studioProjects} p
  JOIN owner_requests r ON r.id=p.request_id
  WHERE r.email=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL`;

/** The address's projects that are not closed, with whether each one's request is withdrawn. A read. */
const projectFacts = (db: D1Database, email: string) =>
	db
		.prepare(`SELECT p.request_id AS requestId,r.status='withdrawn' AS withdrawn
    FROM ${studioProjects} p JOIN owner_requests r ON r.id=p.request_id
    WHERE r.email=? AND p.revoked_at IS NULL ORDER BY p.request_id`)
		.bind(email);

type ProjectRow = { requestId: string; withdrawn: number };

const projectsOf = (rows: ProjectRow[]) =>
	rows.map((row) => ({
		requestId: row.requestId,
		withdrawn: Boolean(row.withdrawn),
	}));

const issueAttempts = 3;

/** A write guard raised: SQLite raises it as a malformed-JSON error (the same test as raisedByJsonGuard in src/server/guarded-save.ts, which src/lib may not import). */
const guardRaised = (error: Error) => /malformed JSON/.test(error.message);

/**
 * Issues a code for the browser holding `pending` (its pending sign-in cookie value), or for a newly minted value when it
 * holds none; the value used is returned with the code. A browser's earlier code, for whatever address, is replaced in
 * place, and other browsers' codes are never touched. Returns null when no code was issued: the address has no open
 * project, it already has the most live codes, or the facts kept changing under the write.
 *
 * What is read, decided and written (nothing here decides in SQL):
 *   read:  the address's projects, and how many other live codes it has (always, whatever the address)
 *   decide: `decideIssue` (src/lib/signin-code-rules.ts)
 *   write: one batch. Its guard re-checks the two facts the rule relied on, at write time: (1) the address still has a
 *     project that is open, (2) its live codes other than this browser's are still fewer than the cap. If either changed,
 *     the guard raises and nothing is written: a lost race, so the facts are read and decided again (three tries; then
 *     nothing is issued, the same answer as any refusal).
 */
export async function issueClientCode(
	db: D1Database,
	email: string,
	secret: string,
	now = new Date(),
	pending: string | null = null,
): Promise<{ code: string; nonce: string } | null> {
	const nonce =
		pending !== null && pendingFormat.test(pending)
			? pending
			: newPendingNonce();

	const nonceHash = await hashValue(nonce);
	const code = newCode();
	const digest = await codeHash(email, nonceHash, code, secret);
	const issuedAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + codeLifetimeMs).toISOString();

	const sweep = db
		.prepare("DELETE FROM audio_client_signin_codes WHERE expires_at<=?")
		.bind(issuedAt);

	for (let attempt = 0; attempt < issueAttempts; attempt++) {
		const [projectRows, countRows] = await db.batch<ProjectRow & { n: number }>(
			[
				projectFacts(db, email),
				db
					.prepare(`SELECT COUNT(*) AS n FROM audio_client_signin_codes WHERE email=? AND nonce_hash<>?
      AND used_at IS NULL AND expires_at>?`)
					.bind(email, nonceHash, issuedAt),
			],
		);

		const answer = decideIssue(
			{
				projects: projectsOf(projectRows.results),
				liveOthers: Number(countRows.results[0]?.n ?? 0),
			},
			liveCodesPerAddress,
		);

		// A refusal writes nothing but the sweep, in a batch of its own, so every request makes the same round trips.
		if (answer.kind !== "issue") {
			await db.batch([sweep]);

			return null;
		}

		try {
			await db.batch([
				sweep,
				db
					.prepare(`SELECT CASE WHEN EXISTS (${activeProjects})
        AND (SELECT COUNT(*) FROM audio_client_signin_codes WHERE email=? AND nonce_hash<>?
          AND used_at IS NULL AND expires_at>?)<?
        THEN 1 ELSE json_extract('changed','$') END`)
					.bind(email, email, nonceHash, issuedAt, answer.liveOthersBelow),
				db
					.prepare("DELETE FROM audio_client_signin_codes WHERE nonce_hash=?")
					.bind(nonceHash),
				db
					.prepare(`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at,used_at,session_token_hash)
        VALUES (?,?,?,0,?,?,NULL,NULL)`)
					.bind(nonceHash, email, digest, issuedAt, expiresAt),
				...answer.auditRequestIds.map((requestId) =>
					db
						.prepare(
							"INSERT INTO audio_client_access_audit(request_id,action,occurred_at) VALUES (?,'code-issued',?)",
						)
						.bind(requestId, issuedAt),
				),
			]);

			return { code, nonce };
		} catch (error) {
			if (!(error instanceof Error && guardRaised(error))) throw error;
		}
	}

	return null;
}

export async function discardUndeliveredCode(
	db: D1Database,
	email: string,
	code: string,
	nonce: string,
	secret: string,
	now = new Date(),
): Promise<void> {
	const nonceHash = await hashValue(nonce);
	const digest = await codeHash(email, nonceHash, code, secret);
	const liveCode = `SELECT 1 FROM audio_client_signin_codes WHERE email=? AND nonce_hash=? AND code_hash=? AND used_at IS NULL`;

	const [stored, projectRows] = await db.batch<ProjectRow & { found: number }>([
		db
			.prepare(`SELECT 1 AS found FROM (${liveCode})`)
			.bind(email, nonceHash, digest),
		projectFacts(db, email),
	]);

	// Nothing to discard when the code is already used or gone.
	if (!stored.results.length) return;

	try {
		await db.batch([
			db
				.prepare(
					`SELECT CASE WHEN EXISTS (${liveCode}) THEN 1 ELSE json_extract('changed','$') END`,
				)
				.bind(email, nonceHash, digest),
			...projectsOf(projectRows.results).map((project) =>
				db
					.prepare(
						"INSERT INTO audio_client_access_audit(request_id,action,occurred_at) VALUES (?,'code-delivery-failed',?)",
					)
					.bind(project.requestId, now.toISOString()),
			),
			db
				.prepare(
					"DELETE FROM audio_client_signin_codes WHERE email=? AND nonce_hash=? AND code_hash=? AND used_at IS NULL",
				)
				.bind(email, nonceHash, digest),
		]);
	} catch (error) {
		// The code was used or discarded since it was read: nothing left to do.
		if (!(error instanceof Error && guardRaised(error))) throw error;
	}
}

export async function listStudioSignInFailures(
	db: D1Database,
): Promise<{ requestId: string; clientName: string | null }[]> {
	const rows = await db
		.prepare(`SELECT a.request_id AS requestId,r.name AS clientName,MAX(a.id) AS last_failure
    FROM audio_client_access_audit a
    JOIN ${studioProjects} p ON p.request_id=a.request_id
    JOIN owner_requests r ON r.id=a.request_id
    WHERE a.action='code-delivery-failed' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND NOT EXISTS(SELECT 1 FROM audio_client_access_audit later
        WHERE later.request_id=a.request_id AND later.id>a.id AND later.action='signed-in')
    GROUP BY a.request_id ORDER BY last_failure DESC LIMIT 5`)
		.all<{
			requestId: string;
			clientName: string | null;
			last_failure: number;
		}>();

	return rows.results.map((row) => ({
		requestId: row.requestId,
		clientName: row.clientName,
	}));
}

const attemptsPerCode = 5;

/**
 * Completes sign-in for the browser holding `nonce` (its pending sign-in cookie). Without a well-formed value nothing is
 * read or written.
 *
 * What is read, decided and written (nothing here decides in SQL):
 *   read:  the browser's own code row, and the address's projects
 *   decide: `decideComplete` (src/lib/signin-code-rules.ts) counts the attempt, compares the stored hash in
 *     constant time, and says whether it signs in
 *   write: one batch of guards that re-check what the rule relied on: the attempt is counted only while the code is still
 *     unused, unexpired and under the limit; the code is accepted only while it is still unused and unexpired, still has
 *     the stored hash the rule compared (it was not replaced), the attempt was counted, and a project is still open.
 *     When a guard does not hold, nothing is accepted and the answer is the same as for a wrong code: every refusal
 *     here is one answer, so a lost race needs no retry.
 */
export async function completeClientCode(
	db: D1Database,
	email: string,
	code: string,
	nonce: string | null,
	secret: string,
	now = new Date(),
): Promise<string | null> {
	if (!/^\d{8}$/.test(code)) return null;

	if (nonce === null || !pendingFormat.test(nonce)) return null;
	const nonceHash = await hashValue(nonce);
	const digest = await codeHash(email, nonceHash, code, secret);
	const at = now.toISOString();

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
			.bind(email, nonceHash),
		projectFacts(db, email),
	]);

	const stored = codeRows.results[0];

	const answer = decideComplete(
		{
			code: stored
				? {
						attempts: Number(stored.attempts),
						usedAt: stored.usedAt,
						expiresAt: stored.expiresAt,
						codeHash: stored.codeHash,
					}
				: null,
			projects: projectsOf(projectRows.results),
		},
		{ limit: attemptsPerCode, now: at, digest },
	);

	if (answer.kind !== "count" || !stored) return null;

	const charge = db
		.prepare(`UPDATE audio_client_signin_codes SET attempts=attempts+1
      WHERE email=? AND nonce_hash=? AND used_at IS NULL AND expires_at>? AND attempts<?`)
		.bind(email, nonceHash, at, attemptsPerCode);

	if (!answer.accept) {
		await db.batch([charge]);

		return null;
	}

	const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
	const tokenHash = await hashValue(token);
	const expiresAt = new Date(now.getTime() + sessionLifetimeMs).toISOString();

	const [, used] = await db.batch([
		charge,
		db
			.prepare(`UPDATE audio_client_signin_codes SET used_at=?,session_token_hash=?
      WHERE email=? AND nonce_hash=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND changes()=1 AND EXISTS (${activeProjects})
      RETURNING nonce_hash`)
			.bind(at, tokenHash, email, nonceHash, stored.codeHash, at, email),
		db
			.prepare(`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      SELECT ?,email,?,?,? FROM audio_client_signin_codes WHERE nonce_hash=? AND session_token_hash=?`)
			.bind(tokenHash, at, expiresAt, at, nonceHash, tokenHash),
		...answer.auditRequestIds.map((requestId) =>
			db
				.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
        SELECT ?,'signed-in',? WHERE EXISTS(SELECT 1 FROM audio_client_sessions WHERE token_hash=?)`)
				.bind(requestId, at, tokenHash),
		),
	]);

	return used.results.length ? token : null;
}

const allowanceWindowMs = 5 * 60 * 1000;

/**
 * An atomic sign-in allowance: at most `limit` uses per five minutes for one scope and subject
 * (an email address or IP). Subjects are stored only as keyed hashes, and stale windows are
 * pruned in the same transaction.
 */
export async function reserveStudioAllowance(
	db: D1Database,
	scope: string,
	subject: string,
	limit: number,
	secret: string,
	now = new Date(),
) {
	const key = await keyedHash(secret, `${scope}:${subject}`);

	const [, counted] = await db.batch([
		db
			.prepare("DELETE FROM audio_client_allowances WHERE window_start<=?")
			.bind(new Date(now.getTime() - allowanceWindowMs).toISOString()),
		db
			.prepare(`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET uses=uses+1 RETURNING uses,window_start`)
			.bind(key, now.toISOString()),
	]);

	// SAFETY: counted is the upsert ... RETURNING uses,window_start (the batch's second statement), so each of its rows has a numeric uses and a string window_start.
	const row = counted.results[0] as
		| { uses: number; window_start: string }
		| undefined;

	return {
		key,
		windowStart: row?.window_start ?? "",
		allowed: Number(row?.uses ?? Infinity) <= limit,
	};
}

export async function takeStudioAllowance(
	db: D1Database,
	scope: string,
	subject: string,
	limit: number,
	secret: string,
	now = new Date(),
): Promise<boolean> {
	return (await reserveStudioAllowance(db, scope, subject, limit, secret, now))
		.allowed;
}

export async function clientProjectForSession(
	db: D1Database,
	token: string,
	projectId: string,
	now = new Date(),
) {
	if (!/^[0-9a-f-]{72}$/i.test(token)) return null;
	const tokenHash = await hashValue(token);

	return db
		.prepare(`SELECT p.request_id,p.stage,p.original_due_at,p.current_due_at,p.completed_at,
    r.summary,r.service_id,pay.booking_status,pay.balance_status,pay.booking_invoice_url,pay.balance_invoice_url,
    pay.booking_amount_cents,pay.balance_amount_cents
    FROM audio_client_sessions s
    JOIN owner_requests r ON r.email=s.email
    JOIN audio_projects p ON p.request_id=r.id
    LEFT JOIN audio_payments pay ON pay.request_id=r.id
    WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL
      AND p.request_id=? AND p.revoked_at IS NULL AND r.email<>'' AND r.status<>'withdrawn'`)
		.bind(tokenHash, now.toISOString(), projectId)
		.first<{
			request_id: string;
			stage: string;
			original_due_at: string | null;
			current_due_at: string | null;
			completed_at: string | null;
			summary: string;
			service_id: string | null;
			booking_status: string | null;
			balance_status: string | null;
			booking_invoice_url: string | null;
			balance_invoice_url: string | null;
			booking_amount_cents: number | null;
			balance_amount_cents: number | null;
		}>();
}

type PayableProject = Pick<
	NonNullable<Awaited<ReturnType<typeof clientProjectForSession>>>,
	| "booking_status"
	| "balance_status"
	| "booking_invoice_url"
	| "balance_invoice_url"
	| "booking_amount_cents"
	| "balance_amount_cents"
>;

const unpaid = ["open", "payment_failed"];

/** A Stripe-hosted invoice link, and nothing else, so a stored value can never send the client elsewhere. */
function stripeInvoiceUrl(value: string | null) {
	try {
		const url = new URL(value ?? "");

		return url.protocol === "https:" && url.hostname === "invoice.stripe.com"
			? url.href
			: null;
	} catch {
		return null;
	}
}

/** The invoice the client can pay now, if any: the booking first, then the balance. */
export function clientPaymentDue(project: PayableProject): {
	installment: "booking" | "balance";
	href: string;
	amountCents: number;
} | null {
	const booking = unpaid.includes(project.booking_status ?? "")
		? stripeInvoiceUrl(project.booking_invoice_url)
		: null;

	if (booking)
		return {
			installment: "booking",
			href: booking,
			amountCents: Number(project.booking_amount_cents ?? 0),
		};

	const balance =
		project.booking_status === "paid" &&
		unpaid.includes(project.balance_status ?? "")
			? stripeInvoiceUrl(project.balance_invoice_url)
			: null;

	return balance
		? {
				installment: "balance",
				href: balance,
				amountCents: Number(project.balance_amount_cents ?? 0),
			}
		: null;
}

export async function clientProjectsForSession(
	db: D1Database,
	token: string,
	now = new Date(),
) {
	if (!/^[0-9a-f-]{72}$/i.test(token)) return null;
	const tokenHash = await hashValue(token);

	const session = await db
		.prepare(`SELECT email FROM audio_client_sessions
    WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL`)
		.bind(tokenHash, now.toISOString())
		.first<{ email: string }>();

	if (!session) return null;

	// Only a published, unrevoked final with an expiry counts as delivered for the list.
	const projects = await db
		.prepare(`SELECT p.request_id,p.stage,r.summary,pay.booking_status,
      (SELECT MAX(f.expires_at) FROM audio_project_files f WHERE f.request_id=p.request_id
        AND f.version='final' AND f.status='published' AND f.expires_at IS NOT NULL) AS final_expires_at
    FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    LEFT JOIN audio_payments pay ON pay.request_id=p.request_id
    WHERE r.email=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL
    ORDER BY p.created_at DESC`)
		.bind(session.email)
		.all<{
			request_id: string;
			stage: string;
			summary: string;
			booking_status: string | null;
			final_expires_at: string | null;
		}>();

	return projects.results;
}

export function studioSessionCookie(token: string, secure: boolean): string {
	return `studio_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeMs / 1000}${secure ? "; Secure" : ""}`;
}

// Over https the pending cookie is __Host- prefixed (Secure, Path=/, no Domain), so a sibling subdomain cannot plant or
// shadow it. Plain-http localhost cannot hold a prefixed cookie, so it keeps the plain name on the API path.
const pendingCookieName = (secure: boolean) =>
	secure ? "__Host-studio_pending" : "studio_pending";

const pendingCookiePath = (secure: boolean) => (secure ? "/" : "/api/studio");

/** The pending sign-in cookie: set when a code is requested, so only this browser can use the code. */
export function pendingSignInCookie(nonce: string, secure: boolean): string {
	return `${pendingCookieName(secure)}=${nonce}; Path=${pendingCookiePath(secure)}; HttpOnly; SameSite=Lax; Max-Age=${codeLifetimeMs / 1000}${secure ? "; Secure" : ""}`;
}

export function clearPendingSignInCookie(secure: boolean): string {
	return `${pendingCookieName(secure)}=; Path=${pendingCookiePath(secure)}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** The browser's pending value, read by the name that fits the request's scheme; the other name is ignored. */
export function pendingSignInFromRequest(request: Request): string | null {
	const name = pendingCookieName(new URL(request.url).protocol === "https:");

	const match = request.headers
		.get("cookie")
		?.match(new RegExp(`(?:^|;\\s*)${name}=([0-9a-f]{64})(?:;|$)`));

	return match?.[1] ?? null;
}

/**
 * Deletes the closed project's address from the retired sign-in codes table. Nothing reads that table any more; its rows
 * (an address and a code hash) are cleared so they do not outlive retention until a later migration drops it.
 *
 * Best effort: it runs after the revocation has committed, so a failure must not make the revocation look failed. A
 * missing table (already dropped) is silent; any other failure is logged as one fixed line with the error class only, and
 * the retention script still sweeps the leftover rows.
 */
export async function deleteRetiredCodes(
	db: D1Database,
	requestId: string,
): Promise<void> {
	try {
		await db
			.prepare(
				"DELETE FROM audio_client_codes WHERE email=(SELECT email FROM owner_requests WHERE id=?)",
			)
			.bind(requestId)
			.run();
	} catch (error) {
		if (error instanceof Error && /no such table/i.test(error.message)) return;
		console.error(
			`Retired sign-in codes cleanup failed (${error instanceof Error ? error.name : "Error"}).`,
		);
	}
}

export async function revokeClientSession(
	db: D1Database,
	token: string,
	now = new Date(),
): Promise<void> {
	if (!/^[0-9a-f-]{72}$/i.test(token)) return;
	const tokenHash = await hashValue(token);
	await db
		.prepare(
			"UPDATE audio_client_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
		)
		.bind(now.toISOString(), tokenHash)
		.run();
}

export function clearStudioSessionCookie(secure: boolean): string {
	return `studio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function studioSessionFromRequest(request: Request): string | null {
	const match = request.headers
		.get("cookie")
		?.match(/(?:^|;\s*)studio_session=([0-9a-f-]{72})(?:;|$)/i);

	return match?.[1] ?? null;
}

type ListedProject = { stage: string; final_expires_at: string | null };

/**
 * Splits a client's songs into active and delivered. Delivered needs a published final file, not just
 * a stage, so a revoked final keeps the song active. `available` is false once the final has expired.
 */
export function groupStudioProjects<T extends ListedProject>(
	projects: T[],
	now = new Date(),
) {
	const delivered = (project: T) =>
		(project.stage === "final_files_ready" || project.stage === "complete") &&
		Boolean(project.final_expires_at);

	return {
		active: projects.filter((project) => !delivered(project)),
		delivered: projects.flatMap((project) =>
			delivered(project)
				? [
						{
							...project,
							available: Date.parse(project.final_expires_at!) > now.getTime(),
						},
					]
				: [],
		),
	};
}

/** Software client fields are an explicit projection; owner records never cross this boundary. */
export async function clientSoftwareProjectsForSession(
	db: D1Database,
	token: string,
	now = new Date(),
) {
	if (!/^[0-9a-f-]{72}$/i.test(token)) return null;

	const session = await db
		.prepare(
			`SELECT email FROM audio_client_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL`,
		)
		.bind(await hashValue(token), now.toISOString())
		.first<{ email: string }>();

	if (!session) return null;

	return (
		await db
			.prepare(`SELECT p.request_id,p.offer_id,p.terms_json,p.payment_mode,p.state,p.waiting_for,p.milestone_index,p.step,
    p.first_payment_recorded_at,p.started_at,p.next_update_on FROM software_projects p JOIN owner_requests r ON r.id=p.request_id
    WHERE r.email=? AND r.email<>'' AND r.status<>'withdrawn' AND p.revoked_at IS NULL AND p.content_deleted_at IS NULL
    ORDER BY p.created_at DESC`)
			.bind(session.email)
			.all<ClientSoftwareProject>()
	).results;
}

export type ClientSoftwareProject = {
	request_id: string;
	offer_id: string;
	terms_json: string;
	payment_mode: "standard" | "invoice";
	state: string;
	waiting_for: string;
	milestone_index: number;
	step: string;
	first_payment_recorded_at: string;
	started_at: string;
	next_update_on: string | null;
};

export async function clientSoftwareProjectForSession(
	db: D1Database,
	token: string,
	id: string,
	now = new Date(),
) {
	const projects = await clientSoftwareProjectsForSession(db, token, now);

	return projects?.find((project) => project.request_id === id) ?? null;
}
