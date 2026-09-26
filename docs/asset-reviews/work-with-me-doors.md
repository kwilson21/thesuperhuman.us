# Asset: work-with-me doors

- Purpose and placement: the three "Work with me" doors on Home and on the `/services` hub. Each picture is evidence of real work a visitor can verify, not decoration: a released record, this live site, a public demo. No new imagery was generated; each file is a crop of an existing public capture or artwork.
- Reviewer: Claude Code agent, September 26, 2026. This is agent QA, not owner acceptance of the implemented page. The owner chose the "real work, one image each" treatment and these three subjects on September 26, 2026, from rendered previews.
- Sources:
  - `work-with-me-mixing.webp`: the Old News single artwork already published at `/music/old-news` (`public/music/old-news-single-0db5fc05dca4ee79.webp`, 1254 × 1254), cropped to the 1254 × 836 band from 250 px down so the masthead and the skyline fill a 3:2 frame. The release's public credits give the owner vocals, recording, vocal mixing and mastering, and credit the beat production and instrumental mix to its producer, so the caption claims only the vocal mix and master.
  - `work-with-me-website.webp`: this site's redesigned Home, the existing project asset `src/assets/projects/website/home-after.png` (1440 × 1000), top 1440 × 960.
  - `work-with-me-software.webp`: Tally's Home screen from the public tally repository's `screenshots` branch (pull request 75, head `322167d`, `home-desktop.png`, 1280 × 1179), top 1280 × 853. Demo data only: the "Demo data. Nothing here is real." banner is in frame. No address bar, console or terminal text.
- Native-resolution inspection: pass. Each crop keeps its subject whole (the masthead and skyline; the name, tagline and desk scene; the Tally sidebar, safe-to-spend figure and budget bars). The Tally crop ends mid-list below the Eating Out bar, as a capture of a longer page does; the clipped "over budget" label under that bar is not legible at door size. The Tally capture shows a fictional household and no real account, person or amount.
- Delivery: WebP quality 80, 900 × 600 each; 133,168, 37,118 and 24,670 bytes. The doors render at most 370 px wide on desktop and 104 px wide on the phone, so 900 px covers a 2× display. CSS shows each at 3:2 with `object-fit: cover`, anchored to the top; the files are already 3:2, so nothing is cropped at runtime.
- Page inspection: pass at 1280 px desktop and 390 px phone in the development preview (see the pull request's captures). Pictures stay separate from copy and buttons and sit on a hairline rule with a paper-toned background.
- Accessibility and motion: empty alternative text; the visible caption, title, line and button beside each picture carry the meaning, and the picture's own link is removed from the tab order so each door has one stop. Static images, lazy-loaded; no autoplay.
- Publication check: no private content, secrets, home address, real money or third-party logo. The Tally capture is demo data with its banner visible, per the publicist rules. No claim of production readiness is made on the doors; the captions say what each picture is.
- Outcome: ready for production asset use in the local prototype. Deployment is separate.

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
      "sha256": "bdb7c63495bd9987d734424846ad1d99a602d0fdfa7249b90880e868758e5649",
      "width": 900,
      "height": 600,
      "bytes": 37118
    },
    {
      "path": "src/assets/site/work-with-me-software.webp",
      "sha256": "ab35150a7128335a9bb1097428c8808fd7c6b459dec5d04c7dd7e005e26990e6",
      "width": 900,
      "height": 600,
      "bytes": 24670
    }
  ]
}
```
