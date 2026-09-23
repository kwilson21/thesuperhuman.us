# Sample entry: Kaillera-next C-level rollback (backfill)

Source: `docs/superpowers/specs/2026-04-06-c-level-rollback-design.md`,
`docs/superpowers/plans/2026-04-06-c-level-rollback.md`, release v0.34.0
(2026-04-06), and the current README's description of the rollback engine.
Dated to the work (April 6, 2026), labeled as backfill.

## As it would appear on /building/kaillera-next

*[Illustration to be drawn: one tick of the game loop. The browser hands inputs to
the emulator; inside the emulator, save, guess, run, and rewind and replay when a
guess was wrong, with no browser work between replayed frames. Labeled
"Illustration", following image QA.]*

**Netcode · Built · Added to the journal later**

### Move the rewind inside the emulator.

Rollback netplay hides lag by guessing a friend's next button press and quietly
rewinding when the guess is wrong. Doing that rewind from JavaScript let a phone
and a desktop drift apart even with identical inputs, so I moved it into the
emulator's own C code.

**Why this was the fix**

Plain lockstep, which never guesses, had run for more than 30 minutes without a
desync. That showed the emulation itself was deterministic. The drift came from the
browser between replayed frames: callbacks, audio timing and animation scheduling.
The new engine keeps a ring of saved states inside the emulator and replays missed
frames in one tight loop, with nothing from the browser in between. Lockstep stayed
as the fallback. Later releases hardened this engine through determinism and
state-integrity audits.

[Design](https://github.com/kwilson21/kaillera-next/blob/main/docs/superpowers/specs/2026-04-06-c-level-rollback-design.md) ·
[Play online](https://kaillera-next.thesuperhuman.us)

## As data (`src/data/project-stories/kaillera-next.ts`)

```ts
{
  id: 'kaillera-next-c-level-rollback', day: '2026-04-06', backfilled: true,
  title: 'Move the rewind inside the emulator.', status: 'Netcode · Built',
  summary: 'Rollback netplay hides lag by guessing a friend’s next button press and quietly rewinding when the guess is wrong. Doing that rewind from JavaScript let a phone and a desktop drift apart even with identical inputs, so I moved it into the emulator’s own C code.',
  detailLabel: 'Why this was the fix',
  detail: 'Plain lockstep, which never guesses, had run for more than 30 minutes without a desync. That showed the emulation itself was deterministic. The drift came from the browser between replayed frames: callbacks, audio timing and animation scheduling. The new engine keeps a ring of saved states inside the emulator and replays missed frames in one tight loop, with nothing from the browser in between. Lockstep stayed as the fallback. Later releases hardened this engine through determinism and state-integrity audits.',
  artifacts: [/* rollback-tick.svg, kind: 'Illustration' */],
  links: [
    { label: 'Design', href: 'https://github.com/kwilson21/kaillera-next/blob/main/docs/superpowers/specs/2026-04-06-c-level-rollback-design.md' },
    { label: 'Play online', href: 'https://kaillera-next.thesuperhuman.us' },
  ],
}
```

## Review notes for the owner

- Every claim comes from the spec's Problem and Solution sections and the README.
  "Built" is supported by the v0.34.0 release the same day; the build would also
  confirm the commits before publishing.
- No gameplay image: the game is a commercial title. A diagram explains the idea
  better anyway.
- If the conversation exports show why rollback mattered to you (for example,
  playing with friends on phones), that becomes the first sentence instead.
