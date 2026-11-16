# Mobile contact/footer consistency

Scope: Home's bottom Get in touch action moves into the shared footer. The pinned
phone action remains through page sections and hands off only when the footer
enters view. `/services` also receives the shared footer, without changing its
print sheet. The contact switchboard, message form, software/song intakes and
private task pages stay quiet because they are already the destination.

Base: `b9bb182d4fcb98775a48d04104cac68a38da5fae`. No production deployment performed.
The previous revision is the rollback point. No dependencies, business rules,
forms, stored data, payments or authorization are changed.

## Verification

- PASS: 170 component/script tests across 15 files, including footer variants,
  observer transitions, quiet pages and screenshot-selection regressions.
- PASS: Astro check, 0 errors and 18 existing hints.
- PASS: lint, formatting, diff whitespace, design, copy and asset QA checks.
- PASS with limit: publicist local gate checks 84 entries but skips private-note
  lookup without a token; it is not evidence of the private publication gate.
- PASS: production build.
- INCOMPLETE: full-suite run reports failures in audio-project-uploads and
  owner-agreement-attachments-put outside this change; final summary pending.
  Hosted CI must pass on the final commit before merge.
- UNVERIFIED: responsive browser execution and visual audit. Local Chromium
  cannot create its required socket in this environment, including the escalated
  attempt. The browser tool cannot reach the local preview port. No screenshot
  or manual visual pass is claimed.
- UNVERIFIED: live deployment, real mobile and second-browser smoke checks.

Local tooling is Node 24.22.1 and Vitest 5.0.3 from the existing workspace, older
than the repository's requested Node 26 and locked test version. The normal pnpm
launcher tries an unavailable local install, so the installed tools were invoked
directly. This does not replace final-head hosted checks.

## Browser regression and release checklist

`scripts/screenshots/scenarios/mobile-contact.mjs` checks Home with filled project
buttons visible, the shared footer on Home/services/audio, scrolling away and back,
and the new contact page's lack of a redundant sticky/footer CTA. It is selected
when the shared footer, pinned script or Home changes. The existing contact
switchboard scenario covers the message form. Inspect the CI images before review.

- Purpose/content: PASS by source review; retains existing Home horizon and copy,
  shared tokens, contact routing, and menu/input-focus suppression.
- Search/sharing: N/A, metadata, canonical URLs, indexing and media unchanged.
- Accessibility/responsive: PASS source/unit checks for native links, existing
  touch sizes, focus styles, hidden/no-JS fallback, phone-only and print behavior;
  UNVERIFIED browser geometry, zoom and keyboard navigation until screenshot QA.
- Performance/resilience: no new dependency or client observer; fewer observed
  elements. UNVERIFIED browser performance, not claimed from source alone.
- Forms/sensitive flows: N/A for backend changes; contact/intake exclusion is
  covered by static tests and a browser scenario, no live messages sent.
- Privacy/legal/measurement: N/A for data or policy changes; the services print
  legal line remains and screen legal/navigation comes from the shared footer.
- Independent review: no implementation/security/accessibility blockers; 110 focused
  tests and design check independently passed. Canonical design-rule inconsistency fixed.
- Release: UNVERIFIED until final-head CI and rendered QA pass.
- Owner center/agreement signing: N/A, no changes.
