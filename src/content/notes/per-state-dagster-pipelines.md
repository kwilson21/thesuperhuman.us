---
title: "Per-state Dagster pipelines for healthcare credentialing"
date: 2026-05-16
description: "Why per-state ingestion beat a single shared connector for state medical board data, and what the legacy architecture got wrong."
tags:
  - dagster
  - etl
  - python
  - selenium
  - healthcare
draft: true
---

Healthcare credentialing data has a structure problem. Every state's medical board publishes its data differently, and there is no central feed. Some states have a clean REST API. Some have a CSV behind an SFTP login. Some have a search interface that you have to drive with a headless browser. The platform I worked on at Axuall ingests from all of them, and the architectural migration that question forced was what the team was working on when I joined.

## The legacy shape

The previous architecture was a single connector with [TODO: high-level. Was it a strategy pattern? Per-state config files driving a generic ingestor? Templating? One or two sentences on the legacy shape.]. The intention was reuse. One engine that handled all states. The reality was that every state ended up with conditional branches inside the shared engine, and a change to one state's logic could regress another. [TODO: optional. Do you want to name a specific instance, or keep this abstract? Either is fine.]

The migration the team had started, and that I contributed to in the last [TODO: weeks or months] of the contract, was the inverse. Each state gets its own pipeline. Same Dagster framework, same observability, but the per-state logic lives in its own asset graph and is owned end-to-end by that pipeline.

## Why per-state was the right call

Three reasons, in roughly the order they bit us in practice.

**Contract drift.** State boards change their data formats without notice. A column rename, a new required field, an undocumented filter on the public-facing endpoint. When that happens you want exactly one pipeline to fix, and you want the rest of the system to keep running. A monolithic ingestor turns one state's API change into an incident that touches every state's data.

**Interface variance is real.** [TODO: at least one specific example here. Was there a state that required Selenium because the search UI was the only interface? Was there one where the SFTP had a non-standard auth flow? A pagination quirk that broke shared assumptions?]. Trying to abstract across SFTP, REST, and headless browser ingestion in one engine means the abstraction has to be wide enough to fit the worst case, which makes every individual pipeline pay for the variance of the others.

**Ownership.** Per-state ownership means a debugging session for one state doesn't require loading the mental model of every other. The pipeline file is small enough to read. The Dagster asset graph for that state is small enough to inspect. That changes how quickly a new engineer can get up to speed on one specific failure, which matters in a domain where the cost of being wrong is regulatory rather than just aesthetic.

## What stayed shared

Not everything became per-state. [TODO: what was shared? Output schema? Common downstream materialization? Auth credential storage? Health-check or alerting pattern?]. The principle the team converged on, as I understood it, was: share what the data downstream of ingestion needs to look like, and don't share what's specific to how each state delivers it.

## The Selenium piece

A specific note on the headless-browser pipelines, because they get a bad reputation in data engineering and not always deservedly so. For state boards that only expose data through a search UI, [TODO: did you use Selenium directly, Playwright, or something else? Headed or headless? Any specific reliability moves: explicit waits, retry-on-stale-element, snapshot testing of the expected page structure?]. The thing that made these pipelines reliable, more than the framework choice, was [TODO: what was it? Idempotency on retry? Per-state retry budget? Snapshot-style assertions on the page DOM so the pipeline could fail fast when the state board redesigned their UI?].

The general point: Selenium pipelines are unfashionable but they're often the right answer when the only public interface is a UI. The reliability work that makes them production-grade is mostly about treating the page itself as a contract you have to validate, not as something you can trust.

## Why I'm writing this

Most of my contract work is exactly this kind of cross-cutting data engineering. Messy real-world sources, multiple ingestion shapes, regulated-industry data that has to be defensible. If that's a fit for what you're building, [get in touch](/#contact).
