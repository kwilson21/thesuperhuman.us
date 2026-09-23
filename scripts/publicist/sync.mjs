import { readFileSync, writeFileSync } from 'node:fs';
import { syncAgents } from './lib.mjs';

// Writes the publicist hard rules into AGENTS.md from the canonical skill.
const skill = readFileSync('.agents/skills/publicist/SKILL.md', 'utf8');
const agents = readFileSync('AGENTS.md', 'utf8');
const next = syncAgents(agents, skill);
if (next !== agents) { writeFileSync('AGENTS.md', next); console.log('AGENTS.md publicist block updated.'); }
else console.log('AGENTS.md publicist block already in sync.');
