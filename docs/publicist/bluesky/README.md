# Bluesky: setup, banner and profile

Proposal for owner review, 2026-09-23. Nothing here has been created or posted.
Facts below come from search results checked 2026-09-23; Bluesky's own help pages
were not reachable from this environment, so confirm menu names as you go.

## Is it worth it as a reset?

Yes, if the reset means **replacing X, not adding a third network.** The plan
becomes LinkedIn (professional audience) plus Bluesky (developers and conversation),
and X goes quiet: pin a final post pointing to Bluesky and the website, then stop
posting there.

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
   The Ko-fi page (ko-fi.com/kazonwilson) does not fit in the bio. It goes in the
   pinned post and in the website footer instead (see "Support (Ko-fi)" in the
   design doc). Routine posts keep one link, to the site (quality standard 8).
5. **Pinned post:** an introduction with two links: the website and Ko-fi.
   > I build useful software with AI, and I mix and master audio. I'm posting what I make and why: Tally, kaillera-next and more. Everything lives at thesuperhuman.us. If the work is useful to you, you can support it on Ko-fi: ko-fi.com/kazonwilson
   Replace it with a strong project post later if you prefer; keep Ko-fi in it.
6. **Settings worth changing:** turn on two-factor sign-in by email; leave
   "adult content" off; set who can reply to "everyone" at first.
7. **Later, only for automated posting:** create an **app password** (Settings,
   Privacy and security, App passwords). It goes straight into the poster's secret
   store, never into chat, a PR or a file. Not needed during manual posting.
8. **On X:** a final pinned post: "I'm posting about my work on Bluesky now:
   @thesuperhuman.us. Everything lives at thesuperhuman.us." Then stop posting.
   Deleting the account is optional and not recommended; it keeps the handle.

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

## Post quality standards (all platforms)

A post goes in the queue only if it passes every check:

1. **One idea.** One outcome, decision or lesson per post. If it needs "and also",
   it is two posts or a journal entry.
2. **Leads with the point.** The first line makes sense on its own in a feed:
   the outcome, the problem, or a concrete detail. No "Excited to share", no
   "Thread", no rhetorical questions.
3. **Concrete.** Names the real thing: the screen, the number, the bug, the rule.
   Every factual claim traces to the journal entry, and a post never says more
   than its entry, which rests only on verified review-note answers.
4. **Says why.** Includes the reason or the decision, not only what shipped.
5. **Honest status.** "Built, not live yet" when that is true. No implied launches,
   users or results that are not recorded.
6. **Plain voice.** Your site's voice: first person, direct, no buzzwords
   (passionate, innovative, game-changer), no em dashes, no hype emoji, at most one
   emoji and usually none. Hashtags: none on Bluesky, at most two on LinkedIn.
7. **One visual when it helps.** A real capture labeled as demo data, a labeled
   concept or a clean diagram, with alt text that describes what is on screen.
   Never a screenshot containing real data, secrets, notifications or browser
   chrome with private tabs.
8. **One link, to the site.** The journal entry on thesuperhuman.us, not the repo,
   unless the post is about the code itself. On Bluesky the link goes in the link
   card, so the text can use the full 300 characters.
9. **Fits the platform.** LinkedIn: 80 to 180 words, short paragraphs, the story
   version. Bluesky: under 300 characters, one idea, conversational. Never the same
   text pasted to both.
10. **AI stated plainly** when it is relevant ("Built with Claude Code"), as a
    fact about how you work, not a disclaimer or a boast.
11. **Would you reply to comments on it?** If a post would invite a conversation
    you do not want to have, it does not go out.
12. **Read aloud once.** If it sounds like marketing, rewrite it or drop it.
