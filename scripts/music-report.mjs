#!/usr/bin/env node
import { renderMusicReport } from './music-report-view.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { openMusicDatabase, lifetimePlayback, dailyPlayback } from './music-analytics.mjs';
const remote = process.argv.includes('--remote');
const contacts = process.argv.includes('--contacts');
const queries = {
  playback: lifetimePlayback,
  playbackByDay: dailyPlayback + ' ORDER BY day DESC,release_id,recording_id,medium,event',
  interest: 'SELECT release_id,interest,count(*) AS count FROM music_interest GROUP BY release_id,interest',
  merchandise: 'SELECT release_id,j.value AS item,count(*) AS count FROM music_interest,json_each(merchandise) AS j GROUP BY release_id,j.value',
};
if (contacts) queries.contacts = 'SELECT release_id,email,interest,merchandise,suggestion,consent_version,updated_at FROM music_interest ORDER BY updated_at DESC';
const database = await openMusicDatabase(remote);
const report = { environment: remote ? 'Production' : 'Local test data', generatedAt: new Date().toISOString() };
try {
  for (const [key, sql] of Object.entries(queries)) report[key] = await database.query(sql);
} finally { await database.close(); }
await mkdir('.private', { recursive: true });
await writeFile('.private/music-demand-report.json', JSON.stringify(report,null,2), { mode: 0o600 });
await writeFile('.private/music-demand-report.html', renderMusicReport('Music demand', `${report.environment} · ${report.generatedAt}`, 'Starts and 30-second listens are browser-reported, deduplicated per tab session and recording. They are not audited unique listeners. Interest totals represent unverified email addresses, not guaranteed buyers.', report), { mode: 0o600 });
console.log('Saved .private/music-demand-report.html and .private/music-demand-report.json');
