#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMusicDatabase } from './music-analytics.mjs';
import { renderMusicReport } from './music-report-view.mjs';
import { finishedPaymentTerms } from './owner-retention.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');
const cutoff = (now, days) => new Date(now.getTime() - days * 86400000).toISOString();
const ids = rows => rows.length ? rows.map(row => quote(row[0])).join(',') : "''";
const snapshot = sql => `SELECT json_group_array(json_array(${sql.columns.split(',').map(column => column.trim().split('.').pop()).join(',')})) AS snapshot FROM
  (SELECT ${sql.columns} FROM ${sql.from} WHERE ${sql.where} ORDER BY ${sql.order} LIMIT ${sql.limit})`;

function sources(now) {
  const old = quote(cutoff(now, 30));
  const auditOld = quote(cutoff(now, 730));
  const projectWhere = `p.content_deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM audio_project_uploads upload WHERE upload.request_id=p.request_id)
    AND ((r.status IN ('withdrawn','resolved') AND p.stage='files_under_review'
      AND COALESCE(r.resolved_at,r.updated_at)<=${old}
      AND NOT EXISTS(SELECT 1 FROM audio_project_files f WHERE f.request_id=p.request_id
        AND f.version='final' AND f.published_at IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM audio_payments pay WHERE pay.request_id=p.request_id
        AND NOT (${finishedPaymentTerms})))
      OR (p.stage IN ('final_files_ready','complete')
        AND EXISTS(SELECT 1 FROM audio_payments pay WHERE pay.request_id=p.request_id
          AND pay.booking_status='paid' AND pay.balance_status='paid')
        AND EXISTS(SELECT 1 FROM audio_project_files f WHERE f.request_id=p.request_id
          AND f.version='final' AND f.published_at IS NOT NULL AND f.expires_at<=${old})
        AND NOT EXISTS(SELECT 1 FROM audio_project_files f WHERE f.request_id=p.request_id
          AND f.version='final' AND f.published_at IS NOT NULL AND (f.expires_at IS NULL OR f.expires_at>${old}))
      ))`;
  const projects = snapshot({ columns: 'p.request_id,p.updated_at', from: 'audio_projects p JOIN owner_requests r ON r.id=p.request_id', where: projectWhere, order: 'p.request_id', limit: 25 });
  const codes = snapshot({ columns: 'email,created_at', from: 'audio_client_codes', where: `COALESCE(used_at,expires_at)<${old}`, order: 'email', limit: 1000 });
  const sessions = snapshot({ columns: 'token_hash,last_seen_at', from: 'audio_client_sessions',
    where: `expires_at<${old} OR revoked_at<${old} OR last_seen_at<${old}`, order: 'token_hash', limit: 1000 });
  const accessAudit = snapshot({ columns: 'id,occurred_at', from: 'audio_client_access_audit', where: `occurred_at<${auditOld}`, order: 'id', limit: 1000 });
  const projectAudit = snapshot({ columns: 'id,occurred_at', from: 'audio_project_audit', where: `occurred_at<${auditOld}`, order: 'id', limit: 1000 });
  return { projects, codes, sessions, accessAudit, projectAudit, old };
}

const fileSnapshot = projectIds => snapshot({
  columns: 'id,request_id,object_key,status,expires_at', from: 'audio_project_files',
  where: `request_id IN (${ids(projectIds)})`, order: 'request_id,id', limit: 1000,
});
const contentSnapshot = (table, projectIds) => snapshot({
  columns: 'id,request_id,created_at', from: table,
  where: `request_id IN (${ids(projectIds)})`, order: 'request_id,id', limit: 5000,
});
const unwrap = rows => JSON.parse(rows[0].snapshot);
async function readSource(database, query) { return unwrap(await database.query(query)); }

async function ensureSchema(database) {
  const rows = await database.query('PRAGMA table_info(audio_projects)');
  if (!rows.some(row => row.name === 'content_deleted_at')) throw new Error('Apply studio retention migration 0014 before running retention.');
}

