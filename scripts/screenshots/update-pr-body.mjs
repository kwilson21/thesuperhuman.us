#!/usr/bin/env node
// Writes the screenshot section into the PR description.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, DIR, SHA (GITHUB_API_URL is set by Actions).
import { readFile } from 'node:fs/promises';
import { OUT, screenshotSection, withScreenshots } from './config.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, DIR, SHA } = process.env;
const url = `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}`;
const headers = { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const manifest = JSON.parse(await readFile(`${OUT}/manifest.json`, 'utf8'));
const section = screenshotSection(manifest, `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/screenshots/${DIR}`, SHA);

const current = await fetch(url, { headers });
if (!current.ok) throw new Error(`Reading the PR failed: ${current.status}`);
const { body } = await current.json();
const updated = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ body: withScreenshots(body, section) }) });
if (!updated.ok) throw new Error(`Updating the PR failed: ${updated.status}`);
console.log('PR description updated.');
