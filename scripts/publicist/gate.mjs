import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentsBlock, captureProblems, entryIds, frontMatter, noteProblems, textProblems } from './lib.mjs';

// Mechanical safeguard for publicist content (docs/publicist/README.md, section 9).
// It confirms approvals exist; it cannot judge whether copy follows from them.
// Logs name entry IDs and pass or fail only, never note content.
const errors = [];
const config = JSON.parse(readFileSync('publicist/config.json', 'utf8'));

const skill = readFileSync('.agents/skills/publicist/SKILL.md', 'utf8');
if (!readFileSync('AGENTS.md', 'utf8').includes(agentsBlock(skill))) {
  errors.push('AGENTS.md publicist block is out of date; run npm run publicist:sync');
}

const entries = [];
for (const [project, { data }] of Object.entries(config.projects)) {
  if (!existsSync(data)) continue;
  const source = readFileSync(data, 'utf8');
  for (const id of entryIds(source)) entries.push({ project, id });
  for (const problem of textProblems(source)) errors.push(`${data}: ${problem}`);
  if (project === 'tally') for (const problem of captureProblems(source)) errors.push(`${data}: ${problem}`);
}

const ids = new Set(entries.map(entry => entry.id));
const queue = 'publicist/queue';
if (existsSync(queue)) {
  for (const name of readdirSync(queue).filter(name => name.endsWith('.md'))) {
    const text = readFileSync(join(queue, name), 'utf8');
    const { source } = frontMatter(text);
    if (!ids.has(source)) errors.push(`${queue}/${name}: source entry "${source}" is not a journal entry`);
    for (const problem of textProblems(text)) errors.push(`${queue}/${name}: ${problem}`);
  }
}

const token = process.env.PUBLICIST_PRIVATE_TOKEN;
const inCi = Boolean(process.env.CI || process.env.WORKERS_CI);
if (entries.length && !token) {
  if (inCi) errors.push(`${entries.length} publicist entries need review notes, but PUBLICIST_PRIVATE_TOKEN is not set`);
  else console.warn(`publicist-gate: skipped private note lookup for ${entries.length} entries (no token; local build).`);
} else if (entries.length) {
  for (const { project, id } of entries) {
    const url = `https://api.github.com/repos/${config.privateRepo}/contents/review-notes/${project}/${id}/note.md?ref=main`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (response.status === 404) { errors.push(`${id}: no review note on the private main branch`); continue; }
    if (!response.ok) { errors.push(`${id}: could not read review note (HTTP ${response.status})`); continue; }
    for (const problem of noteProblems(await response.text())) errors.push(`${id}: ${problem}`);
  }
}

if (errors.length) {
  console.error(`publicist-gate failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`publicist-gate passed: ${entries.length} entries checked.`);
