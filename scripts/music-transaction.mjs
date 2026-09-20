// One preparation at a time. The journal survives process interruption; rerunning
// preparation restores the old package before reading the catalog again.
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
const transactionPath = root => join(root, '.private/music-prepare-transaction');
async function exists(path, io) {
  try { await io.stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function rollback(dir, entries, io) {
  for (const entry of entries) {
    if (entry.existed) {
      // Keep the backup intact until every restoration succeeds, so recovery can
      // itself be interrupted and retried without losing the original bytes.
      const restoring = `${entry.backup}.restoring`;
      await io.copyFile(entry.backup, restoring);
      await io.rename(restoring, entry.target);
    } else await io.rm(entry.target, { force: true });
  }
  await io.rm(dir, { recursive: true, force: true });
}
export async function recoverMusicFiles(root = process.cwd(), io = fs) {
  const dir = transactionPath(root);
  if (!await exists(dir, io)) return;
  // An absent owner means another process may still be acquiring the lock. No
  // targets are touched before this file and the complete journal are written.
  const ownerPath = join(dir, 'owner.json');
  if (!await exists(ownerPath, io)) throw new Error(`Incomplete preparation lock: inspect ${dir} before removing it`);
  const { pid } = JSON.parse(await io.readFile(ownerPath, 'utf8'));
  try { process.kill(pid, 0); throw new Error('Another music preparation is still running'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const journal = join(dir, 'journal.json');
  if (await exists(join(dir, 'committed'), io) || !await exists(journal, io)) {
    await io.rm(dir, { recursive: true, force: true });
  } else await rollback(dir, JSON.parse(await io.readFile(journal, 'utf8')), io);
}
export async function commitMusicFiles(files, root = process.cwd(), io = fs) {
  const dir = transactionPath(root);
  await io.mkdir(dirname(dir), { recursive: true });
  await io.mkdir(dir); // Exclusive creation prevents concurrent commits.
  let entries;
  try {
    await io.writeFile(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }));
    const prepared = [];
    for (const [index, file] of files.entries()) {
      const target = join(root, file.target);
      const staged = join(dir, `${index}.staged`);
      const backup = join(dir, `${index}.backup`);
      await io.mkdir(dirname(target), { recursive: true });
      const existed = await exists(target, io);
      if (existed) await io.copyFile(target, backup);
      await io.writeFile(staged, file.bytes);
      prepared.push({ target, staged, backup, existed });
    }
    await io.writeFile(join(dir, 'journal.pending'), JSON.stringify(prepared));
    await io.rename(join(dir, 'journal.pending'), join(dir, 'journal.json'));
    entries = prepared;
    for (const entry of entries) await io.rename(entry.staged, entry.target);
    await io.writeFile(join(dir, 'committed'), '');
  } catch (error) {
    if (entries) await rollback(dir, entries, io);
    else await io.rm(dir, { recursive: true, force: true });
    throw error;
  }
  // Once committed, cleanup failure must not undo a successfully prepared package.
  await io.rm(dir, { recursive: true, force: true });
}