export async function previewStudioRetention(database, environment, now = new Date()) {
  await ensureSchema(database);
  const sql = sources(now);
  const projects = await readSource(database, sql.projects);
  const files = await readSource(database, fileSnapshot(projects));
  const messages = await readSource(database, contentSnapshot('audio_project_messages', projects));
  const updates = await readSource(database, contentSnapshot('audio_project_updates', projects));
  if (files.length === 1000 || messages.length === 5000 || updates.length === 5000) {
    throw new Error('The reviewed content batch reached its limit. Reduce the project batch size before cleanup.');
  }
  const codes = await readSource(database, sql.codes);
  const sessions = await readSource(database, sql.sessions);
  const accessAudit = await readSource(database, sql.accessAudit);
  const projectAudit = await readSource(database, sql.projectAudit);
  return {
    version: 1, environment, generatedAt: now.toISOString(),
    sources: { projects: hash(JSON.stringify(projects)), files: hash(JSON.stringify(files)),
      messages: hash(JSON.stringify(messages)), updates: hash(JSON.stringify(updates)),
      codes: hash(JSON.stringify(codes)), sessions: hash(JSON.stringify(sessions)),
      accessAudit: hash(JSON.stringify(accessAudit)), projectAudit: hash(JSON.stringify(projectAudit)) },
    counts: { projects: projects.length, objects: files.length, messages: messages.length, updates: updates.length,
      codes: codes.length, sessions: sessions.length,
      accessAudit: accessAudit.length, projectAudit: projectAudit.length },
    notes: 'Preview contains counts and source hashes only. Apply the matching manifest within 24 hours. Object deletion precedes atomic database cleanup; if it fails, client access remains closed and a fresh preview can be applied after the storage issue is fixed. Run owner request retention separately after studio cleanup.',
  };
}

export async function applyStudioRetention(database, review, environment, deleteObject, now = new Date()) {
  if (review?.version !== 1 || review.environment !== environment ||
    !Number.isFinite(Date.parse(review.generatedAt)) ||
    now.getTime() < Date.parse(review.generatedAt) || now.getTime() - Date.parse(review.generatedAt) > 86400000) {
    throw new Error('Studio retention review is invalid, for another environment, or older than 24 hours.');
  }
  await ensureSchema(database);
  const sql = sources(new Date(review.generatedAt));
  const queries = { projects: sql.projects, codes: sql.codes, sessions: sql.sessions,
    accessAudit: sql.accessAudit, projectAudit: sql.projectAudit };
  const values = {};
  for (const [name, query] of Object.entries(queries)) values[name] = await readSource(database, query);
  values.files = await readSource(database, fileSnapshot(values.projects));
  values.messages = await readSource(database, contentSnapshot('audio_project_messages', values.projects));
  values.updates = await readSource(database, contentSnapshot('audio_project_updates', values.projects));
  for (const [name, rows] of Object.entries(values)) {
    if (hash(JSON.stringify(rows)) !== review.sources?.[name] || rows.length !== review.counts?.[name === 'files' ? 'objects' : name]) {
      throw new Error('Studio retention source changed or review was already applied. Generate a fresh preview.');
    }
  }
  const projectIds = ids(values.projects);
  const objectRows = values.files;
  for (const [, requestId, key] of objectRows) {
    if (!/^studio\/projects\/[a-z0-9-]{1,100}\/[a-z0-9-]{1,100}\.(mp3|wav)$/.test(key) ||
      !key.startsWith(`studio/projects/${requestId}/`)) throw new Error('Unexpected private object key; no database content was removed.');
  }
  const guard = (query, rows) => `SELECT CASE WHEN (${query})=${quote(JSON.stringify(rows))} THEN 1 ELSE json_extract('changed','$') END`;
  const fileIds = ids(objectRows);
  const statements = [
    ...Object.entries(queries).map(([name, query]) => guard(query, values[name])),
    guard(fileSnapshot(values.projects), values.files),
    guard(contentSnapshot('audio_project_messages', values.projects), values.messages),
    guard(contentSnapshot('audio_project_updates', values.projects), values.updates),
    `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM audio_projects WHERE request_id IN (${projectIds}) AND revoked_at IS NULL)
      THEN 1 ELSE json_extract('access-open','$') END`,
    `DELETE FROM audio_client_codes WHERE email IN (${ids(values.codes)})`,
    `DELETE FROM audio_client_sessions WHERE token_hash IN (${ids(values.sessions)})`,
    `DELETE FROM audio_client_access_audit WHERE id IN (${ids(values.accessAudit)})`,
    `DELETE FROM audio_project_audit WHERE id IN (${ids(values.projectAudit)})`,
    `DELETE FROM audio_project_file_access WHERE file_id IN (${fileIds})`,
    `DELETE FROM audio_project_updates WHERE request_id IN (${projectIds})`,
    `DELETE FROM audio_project_messages WHERE request_id IN (${projectIds})`,
    `DELETE FROM audio_project_files WHERE request_id IN (${projectIds})`,
    `UPDATE audio_projects SET content_deleted_at=${quote(now.toISOString())}
      WHERE request_id IN (${projectIds}) AND revoked_at IS NOT NULL AND content_deleted_at IS NULL`,
  ];
  if (statements.some(statement => Buffer.byteLength(statement) > 90_000)) throw new Error('Reviewed studio retention batch is too large. Reduce batch limits.');
  if (values.projects.length) {
    await database.batch([
      guard(sql.projects, values.projects),
      guard(fileSnapshot(values.projects), values.files),
      guard(contentSnapshot('audio_project_messages', values.projects), values.messages),
      guard(contentSnapshot('audio_project_updates', values.projects), values.updates),
      `UPDATE audio_projects SET revoked_at=COALESCE(revoked_at,${quote(now.toISOString())})
        WHERE request_id IN (${projectIds}) AND content_deleted_at IS NULL`,
    ]);
  }
  for (const [, , key] of objectRows) await deleteObject(key);
  await database.batch(statements);
  return review.counts;
}

