# Asset: Tally transactions

- Purpose and placement: the "Bring an idea to life" path on `/services`, next to the Tally evidence. It shows a second real screen of Tally so the page doesn't repeat the Software door's Home screen. Evidence of a real public demo, not decoration. No imagery was generated.
- Reviewer: Claude Code agent, September 29, 2026. This is agent QA, not owner acceptance of the implemented page. The owner chose the Transactions screen for this column on September 29, 2026 ("B"), from a rendered comparison.
- Source: the live public demo, `https://tally-demo.thesuperhuman.us/transactions`, captured on September 29, 2026 with headless Chrome at a 1200 × 800 viewport (page content only, no browser chrome, address bar, console or terminal). Demo data only: the "Demo data. Nothing here is real." banner is in frame; the household and transactions are the demo's fictional seed.
- Native-resolution inspection: pass. The frame keeps the banner, the Tally sidebar, the Transactions heading, search, filters and five dated rows whole; the list continues below the frame without cutting a line of text.
- Delivery: WebP quality 80, 900 × 600, 19,988 bytes, matching the door pictures. The column renders it at most about 460 px wide on desktop and full width on a phone, so 900 px covers a 2× display.
- Accessibility and motion: meaningful alternative text is set where it's used ("Tally's transactions screen, running on demo data"); static and lazy-loaded.
- Publication check: no private content, secrets, home address or real money. Merchant names are the demo's fictional transactions; no third-party logos. No claim of production readiness; the caption says it's the public demo on demo data.
- Placement update, October 19, 2026 (pull request 188): the "Bring an idea to life" row is now the Web app row (`/services#web-app`), and the picture sits beside the Tally and Kaillera Next evidence. It renders about 464 px wide on a 1280 px desktop and full width (324 px) on a 390 px phone, with the same alternative text and caption. Page inspection by the Claude Code agent (not the owner) in CI's 1× captures of head `7881963`: pass at 1280 px and 390 px, with the "Demo data" banner visible and no text cut along the edges. The file and its hash are unchanged.
- Outcome: ready for production asset use. Deployment is separate.
- Reads as generated (one-time check of the current files, October 22, 2026, owner pick D5.3-B): pass. Claude Code agent, not a fresh viewer, so judged by the listed tells, at 464 × 309 in the /services Web app row at 1280px wide. It is a real screenshot of the public demo and reads as one.

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/tally-transactions.webp",
      "sha256": "08cdf5fc1a3ea6a0b16739888eb4f9fb10edf0045c299fbae846e7e9f6b8fade",
      "width": 900,
      "height": 600,
      "bytes": 19988
    }
  ]
}
```
