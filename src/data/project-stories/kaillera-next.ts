import type { ImageMetadata } from 'astro';
import type { Milestone } from '~/lib/project-story';
import prototype from '~/assets/projects/kaillera-next/prototype-v0.1.0.webp';
import lobbyDesktop from '~/assets/projects/kaillera-next/lobby-v0.8.0-desktop.webp';
import lobbyPhone from '~/assets/projects/kaillera-next/lobby-v0.8.0-phone.webp';
import gamepad from '~/assets/projects/kaillera-next/gamepad-iphone.webp';
import syncDiagram from '~/assets/projects/kaillera-next/staying-in-sync-diagram.webp';
import bitsDiagram from '~/assets/projects/kaillera-next/identical-bits-diagram.webp';
import rollbackDiagram from '~/assets/projects/kaillera-next/rollback-diagram.webp';

export const kailleraStory = {
  title: 'Kaillera Next',
  subtitle: 'Open a link and play N64 games with friends, nothing to install.',
  description: 'Kaillera introduced me to programming. I set the direction and Claude Code writes the code.',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind: string) => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Publicist backfill. Each entry is the owner-approved draft from its private
// review note (same ID), changed only for formatting. Page renders use the
// site's own files at each tag with no server; no game footage is shown.
export const kailleraMilestones: Milestone[] = [
  {
    id: 'kaillera-next-first-playable', day: '2026-03-19',
    title: 'Playable in two days',
    summary: 'Kaillera was a big part of my childhood and teenage years. It’s what introduced me to programming and made me want to learn. I always dreamed it could be more than it was, but never had the skills to build that, until now. The goal: open a link and play N64 games with friends, nothing to install. In two days, Claude Code and I had a first version that runs the game in lockstep, directly between browsers.',
    backfilled: true,
    artifacts: [artifact(prototype, 'Kaillera Next · v0.1.0 prototype', 'The first prototype page, rendered from the v0.1.0 files without a server.', 'Page render')],
  },
  {
    id: 'kaillera-next-streaming-mode', day: '2026-03-24',
    title: 'A second way to play',
    summary: 'The host runs the game and streams it as video, and guests send back their controller input. With only one copy of the game running, it can’t fall out of sync. Phone guests get an on-screen N64 gamepad.',
    backfilled: true,
  },
  {
    id: 'kaillera-next-staying-in-sync', day: '2026-03-25',
    title: 'Staying in sync',
    summary: 'Lockstep only works if every browser computes the exact same game. An iPhone kept drifting out of sync about every 25 seconds. The cause was a compiler setting that let math come out slightly differently between browsers. Claude Code rebuilt the emulator with strict math, shipped March 25, and the game resyncs players when they drift.',
    backfilled: true,
    artifacts: [artifact(syncDiagram, 'Kaillera Next · Staying in sync', 'The symptom, the cause, the fix, and the resync safety net.', 'Diagram')],
  },
  {
    id: 'kaillera-next-easier-start', day: '2026-03-24',
    title: 'Easier to start',
    summary: 'Getting into a game got quicker. With both players opting in, the host can send their game file straight to a friend; the server only connects them and never touches the file. Invite links choose play or watch, and a phone that switches apps pauses instead of breaking the match.',
    backfilled: true,
    artifacts: [artifact(lobbyDesktop, 'Kaillera Next · Lobby', 'Create a room, or join or watch with a room code or invite link. Rendered from the v0.8.0 files without a server.', 'Page render')],
  },
  {
    id: 'kaillera-next-alpha-launch', day: '2026-03-28',
    title: 'Ready for other players',
    summary: 'Security hardening, every script served from the site itself so it works on iPhone, rooms that survive a server update, and a version badge with a changelog. Tagged v0.8.0 on March 28, credited to my Agent 21 handle.',
    backfilled: true,
    artifacts: [artifact(lobbyPhone, 'Kaillera Next · v0.8.0 on a phone', 'The v0.8.0 lobby at phone width, with the version badge. Rendered from the tagged files without a server.', 'Page render')],
  },
  {
    id: 'kaillera-next-seeing-problems', day: '2026-04-11',
    title: 'Seeing what players hit',
    summary: 'I wanted to know when something broke without waiting for someone to tell me. Players can send feedback from any page, every session’s log is saved however it ends, and an admin timeline shows each match step by step. I pushed it to start from one player’s session, because real reports start there.',
    backfilled: true,
  },
  {
    id: 'kaillera-next-phone-controls', day: '2026-04-13',
    title: 'Phones as real controllers',
    summary: 'An on-screen N64 gamepad that fits every screen, and an invite button that opens the phone’s share sheet instead of making you leave the page. Version 0.21.0, “Agent’s Version”, also added an About page with the project’s history.',
    backfilled: true,
    artifacts: [artifact(gamepad, 'Kaillera Next · On-screen gamepad', 'The gamepad test page at iPhone size, with a placeholder where the game appears.', 'Test page render')],
  },
  {
    id: 'kaillera-next-rom-library', day: '2026-04-02',
    title: 'A library of your games',
    summary: 'Your browser now keeps your games instead of forgetting the last one, and marks known-good copies as verified. When you join a friend, it finds their game in your library automatically. The server only knows fingerprints of known games, never the files.',
    backfilled: true,
  },
  {
    id: 'kaillera-next-bit-exact', day: '2026-04-10',
    title: 'Identical bits',
    summary: 'Close wasn’t enough: a Mac and an iPhone had to compute identical bits. I noticed the game stayed in sync with audio off and drifted with it on, which led to one piece of float math in the audio timer. Claude Code then moved the emulated N64’s math into software, and 176,870 operations matched exactly between the two browsers.',
    backfilled: true,
    artifacts: [artifact(bitsDiagram, 'Kaillera Next · Identical bits', 'The three causes fixed in April and the recorded verification.', 'Diagram')],
  },
  {
    id: 'kaillera-next-four-players', day: '2026-04-09',
    title: 'Four players who agree',
    summary: 'Four-player games needed everyone to agree who was playing on every frame. The host now decides and everyone follows, fast players slow down smoothly instead of stuttering, and iPhone connections that silently stop are replaced.',
    backfilled: true,
  },
  {
    id: 'kaillera-next-rollback', day: '2026-04-13',
    title: 'Rollback',
    summary: 'Fighting games feel best with rollback: guess a late input, keep playing, and rewind if the guess was wrong. Doing that in JavaScript fell out of sync across devices, so Claude Code moved the whole loop into the emulator’s C code, then hardened it against the freezes and silent failures that playtests turned up.',
    backfilled: true,
    artifacts: [artifact(rollbackDiagram, 'Kaillera Next · Rollback', 'One tick of the rollback engine in C.', 'Diagram')],
  },
];