async function remoteObjectDeleter(key, configPath) {
  const temporary = await mkdtemp(resolve('.private/studio-retention-'));
  try {
    const args = ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'delete', `superhuman-audio/${key}`, '--remote'];
    if (configPath) args.push('--config', resolve(configPath));
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8', env: { ...process.env, WRANGLER_LOG_PATH: resolve(temporary, 'wrangler.log') },
    });
    if (result.status !== 0 || /Operation cancelled/i.test(result.stdout)) throw new Error('Private object deletion failed. Retention stopped; inspect R2 and generate a fresh preview.');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  const remote = args.includes('--remote'), applyIndex = args.indexOf('--apply'), configIndex = args.indexOf('--config');
  const reviewPath = applyIndex < 0 ? '.private/studio-retention-review.json' : args[applyIndex + 1];
  const configPath = configIndex < 0 ? undefined : args[configIndex + 1];
  const allowed = new Set(['--remote', '--apply', '--config', ...(applyIndex < 0 ? [] : [reviewPath]), ...(configPath ? [configPath] : [])]);
  if (!reviewPath || (configIndex >= 0 && (!remote || !configPath)) || args.some(arg => !allowed.has(arg))) {
    throw new Error('Usage: node scripts/studio-retention.mjs [--remote --config path] [--apply .private/studio-retention-review.json]');
  }
  await mkdir('.private', { recursive: true });
  const environment = remote ? (configPath ? `Remote ${configPath}` : 'Production') : 'Local test data';
  const database = await openMusicDatabase(remote, configPath);
  const proxy = !remote && applyIndex >= 0 ? await (await import('wrangler')).getPlatformProxy({
    configPath: resolve('.private/wrangler-music-preview.json'), persist: { path: '.wrangler/state/v3' },
  }) : null;
  try {
    if (applyIndex >= 0) {
      const review = JSON.parse(await readFile(resolve(reviewPath), 'utf8'));
      const counts = await applyStudioRetention(database, review, environment,
        key => remote ? remoteObjectDeleter(key, configPath) : proxy.env.AUDIO.delete(key));
      console.log(`Removed ${counts.objects} private objects and cleared ${counts.projects} closed projects. Run owner request retention next.`);
    } else {
      const review = await previewStudioRetention(database, environment);
      await writeFile(reviewPath, JSON.stringify(review, null, 2), { mode: 0o600 });
      await writeFile('.private/studio-retention-review.html', renderMusicReport('Studio retention review',
        `${environment} · ${review.generatedAt}`, review.notes, { Counts: review.counts }), { mode: 0o600 });
      console.log(`Preview only: ${review.counts.projects} closed projects and ${review.counts.objects} private objects are eligible. Review .private/studio-retention-review.html before apply.`);
    }
  } finally { await proxy?.dispose(); await database.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
