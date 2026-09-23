# YouTube: one channel for software and music

Status: later phase, proposal for owner review. Nothing is created or uploaded.
The core publicist (journal, review gate, feed posts) runs first; YouTube starts
after a few approved batches.

## The channel

The channel already exists: https://www.youtube.com/@KazonTheOne. Keep it; do not
open a separate thesuperhuman.us channel. The owner is the face of the brand, the
website is where the work lives, and The Superhuman Group LLC is the legal entity
behind it, not a separate audience. A second channel would split a starting
audience in two and double the upkeep. The site is tied in through the banner and
the channel links instead.

- **Handle:** keep `@KazonTheOne`. Changing it breaks existing links, and the old
  handle is released to anyone once dropped.
- **Display name:** "Kazon Wilson" to match the site, LinkedIn and Bluesky, or
  "Kazon" to match the artist credit on releases. An owner decision; the handle
  stays either way.

## Redesign checklist (owner applies in YouTube Studio)

YouTube is blocked from this environment, so the channel's current state has not
been seen. The owner lists the existing videos and what each is; the publicist then
proposes keep, move to a playlist, or unlist for each.

1. **Banner:** [youtube/banner-draft.png](youtube/banner-draft.png), rendered from
   [banner-draft.html](youtube/banner-draft.html) at 2560×1440. It shows the
   channel's signature: one ink line that ends in code on the Build side and in a
   waveform on the Sound side. All text and the motif sit inside the central
   1546×423 area that every device shows; the rest is plain paper, so TV, desktop
   and phone crops all read cleanly.
2. **Avatar:** the same portrait as the site and Bluesky, face centered.
3. **Description** (proposal):
   > I build useful software with AI and make music. Build videos show what I made,
   > why, and how it works. Sound videos are releases and notes on how a mix or
   > master came together. Everything lives at thesuperhuman.us.
4. **Links:** thesuperhuman.us first, then Bluesky (or X), LinkedIn and GitHub.
   Ko-fi joins once its plan exists ([ko-fi.md](ko-fi.md)).
5. **Home page sections:** Build playlist, Sound playlist, latest release. A channel
   trailer can come later from the first good Build and Sound videos.
6. **Playlists:** Build: Tally · Build: kaillera-next · Build: the website ·
   Sound: releases · Sound: mix and master notes.

## One channel, two strands

One channel under the owner's name, because the owner is the common thread: someone
who builds software and makes music, and whose work sometimes joins the two. Two
clearly labeled strands keep it easy to follow:

| Strand | What goes there | Playlists |
| --- | --- | --- |
| **Build** | Software: what was built, why, and how it works | One per project (Tally, kaillera-next, the website) |
| **Sound** | Music: releases, and how a mix or master came together | Releases; Mix and master notes |

Viewers who only want one side can follow a playlist. The channel home page shows
the newest video from each strand side by side.

The two strands meet in the work itself. The website's A/B player, which lets
listeners switch between the earlier version of Old News and the final master, is
software built for music. It makes a good first video that belongs to both strands,
and it shows why they share a channel.

## Formats

1. **Build notes** (60 to 90 seconds, vertical Short plus a 16:9 cut). Open on the
   "why" in large type, show the thing working on real demo data, end on one
   takeaway line. One per strong journal entry, not per PR.
2. **Release videos** (full length). The song with a visualizer or lyric video in
   the channel style, linking to its release page on thesuperhuman.us.
3. **Sound notes** (60 to 90 seconds). A before and after of the mix or master
   with a short explanation, using clips the owner has the right to publish.
4. **Deep dives** (5 to 10 minutes, occasional). A full story such as moving
   kaillera-next's rollback into the emulator, when a topic earns the length.

## A style of our own

Proposed signature, to replace or refine once the owner describes what they like
about DevDan's videos (YouTube is blocked from this environment, so that video has
not been watched):

- **The line.** Every video opens with one hand-drawn ink line crossing a paper
  background. In Build videos it settles into a line of code or a cursor; in Sound
  videos it becomes a waveform. One motif, two endings, about a second long. It
  says "same maker, different medium" without a word.
- **Look:** the site's paper, ink and terracotta palette, Newsreader for headlines,
  Inter for captions. A small strand tag ("Build" or "Sound") in the corner.
- **Real footage only:** screen recordings on demo data, captures of the actual
  audio tools with no client material, labeled diagrams. No generated footage
  presented as the product.
- **Sound:** music beds the owner produces and mixes. Few developer channels can do
  that, and it avoids licensing problems with other people's music.
- **Captions always burned in**, written from the script, so the videos work muted
  in a feed.
- **Voice:** the owner's voiceover or captions and music only; an owner decision.
  No synthetic voice presented as the owner.

## Review gate and approval

- **Build videos** use the normal review note for the change they cover. A video may
  show and say only what its verified Refresher supports, like any post.
- **Sound videos and releases** use a release note instead (see
  [the template](../review-note-template.md)): credits, the right to publish the
  recording and any samples or beats on YouTube, where it is already distributed,
  and whether YouTube's automatic copyright matching (Content ID) is expected to
  claim it. A release video is held until rights are verified.
- **Private until the video is public.** Nothing about an unreleased video enters
  this public repository or a public PR: not its script, captions, title,
  description, thumbnail or a preview link. The flow:
  1. **Private review.** The publicist opens a PR in the private repository
     (`kwilson21/publicist-private`, under `videos/<entry-id>/`) with the script,
     captions (`.srt`), title, description with chapters, tags, thumbnail and
     playlist. The rendered video goes to a private storage bucket with no public
     access (for example a private R2 bucket). The private PR links it only through
     a signed URL that expires within 7 days, and a fresh one is issued on request.
  2. **Owner approval.** The owner watches the preview, edits the materials in the
     private PR and merges it. That merge is the explicit approval to publish the
     video.
  3. **Upload.** The owner uploads in YouTube Studio from the approved checklist,
     publishing immediately or scheduling a premiere.
  4. **Public follow-up.** Only after the video is public does the publicist open
     the usual public PR: the website entry that embeds or links it and the feed
     posts announcing it, all through the normal gate.
- Build videos about already-published journal entries follow the same order. The
  entry may be public already, but the video is not until the owner releases it.

## Publishing mechanics

- **Upload by hand at first.** The YouTube Data API can upload, but videos from an
  app that has not passed Google's compliance audit are locked to private, and the
  default quota allows about six uploads a day. Manual upload in YouTube Studio
  costs the owner a few minutes per video. Revisit the audit only if volume grows.
  Sources: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
  [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).
- **Pipeline (proposal):** videos built from code with Remotion (videos written as
  React components), using the Playwright recordings the design already produces,
  finished with ffmpeg. The shared style (templates, the opening line, typography)
  lives in this repository, so a style change is one reviewed diff. Each video's
  own content (script, captions, footage) stays in the private repository until
  the video is public.
- **Cadence:** at most one video a week, plus releases when they happen. The feed
  post announcing a video counts toward the daily feed limit.

## Questions for the owner

1. What do you like about DevDan's style: pacing, on-screen code, voiceover,
   captions, length, the hook?
2. Old News is credited "Prod. Lexi Banks". Does the beat license allow a YouTube
   upload, and is the song already distributed so that Content ID may claim it?
3. Your voice, or captions and music only?
4. Display name: "Kazon Wilson" or "Kazon"?
5. What is on the channel today, so each existing video can be kept, moved to a
   playlist or unlisted?
