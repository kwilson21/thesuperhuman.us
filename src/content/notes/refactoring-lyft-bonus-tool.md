---
title: "Refactoring a customer-incident bonus tool from 5k to 100k+ rows"
date: 2026-05-16
description: "How I rewrote an internal Lyft tool from a 5k-row batch limit to 100k+ rows, and replaced the on-call escalation pipeline with Grafana self-serve."
tags:
  - python
  - internal tooling
  - grafana
  - refactoring
  - on-call
draft: true
---

A common pattern in internal tooling: a tool gets built for a specific scale, the scale changes, and the tool starts breaking in ways that escalate to engineering before anyone notices the trend. This is a story about one of those tools at Lyft and what it took to push the breaking point out by 20x.

## The setup

The customer incident response team at Lyft issues driver bonuses [TODO: brief context on what bonuses these are. Service recovery? Promotional? Reimbursement?]. The tool they used to do this in bulk had a hard 5,000-row limit per run, which had been fine when the team was smaller [TODO: roughly when was that and what did the volume look like back then?].

By the time I picked it up, the limit was the problem. [TODO: what was the trigger? A specific incident, drift in support ticket volume, a new program?]. Anything north of 5,000 had to be either chunked manually by the support team or escalated to an on-call engineer who would run a one-off script. Both of those answers are bad in the same way: they make the bottleneck a person.

## What I changed

The refactor had two parts. The first was the boring one. Make the thing handle 100k+ rows without falling over. [TODO: high-level shape of the change. Was it bulk vs row-at-a-time? Streaming? Batching downstream API calls? A different job runner? Whatever the actual technical lift was, one or two sentences on the shape of the rewrite.]

The second part was the one that actually changed the team's day-to-day. Grafana observability for the support team itself. The dashboards [TODO: what metrics? Per-run row count, success and failure counts, time-to-complete, breakdown by issuer or bonus type?] meant support could see what their own run had done without paging anyone. The dashboard wasn't impressive engineering. It was a handful of panels pointing at the right metrics. But the dashboard was the difference between "escalate to on-call" and "look at the dashboard and decide whether to retry."

## What that changed downstream

Two things, both quiet.

First, the on-call rotation [TODO: before-and-after numbers if you have them. Pages per week? Hours of unplanned work per quarter? Even rough orders of magnitude are useful here]. The team got hours of focus back, and the support team stopped feeling like they were imposing every time they had a large batch to run.

Second, [TODO: any unexpected downstream effects? Did the support team start running larger batches than before because the tool wasn't a bottleneck anymore? Did anyone else copy the dashboard pattern for a different tool? Did the on-call runbook for related tools shrink?].

## The general principle, if there is one

The technical part of the refactor was unremarkable. What made the project useful was treating the human handoff as part of the system. The 5k limit was a number in a config file. The escalation pipeline was a tax that didn't show up in any line of code, paid by the support team and the on-call engineer every time the threshold was hit. The dashboards are how you remove the tax.

That's the part that transferred most directly to later work. When I look at a system now I try to identify which numbers in the config are paying a tax somewhere outside the code, and what the smallest amount of observability would be to make those numbers visible to the people doing the work. It isn't always a dashboard. Sometimes it's a Slack notification, sometimes it's a status field on a resource, sometimes it's a log line that an analyst can grep. The shape doesn't matter much; the move is the same.

---

*Backend systems, internal tooling refactors, and observability are part of what I take on through The Superhuman Group LLC. If that's a fit for what you're building, [get in touch](/#contact).*
