---
id: kaillera-next-self-hosting-li
source: kaillera-next-self-hosting
platform: linkedin
slot: 2026-09-29T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-self-hosting
media: src/assets/projects/kaillera-next/self-hosting-diagram.webp
alt: Diagram of Kaillera Next's hosting: browser to Cloudflare to a tunnel into one small server, peer-to-peer play with a relay fallback, and ROM sharing switched off on the server.
status: draft
---
Kaillera Next needs a server for rooms, plus a relay for players whose networks block direct connections.

It's now set up to run on one small server behind a Cloudflare Tunnel, with no open inbound ports, and it redeploys itself when I merge to main. A free-tier host can take over with one command if needed, and that's where the site runs today.

Players who can't connect directly get short-lived relay credentials, and the key never reaches the browser. ROM sharing is off on the public server, and the server enforces that.

Built with Claude Code. More in the journal: https://thesuperhuman.us/building/kaillera-next#kaillera-next-self-hosting
