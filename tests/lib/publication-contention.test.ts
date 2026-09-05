import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { D1PublicationJournal } from '~/lib/publication/journal';
import type { Publication } from '~/lib/publication/contract';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

it('serializes simultaneous connections competing for the same project revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'publication-'));
  const filename = join(directory, 'journal.sqlite');
  const sql = new DatabaseSync(filename);
  sql.exec(readFileSync(new URL('../../migrations/0001_publication_journal.sql', import.meta.url), 'utf8'));
  sql.close();
  const barrier = new SharedArrayBuffer(4);
  const workers: Worker[] = [];
  const db = {
    prepare: (query: string) => ({ bind: (...args: unknown[]) => ({ query, args }) }),
    batch: (statements: unknown[]) => new Promise((resolve, reject) => {
      const worker = new Worker(`
        const { workerData: d, parentPort } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(d.filename);
        db.exec('PRAGMA busy_timeout=5000');
        const gate = new Int32Array(d.barrier);
        Atomics.add(gate,0,1); Atomics.notify(gate,0);
        while (Atomics.load(gate,0)<2) Atomics.wait(gate,0,1,5000);
        try {
          db.exec('BEGIN IMMEDIATE');
          const results = d.statements.map(s => ({ results: db.prepare(s.query).all(...s.args) }));
          db.exec('COMMIT'); parentPort.postMessage(results);
        } finally { db.close(); }
      `, { eval: true, workerData: { filename, barrier, statements } });
      workers.push(worker); worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => { if (code) reject(new Error('Worker failed')); });
    }),
  } as unknown as D1Database;
  const journal = new D1PublicationJournal(db);
  const p: Publication = { version: 1, projectId: 'threadline', eventId: 'a', entryId: 'a',
    expectedRevision: 0, operation: 'withdraw', story: null, origin: 'work',
    occurredOn: '2026-09-05', threadId: null, milestoneId: null };
  try {
    const results = await Promise.all([journal.commit(p), journal.commit({ ...p, eventId: 'b', entryId: 'b' })]);
    expect(results.map(r => r.status).sort()).toEqual(['accepted', 'conflict']);
  } finally {
    await Promise.all(workers.map(w => w.terminate()));
    rmSync(directory, { recursive: true, force: true });
  }
});
