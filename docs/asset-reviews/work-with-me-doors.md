# Asset: work-with-me doors

- Purpose and placement: the three "Work with me" doors on Home and on the `/services` hub. Each picture is evidence of real work a visitor can verify, not decoration: a released record, this live site, a public demo. No new imagery was generated; each file is a crop of an existing public capture or artwork.
- Reviewer: Claude Code agent, September 26, 2026; the website picture refreshed and re-inspected September 27, 2026. This is agent QA, not owner acceptance of the implemented page. The owner chose the "real work, one image each" treatment and these three subjects on September 26, 2026, from rendered previews, and asked for the website picture to be refreshed after the motion release on September 27, 2026. The website picture's new `/services` row placement was inspected October 19, 2026, by the Claude Code agent (pull request 188).
- Sources:
  - `work-with-me-mixing.webp`: the Old News single artwork already published at `/music/old-news` (`public/music/old-news-single-0db5fc05dca4ee79.webp`, 1254 × 1254), cropped to the 1254 × 836 band from 250 px down so the masthead and the skyline fill a 3:2 frame. The release's public credits give the owner vocals, recording, mixing and mastering, and credit the beat production and instrumental mix to its producer. In two-track work the engineer mixes the vocal into the finished beat, so "mixed" is the accurate word for the owner's part, and the caption says what the credits say.
  - `work-with-me-website.webp`: this site's Home as released on September 27, 2026, from CI's capture of pull request 132's final head `1e77513`, whose tree is identical to `main` at `10945a2` (`screenshots` branch, `pr-132/1e77513/home-desktop.png`, 1280 × 3795 full page, real web fonts, reduced motion so the hero shows its resting frame), top 1280 × 853. It showed, as of September 27, the header, hero copy and single hero link, the notepad trail, and the Work with me strip, so the door did not contradict Home as released then. Home's hero has changed since (see Outcome). It replaces the September 26 crop of `pr-122/715b072`, which still showed the earlier hero subtitle and a second hero link.
  - `work-with-me-software.webp`: Tally's Home screen from the public tally repository's `screenshots` branch (pull request 75, head `322167d`, `home-desktop.png`, 1280 × 1179), the 1254 × 836 band from 13 px in, so the frame ends just under the Eating Out bar. Demo data only: the "Demo data. Nothing here is real." banner is in frame. No address bar, console or terminal text.
- Native-resolution inspection (900 × 600): pass. Each crop keeps its subject whole (the masthead and skyline; the name, tagline, desk scene with its notepad trail, and the Work with me heading; the Tally sidebar, safe-to-spend figure and two budget bars) with no cut-off text along the edges of the subject. The website crop's bottom edge runs through the tops of the three door pictures in the Home strip: corrected October 19, 2026, the nested "OLD NEWS" masthead and "Kazon" heading are legible and cut mid-letter, and the nested Tally header is partly legible (the September record called the nested artwork not legible). The Tally capture shows a fictional household and no real account, person or amount.
- Delivery: WebP quality 80, 900 × 600 each; 133,168, 39,944 and 24,748 bytes. The doors render at most 370 px wide on desktop and 104 px wide on the phone, so 900 px covers a 2× display. CSS shows each at 3:2 with `object-fit: cover`, anchored to the top; the files are already 3:2, so nothing is cropped at runtime.
- Page inspection: pass at 1280 px desktop and 390 px phone in the development preview (see the pull request's captures). Pictures stay separate from copy and buttons and sit on a hairline rule with a paper-toned background. `work-with-me-website.webp` also renders as a 138 × 90 row thumbnail on Building's Personal website row (page introductions PR, September 26), the same file identifying the same project; inspected at 1280 px desktop and 390 px phone with no additional crop. The refreshed website picture was re-inspected on September 27 in the development preview at 2x: the Home door (345 × 229 on desktop, 102 × 67 on the phone), the `/services` hub (301 × 200) and Building's row (138 × 90). It read as the current Home at each of those sizes (device pixel ratio 2). Re-inspected October 19, 2026, by the Claude Code agent in CI's 1× captures of head `7881963` (Home door about 345 × 229, hub door 301 × 200) and in downscales of the delivered file: at 138 × 90 and above, the bottom edge cuts the nested "OLD NEWS" masthead and "Kazon" heading mid-letter, as at native resolution.
- Website row placement, October 19, 2026 (pull request 188): `work-with-me-website.webp` also renders in the Website design row of `/services`, at about 464 × 309 on a 1280 px desktop and 324 × 216 on a 390 px phone, with `width: 100%; height: auto` (no runtime crop), inside the existing hairline frame, captioned "This site, redesigned September 2026". There it has alternative text, "This site’s Home page, with the Work with me doors below", and is not a link. 900 px covers about 1.9× at the desktop size. Page inspection by the Claude Code agent (not the owner) in CI's 1× captures of head `7881963` (`services-desktop.png`, `services-phone.png`; the services layout, data and assets are unchanged through `cf0f6ac`): pass at 1280 px and 390 px. The header, hero and "Work with me" heading are whole, and the picture stays separate from the row's copy and button. As at every size, the bottom edge cuts the nested "OLD NEWS" masthead and "Kazon" heading mid-letter at both 464 × 309 and 324 × 216. The 1.9× figure (900 px over 464 px) is calculated; the 1× captures cannot show 2× sharpness. The picture shows Home as released on September 27; Home's introduction and button have changed since, so it reads as an earlier Home rather than the current one. The main subject (header, hero and heading) is whole, so the Claude Code agent judges the cut through the nested door artwork non-blocking. Refreshing or recropping the capture is the owner's call; the file and its hash are unchanged.
- Accessibility and motion: empty alternative text; the visible caption, title, line and button beside each picture carry the meaning, and the picture's own link is removed from the tab order so each door has one stop. Static images, lazy-loaded; no autoplay.
- Publication check: no private content, secrets, home address, real money or third-party logo. The Tally capture is demo data with its banner visible, per the publicist rules. No claim of production readiness is made on the doors; the captions say what each picture is.
- Outcome: ready for production asset use in the local prototype. Deployment is separate. Open (pull request 188): `work-with-me-website.webp` shows the September 27 Home on its Home door, `/services` hub door and Website design row. Its bottom edge cuts the nested "OLD NEWS" masthead and "Kazon" heading mid-letter, and Home's introduction and button have changed since. The Claude Code agent judges this non-blocking; whether to refresh or recrop it is the owner's decision (a recrop above the strip would drop the Work with me heading and the tops of the door pictures that the September 27 capture includes).

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/work-with-me-mixing.webp",
      "sha256": "5d50cd5116a39c58c8f44b0bb51a19396b38d107b1b7e88c74b1a2c4a4749c8e",
      "width": 900,
      "height": 600,
      "bytes": 133168
    },
    {
      "path": "src/assets/site/work-with-me-website.webp",
      "sha256": "8f422d1e45971cea42e34582da508a6a6114449e1226ba33fe8c98d7e3aebf87",
      "width": 900,
      "height": 600,
      "bytes": 39944
    },
    {
      "path": "src/assets/site/work-with-me-software.webp",
      "sha256": "d34b0e03e9d4af41fb448db0f33d8359edb95415f69cd025afe83805036c0259",
      "width": 900,
      "height": 600,
      "bytes": 24748
    }
  ]
}
```
