---
title: "About — Kazon Wilson"
description: "Software engineer based in Connecticut, soon Northern Virginia. Backend and data systems, with side trips through Ruby on Rails and TypeScript."
---

Software engineer based in Connecticut (soon to be Northern Virginia). Seven-plus years building production systems in Python, with side trips through Ruby on Rails, TypeScript, and the messy real world of healthcare credentialing, insurance documents, and POS data ingestion.

I'm most useful when a problem cuts across layers — when a UI bug turns out to be a data pipeline issue that turns out to be a business-logic miscommunication, and someone needs to chase it through all three. I like working close to the people who use what I build, and I gravitate toward engagements where the engineering decisions are also product decisions.

## About

I grew up around audio. My undergraduate degree is in audio production from Middle Tennessee State, with a minor in computer science that turned out to be the part that stuck. I came into software engineering through data — my first job out of school was at a startup ingesting tobacco sales data from thousands of retail POS systems, and I learned engineering by being the person who had to make that data make sense.

Since then I've worked across product engineering at Lyft, regulated insurance software at Sure, healthcare credentialing data ingestion at Axuall, and most recently as the sole data engineer at an early-stage startup. The throughline is data systems and product engineering — usually some mix of both. I tend to enjoy the operational and ownership parts of the job: knowing how a system fails, building observability so other people can debug it without paging me, and reducing the amount of manual work the team has to do.

These days I'm taking on senior contract engagements through The Superhuman Group LLC — backend systems, data pipelines, and the kind of cross-layer product work where senior execution is needed but a full-time hire isn't the right shape. Fixed-price, deliverable-based, async-first, remote or hybrid out of Northern Virginia, where my family is planning to settle.

## Selected work

### Scotch — Data Engineer
*October 2025 – May 2026 · Remote*

Sole data engineer at an early-stage startup. Built and maintained the ETL pipelines that brought liquor-store POS transaction data into the company's Ruby on Rails platform.

Two contributions outside the day-to-day data work stand out. I ran scenario-based technical interviews for Senior Software Engineer candidates and contributed to hiring decisions — useful experience in articulating what good senior engineering looks like under time pressure. And I advocated for AI-assisted development on the engineering team, modeling Claude in feature planning, PR review, and PR description authorship until the team picked up the practice and made it part of how they shipped. Watching a behavior shift from advocacy to muscle memory is one of the more satisfying experiences I've had as an engineer.

### Vendorpass / Axuall (Contract) — Senior Python Developer
*July 2025 – November 2025 · Remote*

Short contract on a healthcare credentialing platform. Built per-state Dagster ETL pipelines that ingested data from state medical boards — each state has its own data interface, ranging from SFTP feeds to REST APIs to web scraping with Selenium. The platform was mid-migration from a legacy Python connector architecture toward per-state pipelines, and I contributed to the early stages of that transition.

### Sure — Software Engineer
*December 2023 – February 2025 · Remote*

Backend engineer on the Toggle homeowners insurance product. Owned the document templating pipeline — adapting contractor-supplied HTML/CSS templates to match the reference PDFs that insurance carriers required. Also maintained existing document generation logic in Django (signals, versioned PDF output to MongoDB) and the third-party carrier API integration.

This was a lower-leverage chapter for me than my other roles, and I'm honest about that. The work was important but largely operational; I didn't get to do as much engineering as I'd hoped. The role ended in a company-wide layoff in early 2025.

### Lyft — Software Engineer
*January 2021 – December 2023 · Remote*

Spent most of my time on the Associate Tools team, working on internal tooling and customer incident response systems. A handful of projects from this period that I think about often:

**Vendor leadership on third-party rebooking APIs.** A third-party rental provider implemented a new rebooking API that Lyft needed to integrate with. I led the feature from ideation through deployment, including identifying regressions in the vendor's API and driving their backend team to ship contract-level API changes Lyft needed. The most useful skill from this project was learning to negotiate technical changes across organizational lines without authority — a skill that transfers to almost every other kind of cross-team work.

**Bulk bonus refactor.** Took a tool the customer incident response team used to issue driver bonuses and rewrote it from a 5k-row batch limit to handling 100k+ rows. Added Grafana observability so the support team could monitor and self-serve runs they used to have to escalate to on-call engineers. The before-and-after on this one — manual escalation pipeline replaced by a self-serve workflow — is the kind of outcome I want more of.

**Data migration during a service deprecation.** Owned the 40k-row data migration during deprecation of a third-party rentals service. Designed a dry-run-capable migration plan, audited and backfilled 18k closed rentals, and built in safeguards against potential duplicate fee charges to customers. Migrations like this are 80% planning and 20% execution; doing the planning thoroughly was the whole game.

**Pay reviewer migration.** Led the end-to-end migration of a driver/rider fare recalculation tool off a legacy internal service, integrating with 7 services and coordinating delivery across backend and frontend teams.

**Touchless rental drop-off.** Coordinated cross-team delivery (backend, frontend, mobile, ops, TPM) of a touchless rental drop-off feature across 6 services and iOS/Android clients.

