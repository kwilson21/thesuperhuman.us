// Quint model of a client's messages and review decisions on one audio project (POST /api/studio/projects/[id]/messages),
// to several requests at once and to the owner's own moves in between. Written for the design of the audio projects
// conversion (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (today one INSERT ... SELECT with every condition in its WHERE; after the conversion a read, a rule and a
// guarded write, which is what the model has):
//   the read:    ONE batch reads the session, the project (revoked, stage), the latest published review, the decisions
//                since it, the revision rounds begun and the client's messages in the last five minutes; the rule decides
//                from those plain columns (src/server/rules/audio-project-messages.ts, to be written)
//   the write:   ONE statement that inserts the message only while each fact the rule used is still what the read saw
//                (compare-and-set); a stop writes the decision and closes the project's access in ONE batch
//   the retry:   a write that finds a fact changed reads again and decides again, at most three times, then answers 409
// What is left out, on purpose: the owner's notes and messages (they do not read the client's counts), the session's
// creation, what a refused rule answers (400, 409 or 429; the model only needs "no write"), and the text's checks.
// The rate limit is scaled down: CAP messages in any WINDOW ticks (the code has 12 in 300 seconds), and the revision
// rounds to 2, as the code has them.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module audioProjectMessages {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-count"       the write does not compare the client's message count, so two sends that read one message below the cap both write
  //   "no-decision"    the write does not compare the decisions since the review, so two answers to one review both write
  //   "no-review"      the write does not compare the latest review, so an answer to a replaced review is written
  //   "no-stage"       the write does not compare the stage, so an answer is written after the owner began a revision
  //   "no-access"      the write does not compare the session and the project's access, so a message is written after either closed
  //   "rule-no-rounds" the rule lets a change request pass when no revision round is left (and refuses a stop)
  //   "stop-split"     a stop writes the decision in one step and closes the project's access in a later one
  const MUTANT: str

  // A stored client message: when it was written, what it is ("send", "approved", "changes" or "stopped"), the review the
  // client named, and the facts at the moment of the write (they are ghosts, set from the state the write found).
  type Msg = {
    ts: int, kind: str, named: int,
    answers: int, rounds: int, revoked: bool, session: bool, stage: str,
  }
  // What one read saw.
  type Snap = {
    at: int, session: bool, revoked: bool, stage: str, latest: int, decisions: int, rounds: int, count: int,
  }
  // One request: phase "none", "read" (about to read), "write" (about to write), "closing" (the stop-split mutant: the
  // decision is stored, the close is to come), "done", "refused" or "conflict"; and the number of reads made.
  type Run = { phase: str, kind: str, named: int, snap: Snap, reads: int }

  var msgs: List[Msg]
  var revoked: bool
  var session: bool
  var stage: str        // "review_ready" or "other"
  var latest: int       // the latest published review, 0 for none
  var rounds: int       // revision rounds begun
  var clock: int
  var runs: int -> Run

  val RUNS = 1.to(3)
  val CAP = 2
  val WINDOW = 2
  val ROUNDS = 2
  val LAST_TICK = 4
  val LAST_REVIEW = 3
  val REVIEWS = 1.to(LAST_REVIEW)
  val KINDS = Set("send", "approved", "changes", "stopped")

  val noSnap = { at: 0, session: false, revoked: false, stage: "other", latest: 0, decisions: 0, rounds: 0, count: 0 }
  val idle = { phase: "none", kind: "send", named: 0, snap: noSnap, reads: 0 }

  def isDecision(m: Msg): bool = m.kind != "send"

  // The client's messages whose time is after `t` minus the window: what the SQL counts.
  def countAfter(t: int): int = msgs.select(m => m.ts > t - WINDOW).length()

  // The decisions that answered review `r`.
  def decisionsFor(r: int): int = msgs.select(m => isDecision(m) and m.answers == r).length()

  // The project may be anywhere in its life when the requests arrive: `k` revision rounds begun, a review published for
  // each of them and one more waiting (or, with none begun, possibly no review yet).
  action init = {
    nondet k = 0.to(ROUNDS).oneOf()
    nondet reviewed = Set(true, false).oneOf()
    val published = if (reviewed or k > 0) k + 1 else 0
    all {
      msgs' = List(),
      revoked' = false,
      session' = true,
      stage' = if (published > 0) "review_ready" else "other",
      latest' = published,
      rounds' = k,
      clock' = 0,
      runs' = RUNS.mapBy(r => idle),
    }
  }

  // The rule, from the plain columns one read saw. true means "write".
  def allowed(kind: str, named: int, s: Snap): bool = and {
    s.session,
    not(s.revoked),
    s.count < CAP,
    or {
      kind == "send",
      and {
        s.stage == "review_ready",
        s.latest > 0,
        s.decisions == 0,
        named == s.latest,
        or {
          kind == "approved",
          if (MUTANT == "rule-no-rounds") kind == "changes"
          else (s.rounds < ROUNDS) == (kind == "changes"),
        },
      },
    },
  }

  // The compare-and-set: each fact the rule used for this kind of request is still what the read saw.
  def casHolds(kind: str, s: Snap): bool = and {
    MUTANT == "no-count" or countAfter(s.at) == s.count,
    MUTANT == "no-access" or (revoked == s.revoked and session == s.session),
    kind == "send" or and {
      MUTANT == "no-stage" or stage == s.stage,
      MUTANT == "no-review" or latest == s.latest,
      MUTANT == "no-decision" or decisionsFor(s.latest) == s.decisions,
    },
  }

  // ---- The client's request ---------------------------------------------------------------------------------------
  action begin = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet kind = KINDS.oneOf()
    // The review the client heard: the latest one, or the first (a page left open).
    nondet named = Set(latest, 1).oneOf()
    all {
      msgs' = msgs, revoked' = revoked, session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock,
      runs' = runs.set(r, { ...idle, phase: "read", kind: kind, named: if (kind == "send") 0 else named }),
    }
  }

  // The read (one batch, so one step) and the rule that decides from it.
  action read = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val snap = {
      at: clock, session: session, revoked: revoked, stage: stage, latest: latest,
      decisions: decisionsFor(latest), rounds: rounds, count: countAfter(clock),
    }
    all {
      msgs' = msgs, revoked' = revoked, session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock,
      runs' = runs.set(r, { ...h, snap: snap, reads: h.reads + 1, phase: if (allowed(h.kind, h.named, snap)) "write" else "refused" }),
    }
  }

  // The write: ONE statement when the facts are as the read saw them; otherwise read again, at most three times.
  action write = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "write").oneOf()
    val h = runs.get(r)
    val stops = h.kind == "stopped"
    val closeHere = stops and MUTANT != "stop-split"
    val m = {
      ts: h.snap.at, kind: h.kind, named: h.named,
      answers: latest, rounds: rounds, revoked: revoked, session: session, stage: stage,
    }
    if (casHolds(h.kind, h.snap)) all {
      msgs' = msgs.append(m),
      revoked' = (revoked or closeHere),
      session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock,
      runs' = runs.set(r, { ...h, phase: if (stops and MUTANT == "stop-split") "closing" else "done" }),
    } else all {
      msgs' = msgs, revoked' = revoked, session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock,
      runs' = runs.set(r, { ...h, phase: if (h.reads < 3) "read" else "conflict" }),
    }
  }

  // The stop-split mutant: the access is closed in a statement of its own, after the decision was stored.
  action closing = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "closing").oneOf()
    all {
      MUTANT == "stop-split",
      msgs' = msgs, revoked' = true, session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock,
      runs' = runs.set(r, { ...runs.get(r), phase: "done" }),
    }
  }

  // ---- The owner and the clock ------------------------------------------------------------------------------------
  // The owner's moves that matter happen while a request is between its read and its write; so a step takes one only then.
  val writing = RUNS.exists(r => runs.get(r).phase == "write")

  // A new review is published: it replaces the one before, and the client may answer it.
  action publishReview = all {
    writing,
    not(revoked),
    latest < LAST_REVIEW,
    msgs' = msgs, revoked' = revoked, session' = session, rounds' = rounds, clock' = clock, runs' = runs,
    stage' = "review_ready",
    latest' = latest + 1,
  }

  // The owner begins a revision round: the stage leaves review_ready and a round is used.
  action beginRevision = all {
    writing,
    not(revoked),
    stage == "review_ready",
    rounds < ROUNDS,
    msgs' = msgs, revoked' = revoked, session' = session, latest' = latest, clock' = clock, runs' = runs,
    stage' = "other",
    rounds' = rounds + 1,
  }

  action ownerRevokes = all {
    writing,
    not(revoked),
    msgs' = msgs, session' = session, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock, runs' = runs,
    revoked' = true,
  }

  action sessionEnds = all {
    writing,
    session,
    msgs' = msgs, revoked' = revoked, stage' = stage, latest' = latest, rounds' = rounds, clock' = clock, runs' = runs,
    session' = false,
  }

  action tick = all {
    clock < LAST_TICK,
    msgs' = msgs, revoked' = revoked, session' = session, stage' = stage, latest' = latest, rounds' = rounds, runs' = runs,
    clock' = clock + 1,
  }

  action step = any { begin, read, write, closing, publishReview, beginRevision, ownerRevokes, sessionEnds, tick }

  // ---- Properties -------------------------------------------------------------------------------------------------
  // 1. No window of WINDOW ticks holds more than CAP client messages, however many requests read the same count.
  val clientRateBounded = 0.to(LAST_TICK).forall(t => msgs.select(m => m.ts >= t and m.ts < t + WINDOW).length() <= CAP)

  // 2. A published review gets at most one answer.
  val oneDecisionPerReview = REVIEWS.forall(r => decisionsFor(r) <= 1)

  // 3. An answer names the review that was the latest when it was written: a page left open across a newer review cannot answer it.
  val decisionNamesLatestReview = msgs.select(m => isDecision(m)).length() == msgs.select(m => isDecision(m) and m.named == m.answers).length()

  // 4. A change request is written only while a revision round is left, and a stop only once they are used.
  val changesWithinRounds = msgs.select(m => (m.kind == "changes" and m.rounds >= ROUNDS) or (m.kind == "stopped" and m.rounds < ROUNDS)).length() == 0

  // 5. A message is written only while the client's session and the project's access are open.
  val writtenForOpenAccess = msgs.select(m => m.revoked or not(m.session)).length() == 0

  // 6. An answer is written only while the review awaits one: the stage is review_ready.
  val answeredInReviewStage = msgs.select(m => isDecision(m) and m.stage != "review_ready").length() == 0

  // 7. A stop closes the project's access: no state holds the decision without the closed access.
  val stopClosesAccess = msgs.select(m => m.kind == "stopped").length() == 0 or revoked

  val allProperties = and {
    clientRateBounded, oneDecisionPerReview, decisionNamesLatestReview, changesWithinRounds,
    writtenForOpenAccess, answeredInReviewStage, stopClosesAccess,
  }

  // Reachability witness, for a hand with the negated invariant: a client's change request is stored.
  val changesStored = msgs.select(m => m.kind == "changes").length() > 0
  val neverChanges = not(changesStored)
}

module projectMessages { import audioProjectMessages(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module projectMessagesNoCount { import audioProjectMessages(MUTANT = "no-count").* }
module projectMessagesNoDecision { import audioProjectMessages(MUTANT = "no-decision").* }
module projectMessagesNoReview { import audioProjectMessages(MUTANT = "no-review").* }
module projectMessagesNoStage { import audioProjectMessages(MUTANT = "no-stage").* }
module projectMessagesNoAccess { import audioProjectMessages(MUTANT = "no-access").* }
module projectMessagesRuleNoRounds { import audioProjectMessages(MUTANT = "rule-no-rounds").* }
module projectMessagesStopSplit { import audioProjectMessages(MUTANT = "stop-split").* }
