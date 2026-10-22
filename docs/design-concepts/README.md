# Redesign studies and evidence

The September 2026 redesign keeps the existing palette and changes the reading order, content ownership and explanations. The owner selected layouts before implementation. Generated studies are composition references, not factual product screenshots or finished page behavior.

## Selected compositions

- Home: [quiet studio](2026-09-09/home-quiet-studio-v2.png), [continuous mobile layout](2026-09-09/home-mobile-v2.png).
- Work and About: [work highlights](2026-09-09/work-v1.png), [personal path](2026-09-09/about-personal-path-v1.png).
- Project details: [Daily](2026-09-09/daily-detail-v1.png), [Threadline](2026-09-09/threadline-detail-v2.png).
- Writing: [article composition](2026-09-09/article-desktop-v1.png).
- Audio: [headphones, notebook and service icons](2026-09-09/audio-page-v3.png).
- Services: [software and audio selection](2026-09-10/audio-services-studies/README.md), [implementation review](2026-09-10/audio-services-studies/implementation-review.md).
- Project brief paths: [Website design, Web app and Workflow automation](2026-10-19/website-intake/index.html), approved October 19, 2026.

## Open studies: Hallmark audit follow-up (October 22, 2026)

A read-only Hallmark design audit flagged several choices the owner made on purpose. Defects it found are fixed in [PR #204](https://github.com/kwilson21/thesuperhuman.us/pull/204). These boards show each owner choice beside two or three alternatives that follow the site's direction, with one marked Recommended. Option A on each board shows the site as PR #204 leaves it. The owner's picks are recorded below. The boards themselves stay as they were shown.

- [D1 Home doors](2026-10-22/home-doors/index.html)
- [D2 Home motion](2026-10-22/home-motion/index.html)
- [D3 Site motion](2026-10-22/site-motion/index.html)
- [D4 Type and labels](2026-10-22/type-and-labels/index.html)
- [D5 Scene art](2026-10-22/imagery/index.html)
- [D6 Project pages](2026-10-22/project-pages/index.html)
- [D7 Service pages](2026-10-22/services-layout/index.html)
- [D8 Audio and music](2026-10-22/audio-music/index.html)
- [D9 System details](2026-10-22/system-details/index.html)

D10, follow-ups from the fixes in PR #204, was asked on the private decision page rather than a board. Its questions, as that page words them:

- D10.1: How should the About link “Explore The Engineer’s Daily prototype” fit on small phones?
- D10.2: On /work, how wide should the opened experience rows run?
- D10.3: Should the footer name match the header wordmark size?
- D10.4: How large should the 404 coast picture be?
- D10.5: Should the software brief and the signing pages use curly apostrophes everywhere?
- D10.6: Should four unused components be deleted? (ProjectCard, LiveWorkFeed, ResumeCard and DesignStoryPreview)
- D10.7: Should the personal website's status use the middle dot, “Live · evolving”?

Recreations on the boards are composition studies, not production screenshots. Any option that implies new art still needs [image QA](../generated-image-qa.md).

### Owner's picks (October 22, 2026)

The owner's selections, as given in conversation on October 22, 2026, after reviewing the boards and the D10 follow-ups on the decision page. Quoted exactly, including the owner's notes:

```
D1.1: D1.1-B (Ruled rows)
D1.2: D1.2-C (Doors beside the headline)
D2.1: D2.1-D (Keep the crossings, drop the drift)
D2.2: D2.2-B (Lean, steady glow)
D2.3: D2.3-A (Keep as is)
D2.4: D2.4-C (Re-type the glyph)
D3.1: D3.1-A (Keep as is)
D3.2: D3.2-B (Rule at rest)
D3.3: D3.3-C (Show the flow)
D3.4: D3.4-C (Quieter: 600ms and 12px, named)
D3.5: D3.5-B (Underline "Direction")
D4.1: D4.1-D (Statuses read as statuses)
D4.2: D4.2-C (Inter capitals)
D4.3: D4.3-A (Keep the neutral greys)
D4.4: D4.4-B (Libron on public pages)
D4.5: D4.5-A (Keep Regular)
D5.1: D5.1-A (Keep as is). Note: I think we should defer D5.1-D as a future task to do later, what we have works for now though.
D5.2: D5.2-B (Horizon over water). Note: Can we randomly choose between 2B and 2D?
D5.3: D5.3-B (Add a required check)
D5.4: D5.4-B (Yes, remove both)
D6.1: D6.1-A (Keep as is). Note: I do think we could redraw the controller to look better though
D6.2: D6.2-C (Same steps, drawn on paper)
D6.3: D6.3-C (The stepper from the study)
D6.4: D6.4-C (One landing line)
D6.5: D6.5-C (Shared step and one chapter break)
D7.1: D7.1-C (Hanging numerals, one list)
D7.2: D7.2-C (Under the heading everywhere)
D8.1: D8.1-B (Libron Bold)
D8.2: D8.2-A (Keep the symmetric front page)
D8.3: D8.3-D (Lead column (same as D8.2-D)). Note: If we could make it fit completely that'd be even better.
D8.4: D8.4-C (Close rule, 44px tap area)
D8.5: D8.5-D (Lead-in, shown on phones)
D9.1: D9.1-B (Words left, picture right)
D9.2: D9.2-D (Slide the message open). Note: If we could slide the message open in a way that keeps the next button visible on on the fold, it would be nice
D9.3: D9.3-C (Libron everywhere, the signed PDF too)
D10.1: D10.1-C ("Explore the Daily prototype")
D10.2: D10.2-C (Cap and hang from the Role column)
D10.3: D10.3-B (24px, like the header wordmark)
D10.4: D10.4-A (450 by 300, whole picture)
D10.5: D10.5-B (Curly everywhere in both)
D10.6: D10.6-B (Delete them)
D10.7: D10.7-B (Switch to "Live · evolving" and re-render)
```

The owner also wrote, in the same message: "#204 looks great, I really would like to bake this skill's standards into the website's design and make hallmark the standard I use for building things from here on out with proper credit given."

How the notes are read for the build (the owner can correct any of these):

- D5.1-D (photograph your own objects) is deferred, recorded in [the system plan](../website-system-plan.md#deferred-maintenance).
- D5.2: the 404 shows B or D at random on each visit; without JavaScript it shows B, and its static link preview uses B.
- D6.1: the Kaillera-next drawing keeps its browser windows, and its controller marks are redrawn.
- D8.2 and D8.3: these picks overlap. D8.3-D is D8.2-D's layout, so only the artist line and title keep D8.2-A's centred stack; the credit, buttons and platform links move into a lead column beside the poster, off that centre line. Toward the owner's note ("If we could make it fit completely that'd be even better"), the build also sizes the masthead to the screen's height, so the whole poster fits the first screen at common laptop and desktop sizes. The board's lead column alone measured 73% to 100%. Both points are for the owner to confirm in the build's pull request.
- D9.2: messages slide open without pushing the form's primary button off a screen it was on.
- D10.4: the 404 picture is replaced under D5.2, so its size follows the new layout (D9.1-B).
- D5.1-A with D5.3-B: the board says D5.3-B pairs with a D5.1 change or an exception line in each current record. The build adds the check and records the current files' results honestly, without exception lines; whether each failing file gets an exception citing D5.1-A, or is replaced, is for the owner to decide.

## Resume and contact

The selected direction uses one general resume with operator approval and a short contact form. Stored legacy DoD approvals retain their original delivery behavior. The [revised resume study](../../src/assets/site/redesign-studies/resume-flow-v2.webp) is historical evidence; functional behavior belongs to the HTML forms and tests.

## Historical alternatives and comparisons

The [website project data](../../src/data/project-stories/personal-website.ts) records eleven milestones, their intentions and selected/rejected status. Its twenty optimized historical studies live in `src/assets/site/redesign-studies`; the [collection review](../asset-reviews/redesign-studies.md) records their exact hashes and restricted archival use. Known defects in rejected artwork are preserved only to explain the review decisions.

[Page comparisons](../../src/data/project-stories/website-pages.ts) pair original pages with implemented local previews. Captures are dated evidence, not claims of launch or improved hiring outcomes. The original audit retains a small before-state screenshot set.

Full source PNGs, generation prompts, raw browser captures and detailed test logs remain in the private recovery archive. Their historical paths in early review records identify archived source material; they are not missing production dependencies. The committed studies, production assets and concise review records are the curated public subset. Do not copy the private archive into a PR.