### Skupos — Associate Software Engineer / Data Operations Analyst
*November 2018 – January 2021 · San Francisco, CA*

My first job out of school. Started as an intern and was promoted to Associate Software Engineer. Skupos ingested tobacco sales data from retail POS systems, and over my time there the customer base grew from around 3,000 retailer locations to somewhere between 7,000 and 10,000.

The most meaningful project from this period was an internal application I designed and built end-to-end: a Python WSGI service running on AWS EC2 that automated the troubleshooting of POS data quality reports. Before I built it, this work was happening in Google Sheets and ad-hoc Python scripts run by analysts. The point of the service wasn't really technical elegance — it was that the business could scale operations through application performance instead of growing the analyst team. Hiring and training analysts is expensive; scaling code is comparatively cheap. That was the first time I really understood what software was for.

I also mentored a couple of interns from a 7-person cohort, two of whom chose to work closely with me. One of them transitioned into data science afterward. I keep in touch with them.

## Outside of work

*A note on collaboration. The technical projects below are AI-assisted — I direct the work and review every change, but Claude does most of the keystrokes. Given how often I'm advocating the same workflow at work, it would be strange not to say so here.*

**Personal infrastructure.** I run a small home cluster — Docker Swarm across a few Linux mini-PCs, with Portainer managing deployments and Traefik as the internal reverse proxy. Deployments flow through a containerized GitHub webhook listener that builds, pushes to GHCR, and updates services with digest-pinned tags on every push to main. Underneath that sits a self-hosted home network: OPNsense on a Protectli VP2430, Omada EAP720s and a managed switch, VLAN segmentation, Unbound for recursive DNS with community blocklists, Tailscale for remote access, and SWAG as the external reverse proxy. I've put meaningful work into hardening it — SSH lockdown, UFW rules, Cloudflare Tunnels for select services, and a slow migration toward Tailscale SSH to get off port 22 entirely. Backups follow a 3-2-1 strategy using Duplicacy to Cloudflare R2 and Backblaze B2 with daily snapshots, weekly pruning, and integrity checks. This is the kind of side project that pays back in production engineering intuition every time I touch real infrastructure at work.

**Kaillera-next.** An open-source multiplayer netplay platform for retro games. FastAPI + Socket.IO server, WebRTC peer-to-peer connections with a self-hosted TURN relay (coturn on a hardened VPS, HMAC-credentialed), Redis-backed rooms, SQLite for persistence, and PostHog behind a self-hosted proxy. A custom C-level rollback engine handles GGPO-style input prediction inside the emulator's WASM core (mupen64plus-next via EmulatorJS). The deploy pipeline is fully automated — webhook → containerized build → Swarm rollout with digest-pinned updates, convergence polling, and email alerts on failure. Currently at v0.49 with active development. Live at [kaillera-next.thesuperhuman.us](https://kaillera-next.thesuperhuman.us).

**Kova.** An ongoing personal project: a programming language designed for data transformation and ETL pipelines. Born out of frustration with Python and pandas verbosity on the data engineering side, and the limits of SQL when transformations get complex. The design centers on a pipeline-based syntax, streaming architecture, gradual typing, and multi-database support. Currently working through a v0.1 implementation spec. Whether or not it ever gets shipped widely, designing a language has been one of the most useful exercises I've done for thinking about API design and developer experience.

**Retro gaming and emulation.** Long-running interest. I've done some reverse-engineering work on hardware-software interactions in this space — most recently a deep dive into patching Dolphin Emulator's HID report routing for a USB sensor bar device that wasn't properly initializing on Windows.

**Frigate NVR.** Self-hosted CCTV running Frigate on an Unraid box with a GTX 1070 doing ONNX object detection. The cameras (Eufy C35s) don't speak RTSP natively, so the setup hangs off eufy-security-ws — an unofficial WebSocket bridge to Eufy's API — with an event-driven streaming pipeline that only pulls feeds when motion fires. Most of the interesting engineering here is in shaping a workable household setup around hardware that wasn't designed to be self-hosted.

**Audio engineering.** Original undergraduate field — still an active practice. Tracking and mixing on an RME Babyface Pro through Sennheiser HD 650s, in UAD Luna with Pro Tools alongside. Staple plugins: Waves, UA Spark, Kazrog.

## Tech

**Daily.** Python, Django, Flask, Ruby on Rails, PostgreSQL, MySQL, Git, AWS (EC2, S3), Docker, Linux.

**Used in production.** TypeScript, JavaScript, React, Dagster, MongoDB, DynamoDB, gRPC / Protobufs, GraphQL, Selenium, Grafana, Prometheus.

**Adjacent personal infrastructure.** Docker Swarm, Traefik, Tailscale, Cloudflare Tunnels.

## Contact

- Email: kazon.wilson@thesuperhuman.us
- GitHub: [github.com/kwilson21](https://github.com/kwilson21)
- LinkedIn: [linkedin.com/in/kazonwilson](https://www.linkedin.com/in/kazonwilson/)
- Location: Fairfield, CT (relocating to Northern Virginia in 2026)
