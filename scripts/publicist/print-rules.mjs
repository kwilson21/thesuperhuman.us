import { readFileSync } from 'node:fs';
import { hardRules } from './lib.mjs';

// SessionStart hook: re-inject the publicist hard rules after context compaction.
const skill = readFileSync('.agents/skills/publicist/SKILL.md', 'utf8');
console.log(`Publicist hard rules (full instructions: .agents/skills/publicist/SKILL.md):\n\n${hardRules(skill)}`);
