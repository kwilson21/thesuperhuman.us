# Video standard

Every publicist video should be as easy to follow as the last one. That is the part
that stays consistent. The story, layout, visuals, motion and length change from
video to video; a video that looks like the previous one with new numbers is a
missed chance. This standard sets the bar for understandability, and the kit in
`scripts/publicist/video/` handles the mechanics and checks the parts a script can
check.

It adds to the channel playbooks (`channels/youtube.md` and the feed channels) and
never relaxes the publicist's hard rules. A video says no more than its approved
draft, and an unreleased video's outline, script and source stay in the private
repository under `videos/<entry-id>/`.

## Consistent: the understandability bar

1. **One message.** Write it as one or two plain sentences before anything else. Every
   scene must help a viewer who has never heard of the project reach it.
2. **An outline first.** One row per scene: the question the scene answers, its
   takeaway, the visual and the words on screen. Each scene's question should follow
   from the scene before. The owner reviews the outline before the first render.
3. **The headline is the takeaway.** Each scene has one headline of at most 7 words.
   Reading only the headlines, in order, should tell the whole story.
4. **Few words.** At most 14 words visible in a finished scene, headline included:
   labels the picture needs and nothing more. No caption sentences on screen. The
   full numbers and reasons belong in the post text that goes out with the video.
5. **Headline first.** The headline shows alone for at least half a second before
   anything else moves, so the viewer knows what to look for.
6. **One thing at a time, in reading order.** Build the picture left to right and top
   to bottom. Dim what has been read when the next part starts.
7. **Hold the finished frame.** At least 2 seconds, and 0.3 seconds per word on
   screen when that is longer.
8. **Explain the rule before the result.** If a result depends on a threshold, a
   definition or a constraint, a scene shows it before the scene that relies on it.
9. **One condition per scene, each subject once.** A scene compares things under one
   condition. If the same subject has a result under another condition (another
   setting, list size or version), that result gets its own scene with the condition
   as its headline, rather than a second row naming the same subject.
10. **Label examples.** A made-up example that explains how something works says
   "Example". Measured results never use made-up numbers.
11. **Numbers mean what they look like.** Don't show "out of N" unless every one of the
    N had a right answer; don't present a test as a ranking it wasn't.
12. **A steady frame.** No jumps in size or position except at a cut. Camera drift
    restarts only at scene changes.
13. **Nothing overlaps, nothing is cut off.** Text keeps clear of other text and 24
    pixels from the frame's edges.
14. **Sound is optional, and silent is the default.** Videos must work muted. Generated
    music and a sound effect for every on-screen event read as cheap; use sound only
    when the owner provides music or a voiceover (music rights per hard rule 12).
15. **Close with the honest scope and the credit.** What it was measured or built on,
    and the approved credit line.

## Free to change: everything else

Visual approach (diagram, bars, tiles, screen recording, before and after), layout,
color emphasis within the site palette, motion, pacing between the minimums, number
of scenes, length, orientation (16:9 or a vertical cut) and the opener. The opening
ink line from `channels/youtube.md` is the channel's signature; how it lands can
change.

## The kit

- `kit.js`: `VideoKit.run({ plan, draw })`. The plan lists each scene's `id` and
  `build` (seconds the picture takes to assemble), with optional `lead` (headline
  alone, default 0.6 s) and `hold` (default 2 s). `draw(id, t)` gets scene-local time,
  so each scene is written from 0. Also `prog`, `fade` and easing helpers.
- `kit.css`: the palette tokens, the corner tag and the headline role
  (`data-role="headline"`). Scenes add their own layout.
- `render.mjs`: injects the kit and the site's Libron font, checks the page and
  renders it. `--check` only checks; `--stills t1,t2` writes frames for a look
  (without the check); otherwise it checks, then writes an H.264 mp4 with no audio.
  It refuses to render a page that fails the check.
- `starter.html`: a three-scene example to copy into `videos/<entry-id>/` in the
  private repository.

```
node scripts/publicist/video/render.mjs <scene.html> --check
node scripts/publicist/video/render.mjs <scene.html> --stills 0.5,6,12
node scripts/publicist/video/render.mjs <scene.html> out.mp4
```

### What the check enforces

From the bar above: one headline per scene and at most 7 words in it; at most 14
words on screen; the headline readable alone for 0.5 s before other text; a hold of
at least 2 s (more for wordier scenes); no text overlapping other text; no text in
the outer 24 pixels; the font loaded. The limits live in `LIMITS` in `render.mjs`;
change them here and there together.

### What a person still checks

The one message, the outline, whether each scene's question leads to the next,
reading order, labelled examples, honest numbers and a steady frame. Look at stills
of every scene's finished frame, then the full render, before showing the owner.

## Review flow

1. Outline in the private repository, shown to the owner.
2. Stills of every scene, then the render, shown to the owner; fix and repeat.
3. The owner's approval and release follow `channels/youtube.md`.
4. After each video, add anything the owner's feedback taught to this standard, so
   the next video starts from it.
