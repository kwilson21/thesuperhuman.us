#!/usr/bin/env node
// Writes the "Link previews" section into a pull request description: one contact sheet per scene
// the CI rendered, from the screenshots branch. Runs in the trusted publish workflow.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, SHA (the render commit), DIR, SCENES.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, SHA, DIR, SCENES } = process.env;
const scenes = (SCENES ?? '').split(' ').filter(Boolean);
if (!/^\d+$/.test(PR_NUMBER ?? '') || !/^[0-9a-f]{40}$/.test(SHA ?? '') || !/^pr-\d+\/previews-[0-9a-f]{7}$/.test(DIR ?? '') || !scenes.every(scene => /^[a-z0-9-]{1,80}$/.test(scene))) {
  throw new Error('Refusing to update: unexpected pull request number, commit, folder or scene.');
}
const START = '<!-- previews:start -->';
const END = '<!-- previews:end -->';

function withPreviews(body, section) {
  const text = body ?? '';
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${section}${text.slice(end + END.length)}`;
  return `${text.trimEnd()}\n\n${section}\n`;
}

const base = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/screenshots/${DIR}`;
const section = [
  START,
  '## Link previews',
  `_Rendered by CI at ${SHA.slice(0, 7)} for the scenes this pull request made stale. Each sheet shows the loop's frames in order. Merging approves them; see \`docs/asset-reviews/link-previews.md\`._`,
  '',
  '| Scene | Contact sheet |',
  '|---|---|',
  ...scenes.map(scene => `| \`${scene}\` | <img src="${base}/${scene}-sheet.png" width="640" alt="${scene} contact sheet"> |`),
  END,
].join('\n');

const url = `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}`;
const headers = { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const readPull = async () => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Reading the PR failed: ${response.status}`);
  return response.json();
};
// Re-read just before writing, as scripts/screenshots/update-pr-body.mjs does, so an edit made
// meanwhile is not overwritten.
for (let attempt = 1; ; attempt++) {
  const { body } = await readPull();
  const latest = await readPull();
  if (latest.head?.sha !== SHA) { console.log(`The PR has moved on to ${latest.head?.sha}; leaving the description alone.`); process.exit(0); }
  if (latest.body !== body) {
    if (attempt === 3) throw new Error('The description kept changing; not overwriting it.');
    continue;
  }
  const updated = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ body: withPreviews(body, section) }) });
  if (!updated.ok) throw new Error(`Updating the PR failed: ${updated.status}`);
  break;
}
console.log('PR description updated.');
