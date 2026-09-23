#!/usr/bin/env node
// Writes the screenshot section into the PR description. Runs in the trusted publish workflow;
// the manifest and images come from untrusted pull request code and are sanitized first.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, DIR, SHA, MANIFEST, IMAGES (GITHUB_API_URL is set by Actions).
import { readdir, readFile } from 'node:fs/promises';
import { sanitizeManifest, screenshotSection, withScreenshots } from './config.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, DIR, SHA, MANIFEST, IMAGES } = process.env;
if (!/^\d+$/.test(PR_NUMBER ?? '') || !/^[0-9a-f]{40}$/.test(SHA ?? '') || !/^pr-\d+\/[0-9a-f]{7}$/.test(DIR ?? '')) {
  throw new Error('Refusing to update: unexpected pull request number, commit or folder.');
}
const url = `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}`;
const headers = { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
let raw = {};
try { raw = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { /* An unreadable manifest publishes an empty table. */ }
const manifest = sanitizeManifest(raw, await readdir(IMAGES));
const section = screenshotSection(manifest, `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/screenshots/${DIR}`, SHA);

const readPull = async () => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Reading the PR failed: ${response.status}`);
  return response.json();
};
// GitHub has no conditional update for PR bodies. Re-read just before writing and start over if
// someone edited the description meanwhile, which keeps the overwrite window to one request.
for (let attempt = 1; ; attempt++) {
  const { body } = await readPull();
  const next = withScreenshots(body, section);
  const latest = await readPull();
  // A newer push has its own run coming; these screenshots would replace that run's.
  if (latest.head?.sha !== SHA) {
    console.log(`The PR has moved on to ${latest.head?.sha}; leaving the description alone.`);
    process.exit(0);
  }
  if (latest.body !== body) {
    if (attempt === 3) throw new Error('The description kept changing; not overwriting it.');
    continue;
  }
  const updated = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ body: next }) });
  if (!updated.ok) throw new Error(`Updating the PR failed: ${updated.status}`);
  break;
}
console.log('PR description updated.');
