# YouTube: one channel for software and music

Status: later phase, proposal for owner review. Nothing is created or uploaded.
The core publicist (journal, review gate, feed posts) runs first; YouTube starts
after a few approved batches.

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
  show and say only what its verified answers support, like any post.
- **Sound videos and releases** use a release note instead (see
  [the template](../review-note-template.md)): credits, the right to publish the
  recording and any samples or beats on YouTube, where it is already distributed,
  and whether YouTube's automatic copyright matching (Content ID) is expected to
  claim it. A release video is held until rights are verified.
- The public review PR carries each video's script, captions (`.srt`), title,
  description with chapters, tags, thumbnail and playlist. Rendered video files are
  stored outside this repository (for example in R2, like the site's audio), with a
  preview link in the PR.
- Merging approves the batch. The owner then uploads in YouTube Studio from the
  prepared checklist.

## Publishing mechanics

- **Upload by hand at first.** The YouTube Data API can upload, but videos from an
  app that has not passed Google's compliance audit are locked to private, and the
  default quota allows about six uploads a day. Manual upload in YouTube Studio
  costs the owner a few minutes per video. Revisit the audit only if volume grows.
  Sources: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
  [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).
- **Pipeline (proposal):** videos built from code with Remotion (videos written as
  React components), using the Playwright recordings the design already produces,
  finished with ffmpeg. Each video's source lives in this repository, so a style
  change is one reviewed diff.
- **Cadence:** at most one video a week, plus releases when they happen. The feed
  post announcing a video counts toward the daily feed limit.

## Questions for the owner

1. What do you like about DevDan's style: pacing, on-screen code, voiceover,
   captions, length, the hook?
2. Old News is credited "Prod. Lexi Banks". Does the beat license allow a YouTube
   upload, and is the song already distributed so that Content ID may claim it?
3. Your voice, or captions and music only?
4. Channel name and handle: your name (matching the site), or something else?
