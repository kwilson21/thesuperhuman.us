# Asset: work-with-me doors

- Purpose and placement: the three "Work with me" doors on Home and on the `/services` hub. Each picture is evidence of real work a visitor can verify, not decoration: a released record, this live site, a public demo. No new imagery was generated; each file is a crop of an existing public capture or artwork.
- Reviewer: Claude Code agent, September 26, 2026. This is agent QA, not owner acceptance of the implemented page. The owner chose the "real work, one image each" treatment and these three subjects on September 26, 2026, from rendered previews.
- Sources:
  - `work-with-me-mixing.webp`: the Old News single artwork already published at `/music/old-news` (`public/music/old-news-single-0db5fc05dca4ee79.webp`, 1254 × 1254), cropped to the 1254 × 836 band from 250 px down so the masthead and the skyline fill a 3:2 frame. The release's public credits give the owner vocals, recording, vocal mixing and mastering, and credit the beat production and instrumental mix to its producer, so the caption claims only the vocal mix and master.
  - `work-with-me-website.webp`: this site's Home as this pull request leaves it, from CI's capture of the branch at `715b072` (`screenshots` branch, `pr-122/715b072/home-desktop.png`, 1280 × 3736 full page, real web fonts), top 1280 × 853. It shows the current header and the Work with me strip, so the door does not contradict the header above it.
  - `work-with-me-software.webp`: Tally's Home screen from the public tally repository's `screenshots` branch (pull request 75, head `322167d`, `home-desktop.png`, 1280 × 1179), the 1254 × 836 band from 13 px in, so the frame ends just under the Eating Out bar. Demo data only: the "Demo data. Nothing here is real." banner is in frame. No address bar, console or terminal text.
- Native-resolution inspection: pass. Each crop keeps its subject whole (the masthead and skyline; the name, tagline, desk scene and the top of the strip; the Tally sidebar, safe-to-spend figure and two budget bars) with no cut-off text along the edges. The Tally capture shows a fictional household and no real account, person or amount.
- Delivery: WebP quality 80, 900 × 600 each; 133,168, 38,932 and 24,748 bytes. The doors render at most 370 px wide on desktop and 104 px wide on the phone, so 900 px covers a 2× display. CSS shows each at 3:2 with `object-fit: cover`, anchored to the top; the files are already 3:2, so nothing is cropped at runtime.
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
      "sha256": "d469975271c4592c28a88ea91fedcefd23bfa80aa29cd0baedf2db5789ab638c",
      "width": 900,
      "height": 600,
      "bytes": 38932
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
