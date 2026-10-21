# Asset: link previews

- Purpose and placement: each page's link preview. The poster PNG is `og:image`;
  the MP4 is `og:video`, which Apple Messages plays looped and muted in place of
  the poster. Other apps show the poster. Scenes are HTML compositions in
  `scripts/og-video/scenes/`, rendered by `scripts/og-video/render.mjs` (see
  README, "Link previews").
- Final files: listed with dimensions, bytes and SHA-256 in the JSON record below.
  Every poster is 1200 × 630 PNG; every video is 1200 × 630 H.264 High, yuv420p,
  BT.709, 30 fps, silent, with the index (`moov`) before the media data.
- Reference basis and reuse: only existing reviewed site artwork
  (`src/assets/site/*`), the site's fonts and native HTML/SVG shapes and type. No
  new generated objects or raster edits. Silent, so no music rights are involved.
- Reviewer and date: Claude Code agent visual review, October 21, 2026. Not human
  production approval.
- Automatic checks on every render: fonts loaded, nothing overflows the frame, the
  last frame matches the first (no jump at the loop), video under 2.5 MB, poster
  under 600 KB.
- Device check: unverified. Messages playback, Discord and the Facebook and
  LinkedIn debuggers need the deployed site; see the README's post-deploy checks.

## home

- Placement: `/` and every page without a scene of its own.
- Composition: the retired social card's layout and studio-v1 artwork with the
  home page's approved copy: the tagline "Software, sound, and things worth
  exploring." (`src/components/Hero.astro`) and the introduction "I build
  software, design websites, and mix and master music." It replaces the card's
  superseded "Software engineer. Building with AI."
- Motion: the home page's StudioLife layer, in the artwork's own coordinates and
  inside its mask: the monitor's last four code rows are hidden by screen-coloured
  blocks and re-typed behind a caret, three rings leave the headphones, and the
  notebook sketch fades and redraws before its sun returns. Everything rests by
  4 s; the last 2 s hold the poster frame.
- Detail inspection: pass. Poster inspected at native size; twelve frames from
  0 to 5.5 s inspected on a contact sheet; encoded frames at 0 s and 1.9 s
  compared with the source. Type rows stay registered on the monitor's existing
  rows, rings stay centred on the headphones, and the sketch stays on the
  notebook. The artwork's soft mask leaves a faint rounded edge on the paper,
  present in the source frame and the retired card; the encoder settings
  (`-tune animation`, `aq-mode=3`, CRF 20) keep it from banding further.
- Physical logic: pass. No new objects or connections; the sketch is drawn on the
  notebook page.
- Accessibility: the poster's alt text is in `src/lib/og-media.ts` and states the
  name, the introduction and the desk objects.
- Outcome: ready for production.

```json
{
  "outcome": "ready for production",
  "files": [
    { "path": "public/og/home-512dc0dcad.png", "sha256": "512dc0dcad3a1fbecbbcc6d1341de98848916f52fe07cb11f6d862b27769becd", "width": 1200, "height": 630, "bytes": 377184 },
    { "path": "public/og/raw/home-16874210af.mp4", "sha256": "16874210afc42bb2d90846a73948f41ff2b9b2645a25d43bf1dee7416022d342", "width": 1200, "height": 630, "bytes": 269508 }
  ]
}
```
