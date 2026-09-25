# Bluesky: setup, banner and profile

Status: the account is live at [@thesuperhuman.us](https://bsky.app/profile/thesuperhuman.us), verified
by the `_atproto` DNS record on 2026-09-25. The profile, bio and pinned post below are
the owner's to set by hand; posting stays manual until an autopost switch is approved.
Facts below come from search results checked 2026-09-23; Bluesky's own help pages
were not reachable from this environment, so confirm menu names as you go.

## Is it worth it as a reset?

Update, 2026-09-25: the owner decided to keep posting on X as well, so Bluesky is
added alongside it, not instead of it. The original reasoning follows for the record.

The first proposal was **replacing X, not adding a third network**: LinkedIn
(professional audience) plus Bluesky (developers and conversation), with X going
quiet.

What you gain:
- Your domain as your handle: **@thesuperhuman.us**. It is verified by a DNS record
  you control in Cloudflare, so it doubles as proof that the account is yours and
  ties every post back to the website.
- A chronological default feed and custom feeds, so posts are not competing with
  paid reach. Its users skew toward developers and writers who reply.
- Free, simple posting API with an app password, so later automation costs nothing
  (X charges about $0.20 per post that contains a link).
- A clean start under the direction you want now, without X's history.

What you give up: reach. Bluesky is small and its active use fell by about half from
its late-2024 peak (about 10 million monthly app users in mid-2026, per Sensor
Tower via TechCrunch). You start at zero followers. Treat it as a place for a
small number of good conversations, with LinkedIn carrying the professional reach.

## Setup walkthrough (about 20 minutes)

1. **Create the account** at bsky.app with a work email you check. Pick any
   temporary handle; step 3 replaces it.
2. **Profile basics.** Display name "Kazon Wilson". Avatar: the same portrait used
   on the site, square, face centered (Bluesky crops it to a circle; 400×400 or
   larger). Banner: [banner-draft.png](banner-draft.png) (3000×1000).
3. **Use your domain as the handle.** In Bluesky: Settings, Account, Handle,
   "I have my own domain". Enter `thesuperhuman.us`, choose the DNS option, and copy
   the value it shows (`did=did:plc:...`). In Cloudflare DNS for thesuperhuman.us,
   add a **TXT** record named `_atproto` with that value (DNS only, no proxy).
   Back in Bluesky, choose Verify. Propagation usually takes minutes.
   The record is public by design and contains no secret. This changes DNS for the
   site's domain, so it is your action to take; it touches no existing record.
4. **Bio** (proposal, 3 lines, 243 of Bluesky's 256 characters):
   > I build useful software with AI, grounded in 7+ years of production engineering (Lyft, insurance, healthcare).
   > Now: Tally (family budgeting) and kaillera-next (browser netplay for retro games).
   > Also mixing and mastering audio. thesuperhuman.us
   Routine posts keep one link, to the site (quality standard 8 in the design doc).
5. **Pinned post:** a short introduction with one link, the website.
   > I build useful software with AI, and I mix and master audio. I'm posting what I make and why: Tally, kaillera-next and more. Everything lives at thesuperhuman.us.

   Replace it with a strong project post later if you prefer. The Ko-fi plan is
   decided ([channels/ko-fi.md](../channels/ko-fi.md)), so append this line to the
   pinned post (not the bio, and not routine posts):
   > If the work is useful to you, you can support it on Ko-fi: ko-fi.com/kazonwilson
6. **Settings worth changing:** turn on two-factor sign-in by email; leave
   "adult content" off; set who can reply to "everyone" at first.
7. **Later, only for automated posting:** create an **app password** (Settings,
   Privacy and security, App passwords). It goes straight into the poster's secret
   store, never into chat, a PR or a file. Not needed during manual posting.
8. **On X:** keep posting (owner decision, 2026-09-25). Optionally add
   "Also on Bluesky: @thesuperhuman.us" to the X bio.

## Banner

[banner-draft.png](banner-draft.png), rendered from
[banner-draft.html](banner-draft.html) at 3000×1000. It uses the site's own
foundations: paper background, ink headline in Newsreader, muted Inter line,
a hairline rule and the terracotta accent for the address. All text sits inside the
central 60% so the avatar (which overlaps the bottom-left corner) and the tighter
mobile crop never cover it. No generated imagery, so there is nothing for image QA
to catch beyond checking it in the app on a phone.

Alternatives if you want more character: add a small row of line icons (laptop,
headphones, controller) from the site's existing illustration set under the rule,
or swap the headline for your name in the site's name typeface. Keep it text-first
either way; the profile already shows your name and avatar.

## Posting on Bluesky

Every post passes the quality standards in the
[design doc, section 8](../README.md#8-social-posts). On Bluesky specifically: no
hashtags, under 300 characters, and the link goes in the link card, so the text
can use the full length.
