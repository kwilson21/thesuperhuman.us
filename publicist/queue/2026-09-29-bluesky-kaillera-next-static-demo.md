---
id: kaillera-next-static-demo-bsky
source: kaillera-next-static-demo
platform: bluesky
slot: 2026-09-29T17:30-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-static-demo
media: src/assets/projects/kaillera-next/static-demo-diagram.webp
alt: Diagram of Kaillera Next's static demo build on Cloudflare, with the rollback fixes that shipped alongside it.
status: skipped
skip_reason: retired in the 2026-11-07 queue refresh (owner, in conversation, 2026-11-07: "I'd find a way to convert the ones that have potential for high engagement and convert them to a higher engagement format")
---
One Kaillera Next rollback bug: a build step was quietly zeroing negative stick inputs. The fix shipped with a static demo build that has no ROMs anywhere in the deploy.
