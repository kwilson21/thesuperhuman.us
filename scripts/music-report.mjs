#!/usr/bin/env node
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
await writeFile('.private/music-demand-report.json', JSON.stringify(report,null,2));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const sections = Object.entries(report).filter(([, value]) => Array.isArray(value) && value.length).map(([key, rows]) => `<section><h2>${escape(key)}</h2><div class="scroll"><table><thead><tr>${Object.keys(rows[0]).map(k => `<th>${escape(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${Object.values(row).map(v => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('');
await writeFile('.private/music-demand-report.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Music demand</title><style>body{background:#fbf8f2;color:#0e0e0e;font:16px/1.6 system-ui;max-width:1100px;margin:4rem auto;padding:0 1rem}h1{font:3rem Georgia}h2{text-transform:capitalize}section{border-top:1px solid #e8e3da;margin-top:2rem}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #e8e3da}small,p{color:#4a4a4a}</style><h1>Music demand</h1><p>${escape(report.environment)} · ${escape(report.generatedAt)}</p><p>Starts and 30-second listens are browser-reported, deduplicated per tab session and recording. They are not audited unique listeners. Interest totals represent unverified email addresses, not guaranteed buyers.</p>${sections || '<p>No engagement recorded yet.</p>'}<small>Private operator report. Never publish contact exports.</small></html>`);
console.log('Saved .private/music-demand-report.html and .private/music-demand-report.json');
