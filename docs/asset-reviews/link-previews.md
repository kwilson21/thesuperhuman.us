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
- Re-rendered after the kit gave `.frame` an explicit paper background, which the
  artwork's multiply now blends against; poster re-inspected at native size, no
  visible change.
- Outcome: ready for production.

## services

- Placement: `/services`.
- Composition: the Work with me hub's three doors (`src/components/WorkWithMe.astro`)
  with their reviewed artwork (`src/assets/site/work-with-me-*.webp`, recorded in
  `work-with-me-doors.md`) and the page's own copy (`src/layouts/ServiceSheet.astro`,
  `src/data/work-with-me.ts`, `src/data/services.ts`). The only prices shown are the
  approved audio starting prices the page itself shows.
- Motion: each door takes focus for 2 s while the others dim. Mixing plays the Old
  News master waveform (`src/content/audio-examples/old-news-mastering.json`) across
  its cover, the way the comparison player fills; Website design zooms into the real
  screenshot and rings its Start a project button; Software engineering zooms into
  the Tally demo with its "Demo data" banner kept in frame and rings Safe to spend.
- Detail inspection: pass. Poster at native size and twelve frames on a contact
  sheet. Rings sit on the button and the figure they mark; the zooms keep their
  subjects in frame; every line fits inside the frame.
- Physical logic: not applicable (screenshots and type; no drawn objects).
- Outcome: ready for production.

## software-start

- Placement: `/software/start`.
- Composition: the project brief drawn in HTML at video scale, with the page's own
  heading, choices, descriptions, questions and example answers
  (`src/pages/software/start.astro`, `src/lib/software-inquiry.ts`,
  `src/scripts/software-inquiry.ts`). No images.
- Motion: each path is chosen in turn; its card opens to its first question and the
  form's own example answer appears line by line, while the step dots and the brief
  name change as they do on the page. The page returns to its first step at the end.
- Detail inspection: pass. Poster at native size and twelve frames on a contact
  sheet. Card heights keep the column inside the frame; the example answers are the
  form's placeholders, shown in placeholder grey, not presented as real requests.
- Physical logic: not applicable.
- Outcome: ready for production.

```json
{
  "outcome": "ready for production",
  "files": [
    {"path": "public/og/home-257eb55b39.png", "sha256": "257eb55b39108da97c5c5c5ba0368d9e3ccd7dd6f5cfc8ef71fff070be342d53", "width": 1200, "height": 630, "bytes": 373273},
    {"path": "public/og/services-75a539dbee.png", "sha256": "75a539dbeec538a9e6bcd44d2a17fe225aa43b58edfd997a19fa6b1940cab492", "width": 1200, "height": 630, "bytes": 344075},
    {"path": "public/og/software-start-ca3244d4c1.png", "sha256": "ca3244d4c1805324ce58f03da51973ea7978e7b3068ee2ecb7f5b2927546521f", "width": 1200, "height": 630, "bytes": 192409},
    {"path": "public/og/raw/home-c1231bc166.mp4", "sha256": "c1231bc166d34e859b066c8554bdcb69cc02ef33eff8c976012579c5ae091041", "width": 1200, "height": 630, "bytes": 267334},
    {"path": "public/og/raw/services-afd37a3254.mp4", "sha256": "afd37a3254c286617427f7b4a8c4e0399e8950734ca034d734c6ee9521a535a3", "width": 1200, "height": 630, "bytes": 760167},
    {"path": "public/og/raw/software-start-65d389073b.mp4", "sha256": "65d389073bcec0b0e7ac5c3e6d42abd54be1eb5362bddb672970dbca1721b2d6", "width": 1200, "height": 630, "bytes": 471341}
  ]
}
```
