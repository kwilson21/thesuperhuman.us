---
title: "AI Gives You Speed. Engineering Gives It Direction."
description: "Why AI-assisted software development benefits from smaller validated steps, tighter feedback loops, and human stewardship."
---

I've been thinking a lot about the difference between **speed and velocity** when using AI to build software.

Speed is simply how fast you're moving.

Velocity is how fast you're moving **in a specific direction**.

AI gives us an incredible amount of speed. We can generate implementations, tests, documentation, and entire features faster than ever before.

But I've noticed a common mistake: assuming that because implementation has become faster, our engineering steps should become larger.

I think the opposite is true.

## Prompt Drift Is Often a Direction Problem

The term *prompt drift* gets used in a few related ways. In production LLM systems, it can refer to changes in behavior as prompts, context, models, tools, or surrounding data evolve. Here I'm using it for the engineering failure mode I encounter most in agentic development: accumulated AI decisions gradually carrying an implementation away from the outcome I intended.

Most of that drift comes from one of two situations.

Either there is **no clear direction**, and speed is being prioritized above everything else.

Or there is a direction, but no series of **small, reliable milestones and feedback loops** for getting there.

In the first case, you're moving quickly without really knowing where you're going.

In the second, you know where you want to go, but you're allowing AI to make too many unverified decisions between where you are and your destination.

Both can produce an enormous amount of code.

Neither necessarily produces good software.

My approach has increasingly become:

**AI + Direction + Small Validated Steps + Feedback = Velocity**

The goal isn't to give an agent a massive specification and come back later to see whether it built what I intended.

It's to establish the destination, take one meaningful step at a time, and let AI accelerate each step while I validate the result.

**Direction → Small Step → AI Execution → Validation → Feedback → Correction → Next Step**

AI shouldn't eliminate the engineering process.

**It should compress the execution time between engineering checkpoints.**

<figure class="direction-comparison" aria-label="Two conceptual paths toward an intended outcome">
  <div class="direction-path">
    <h3>Without checkpoints</h3>
    <svg viewBox="0 0 600 100" role="img" aria-label="A dashed path drifts away from its intended outcome" fill="none">
      <path d="M10 80C100 85 130 15 190 45S240 110 300 70 350 90 420 20" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 7" />
      <path d="m408 23 13-5-3 14" stroke="var(--muted)" stroke-width="2" />
      <circle cx="10" cy="80" r="6" fill="var(--ink)" /><circle cx="590" cy="40" r="7" stroke="var(--ink)" stroke-width="2" />
    </svg>
    <div class="direction-labels"><span>Start</span><span>Intended outcome</span></div>
  </div>
  <div class="direction-path">
    <h3>With checkpoints</h3>
    <svg viewBox="0 0 600 100" role="img" aria-label="A solid path changes course at checkpoints and approaches its intended outcome" fill="none">
      <path d="M10 80C70 80 90 60 130 55S195 35 240 65 330 75 380 50 460 65 560 40" stroke="var(--accent)" stroke-width="2.5" />
      <path d="m547 34 15 5-11 10" stroke="var(--accent)" stroke-width="2.5" />
      <circle cx="10" cy="80" r="6" fill="var(--ink)" />
      <g fill="var(--paper)" stroke="var(--accent)" stroke-width="2.5"><circle cx="130" cy="55" r="6" /><circle cx="240" cy="65" r="6" /><circle cx="380" cy="50" r="6" /><circle cx="590" cy="40" r="7" /></g>
    </svg>
    <div class="direction-labels"><span>Start</span><span>Intended outcome</span></div>
  </div>
  <figcaption>Illustration of course correction. These paths do not represent measured performance.</figcaption>
</figure>

## We Have Seen This Problem Before

There's an interesting progression here when you look at how software engineering has evolved.

Waterfall emphasized planning and predictability. Requirements were defined, systems were designed, software was built, and validation happened relatively late in the process.

When the assumptions were right, this could produce consistent outcomes. When they weren't, discovering that late was incredibly expensive.

Agile shortened that feedback loop.

Instead of trying to eliminate uncertainty before building, we started working in smaller increments:

**Plan → Build → Validate → Adjust → Repeat**

MVPs pushed this idea further by limiting the amount of **unvalidated scope** we were willing to build before getting feedback.

The breakthrough wasn't simply that Agile made developers faster.

It allowed us to **correct direction more frequently**.

AI relaxes a different constraint entirely: implementation speed.

What used to take days can sometimes take hours. What took hours can sometimes take minutes.

But that creates an interesting temptation.

Because AI can do more work between checkpoints, we naturally want to **give it more work between checkpoints**.

I think that's backwards.

## Don't Recreate Waterfall at AI Speed

Imagine writing an enormous specification, handing it to an AI agent, and saying:

> Build this.

The agent may make hundreds of reasonable intermediate decisions about architecture, dependencies, abstractions, APIs, naming, error handling, data models, and implementation details.

Each decision might make sense locally.

But if some of those decisions move slightly away from your intended direction, the deviations begin to compound.

Eventually the agent returns an enormous amount of working software that isn't quite the system you intended to build.

We've essentially recreated one of Waterfall's biggest weaknesses.

We just discover the problem three hours later instead of three months later.

That's more speed.

It isn't necessarily more velocity.

The lesson I've taken from this is:

**Don't let AI's speed make your iterations larger. Let it make them faster.**

## What This Looks Like in My Own Work

I don't want this to be a philosophy I only write about. I've been applying it in two projects that have helped refine how I work with AI.

**[The Engineer’s Daily](/building/the-engineers-daily)** explores a daily practice of engineering alongside Scripture, prayer and reflection. The intended experience grows a real application through small changes that matter to a fantasy harbor.

One lesson is built locally for review. Code execution and saved progress are still to come.

**Servant** takes the idea much further: a longer-term experiment in designing and building a programming language with AI-assisted development.

Working on a language keeps bringing me back to the difference between an idea being implemented and an idea being ready to rely on.

One principle from Servant has become increasingly important to how I think about AI-assisted development:

**Implementation does not mean acceptance.**

AI can turn an idea into an implementation incredibly quickly.

That doesn't mean the idea was good.

It doesn't mean the architecture is correct.

It doesn't mean we've learned enough to commit to the decision.

And it doesn't mean we're moving in the right direction.

These projects have become practical environments for refining how I use AI as an engineer rather than simply as a code generator.

## The Engineer Becomes a Steward

As AI becomes better at implementation, I think one part of the engineer's responsibility becomes even more important: **stewardship**.

Engineers still need to understand the system.

We still need to decide where we're going, establish constraints, break problems into reliable steps, evaluate results, recognize when something is drifting, and know when the evidence is strong enough to move forward.

AI can accelerate execution.

It cannot absolve us of responsibility for the outcome.

That's why I don't think the future of AI-assisted development is simply giving agents larger and larger tasks.

I think it's preserving the things that make good engineering reliable while dramatically reducing the time it takes to move between them:

**Clear direction. Small steps. Validation. Feedback. Correction.**

Then repeat.

Fast.

The goal isn't maximum code generation.

It's **maximum sustainable velocity without sacrificing consistency of outcome**.

AI gives us speed for free.

**Stewardship is what turns that speed into velocity.**
