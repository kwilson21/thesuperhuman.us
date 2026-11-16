// Quint model of a client's messages and review decisions on one audio project (POST /api/studio/projects/[id]/messages),
// to several requests at once and to the owner's own moves in between. Written for the design of the audio projects
// conversion (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (today one INSERT ... SELECT with every condition in its WHERE; after the conversion a read, a rule and a
// guarded write, which is what the model has):
//   the read:    the session is read first, and ONE batch reads the project (revoked, stage), the latest published review, the
//                decisions since it and the revision rounds begun (the model takes both as one step: a session that ends
//                between the two reads is the same fact as one that ends after the batch, and the write re-checks it); the
//                rule decides from those plain columns (src/server/rules/audio-project-messages.ts, to be written). The
//                rule reads the client's message count with the batch and refuses a full window (ClientRateLimited), and the
//                write keeps `count < cap` as its guard, so a request that read room and lost it is refused by the write; a
//                refused write is followed by the count read (M6), which answers 429 before the other refusals
//   the write:   ONE statement that inserts the message only while the conditions the rule used still hold now (the guard
//                keeps today's conditions, as the offers design does); a stop writes the decision and closes the project's
//                access in ONE batch
//   a lost guard: is not retried: the request answers what a refused write answers today (409, or 429 when the count is full)
// What is left out, on purpose: the owner's notes and messages (they do not read the client's counts), the session's
// creation, what a refused rule answers (400, 409 or 429; the model only needs "no write"), and the text's checks.
// The owner may begin any number of revision rounds, as the code allows (the model reaches at most LAST_REVIEW of them, a bound
// on the search, not a rule: a round needs a review published after the one before it).
// The properties read the stored rows and never a flag set from a guard. Every row carries a stamp from one counter, `seq`
// (the order D1 serializes the statements in, as `created_at`, `published_at` and `revoked_at` order them in the tables):
// a message, a review's publication, a revision round begun, the project's close and the session's end each take the next
// one. The rate limit is scaled down: CAP messages in any WINDOW ticks (the code has 12 in 300 seconds), and the revision
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
  //   "rule-no-rounds" the rule and the write do not compare the rounds, so a change request passes when no revision round is left
  //   "send-no-stage"  the write of a plain message does not compare that the project is not complete, so a message is written after the
  //                    owner completed the project
  //   "no-withdrawn"   the write does not compare that the request is not withdrawn, so a message or an answer is written after the
  //                    request was withdrawn
  //   "write-no-rounds" only the write does not compare the rounds (the rule still does): an equivalent mutant, because a round
  //                    is begun only by leaving review_ready and the way back is a newer review, which the write's checks of the
  //                    stage and of the latest review already refuse
  //   "rule-no-count"  only the rule does not read the count (the write's guard still does): an equivalent mutant, the guard refuses
  //   "stop-split"     a stop writes the decision in one step and closes the project's access in a later one
  const MUTANT: str

  // A stored client message: when it was written (the request's `now`, for the rate window), its stamp, what it is ("send",
  // "approved", "changes" or "stopped") and the review the client named.
  type Msg = { ts: int, seq: int, kind: str, named: int }
  // What one read saw (the rule decides from these; the write re-checks them, except that the rate count is the write's alone).
  type Snap = { at: int, session: bool, revoked: bool, withdrawn: bool, stage: str, latest: int, decisions: int, rounds: int, count: int }
  // One request: phase "none", "read" (about to read), "write" (about to write), "closing" (the stop-split mutant: the
  // decision is stored, the close is to come), "done", "refused" or "conflict".
  type Run = { phase: str, kind: str, named: int, snap: Snap }

  // The stored rows, in one record so a step names only what it changes.
  type World = {
    msgs: List[Msg],
    seq: int,              // the last stamp taken
    pubAt: int -> int,     // the stamp of each review's publication (0 for none): `published_at`
    begins: List[int],     // the stamp of each revision round begun: the `created_at` of its update
    closedAt: int,         // the stamp of the project's close (0 while open): `revoked_at`
    endedAt: int,          // the stamp of the session's end (0 while active): the session's `revoked_at`
    withdrawnAt: int,      // the stamp of the request's withdrawal (0 while not withdrawn)
    completedAt: int,      // the stamp of the project's completion (0 while not complete): `completed_at`
    stage: str,            // "review_ready", "other" or "complete"
    latest: int,           // the latest published review, 0 for none
    clock: int,
  }
  var w: World
  var runs: int -> Run

  val RUNS = 1.to(3)
  val CAP = 2
  val WINDOW = 2
  val ROUNDS = 2
  val LAST_TICK = 4
  val LAST_REVIEW = 3
  val REVIEWS = 1.to(LAST_REVIEW)
  val KINDS = Set("send", "approved", "changes", "stopped")

  val noSnap = { at: 0, session: false, revoked: false, withdrawn: false, stage: "other", latest: 0, decisions: 0, rounds: 0, count: 0 }
  val idle = { phase: "none", kind: "send", named: 0, snap: noSnap }

  def isDecision(m: Msg): bool = m.kind != "send"

  // The client's messages whose time is after `t` minus the window: what the SQL counts.
  def countAfter(t: int): int = w.msgs.select(m => m.ts > t - WINDOW).length()

  // The decisions that answered review `r`: the messages that name it.
  def decisionsFor(r: int): int = w.msgs.select(m => isDecision(m) and m.named == r).length()

  def roundsNow: int = w.begins.length()

  // The project may be anywhere in its life when the requests arrive: `k` revision rounds begun, a review published for
  // each of them and one more waiting (or, with none begun, possibly no review yet). Stamps: review r at 2r-1, round j at 2j.
  action init = {
    nondet k = 0.to(ROUNDS).oneOf()
    nondet reviewed = Set(true, false).oneOf()
    val published = if (reviewed or k > 0) k + 1 else 0
    all {
      w' = {
        msgs: List(), seq: 2 * published,
        pubAt: 0.to(LAST_REVIEW).mapBy(r => if (r >= 1 and r <= published) 2 * r - 1 else 0),
        begins: List(2, 4).slice(0, k),
        closedAt: 0, endedAt: 0, withdrawnAt: 0, completedAt: 0,
        stage: if (published > 0) "review_ready" else "other",
        latest: published, clock: 0,
      },
      runs' = RUNS.mapBy(r => idle),
    }
  }

  // The rule, from the plain columns one read saw. true means "write". The rate count is an input.
  def allowed(kind: str, named: int, s: Snap): bool = and {
    s.session,
    not(s.revoked),
    not(s.withdrawn),
    MUTANT == "rule-no-count" or s.count < CAP,
    or {
      kind == "send" and s.stage != "complete",
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

  // The write's guard: the conditions the rule used, checked again now, and the rate count (the write's own), for this kind of
  // request. A message is written only while they hold; otherwise nothing is written.
  def guardHolds(kind: str, named: int, s: Snap): bool = and {
    MUTANT == "no-count" or countAfter(s.at) < CAP,
    MUTANT == "no-access" or (w.closedAt == 0 and w.endedAt == 0),
    MUTANT == "no-withdrawn" or w.withdrawnAt == 0,
    kind != "send" or MUTANT == "send-no-stage" or w.stage != "complete",
    kind == "send" or and {
      MUTANT == "no-stage" or w.stage == "review_ready",
      MUTANT == "no-review" or w.latest == named,
      MUTANT == "no-decision" or decisionsFor(w.latest) == 0,
      kind == "approved" or MUTANT == "rule-no-rounds" or MUTANT == "write-no-rounds" or (roundsNow < ROUNDS) == (kind == "changes"),
    },
  }

  // ---- The client's request ---------------------------------------------------------------------------------------
  action begin = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet kind = KINDS.oneOf()
    // The review the client heard: the latest one, or the first (a page left open).
    nondet named = Set(w.latest, 1).oneOf()
    all {
      w' = w,
      runs' = runs.set(r, { ...idle, phase: "read", kind: kind, named: if (kind == "send") 0 else named }),
    }
  }

  // The read (the session, then one batch; one step here) and the rule that decides from it.
  action read = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val snap = {
      at: w.clock, session: w.endedAt == 0, revoked: w.closedAt > 0, withdrawn: w.withdrawnAt > 0, stage: w.stage, latest: w.latest,
      decisions: decisionsFor(w.latest), rounds: roundsNow, count: countAfter(w.clock),
    }
    all {
      w' = w,
      runs' = runs.set(r, { ...h, snap: snap, phase: if (allowed(h.kind, h.named, snap)) "write" else "refused" }),
    }
  }

  // The write: ONE statement while the conditions still hold; otherwise nothing is written and the request answers a refusal.
  action write = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "write").oneOf()
    val h = runs.get(r)
    val stops = h.kind == "stopped"
    val closeHere = stops and MUTANT != "stop-split"
    val m = { ts: h.snap.at, seq: w.seq + 1, kind: h.kind, named: h.named }
    if (guardHolds(h.kind, h.named, h.snap)) all {
      w' = { ...w, msgs: w.msgs.append(m), seq: w.seq + 1, closedAt: if (closeHere) w.seq + 1 else w.closedAt },
      runs' = runs.set(r, { ...h, phase: if (stops and MUTANT == "stop-split") "closing" else "done" }),
    } else all {
      w' = w,
      runs' = runs.set(r, { ...h, phase: "conflict" }),
    }
  }

  // The stop-split mutant: the access is closed in a statement of its own, after the decision was stored.
  action closing = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "closing").oneOf()
    all {
      MUTANT == "stop-split",
      w' = { ...w, seq: w.seq + 1, closedAt: w.seq + 1 },
      runs' = runs.set(r, { ...runs.get(r), phase: "done" }),
    }
  }

  // ---- The owner and the clock ------------------------------------------------------------------------------------
  // The owner's moves that matter happen while a request is between its read and its write; so a step takes one only then.
  val writing = RUNS.exists(r => runs.get(r).phase == "write")

  // A new review is published: it replaces the one before, and the client may answer it.
  action publishReview = all {
    writing,
    w.closedAt == 0,
    w.stage != "complete",
    w.latest < LAST_REVIEW,
    w' = { ...w, seq: w.seq + 1, stage: "review_ready", latest: w.latest + 1, pubAt: w.pubAt.set(w.latest + 1, w.seq + 1) },
    runs' = runs,
  }

  // The owner begins a revision round: the stage leaves review_ready and a round is used.
  action beginRevision = all {
    writing,
    w.closedAt == 0,
    w.stage == "review_ready",
    w' = { ...w, seq: w.seq + 1, stage: "other", begins: w.begins.append(w.seq + 1) },
    runs' = runs,
  }

  action ownerRevokes = all {
    writing,
    w.closedAt == 0,
    w' = { ...w, seq: w.seq + 1, closedAt: w.seq + 1 },
    runs' = runs,
  }

  // The request is withdrawn while a request is between its read and its write.
  action withdraws = all {
    writing,
    w.withdrawnAt == 0,
    w' = { ...w, seq: w.seq + 1, withdrawnAt: w.seq + 1 },
    runs' = runs,
  }

  // The owner completes the project (from a final stage, which the model calls "other"); the stage guard of a plain message must see it.
  action completes = all {
    writing,
    w.closedAt == 0,
    w.stage == "other",
    w' = { ...w, seq: w.seq + 1, stage: "complete", completedAt: w.seq + 1 },
    runs' = runs,
  }

  action sessionEnds = all {
    writing,
    w.endedAt == 0,
    w' = { ...w, seq: w.seq + 1, endedAt: w.seq + 1 },
    runs' = runs,
  }

  action tick = all {
    w.clock < LAST_TICK,
    w' = { ...w, clock: w.clock + 1 },
    runs' = runs,
  }

  action step = any { begin, read, write, closing, publishReview, beginRevision, ownerRevokes, withdraws, completes, sessionEnds, tick }

  // ---- Properties (each reads the stored rows) ---------------------------------------------------------------------
  // 1. No window of WINDOW ticks holds more than CAP client messages, however many requests read the same count.
  val clientRateBounded = 0.to(LAST_TICK).forall(t => w.msgs.select(m => m.ts >= t and m.ts < t + WINDOW).length() <= CAP)

  // 2. A published review gets at most one answer.
  val oneDecisionPerReview = REVIEWS.forall(r => decisionsFor(r) <= 1)

  // 3. An answer names the review that was the latest when it was written: no review was published between the one it names
  // and the answer, so a page left open across a newer review cannot answer it.
  val decisionNamesLatestReview = w.msgs.select(m =>
    isDecision(m) and REVIEWS.exists(r => w.pubAt.get(r) > w.pubAt.get(m.named) and w.pubAt.get(r) < m.seq)).length() == 0

  // 4. A change request is written only while a revision round is left, and a stop only once they are used: the rounds begun
  // before the message are fewer than the cap for a change request, and the whole cap for a stop.
  val changesWithinRounds = w.msgs.select(m => {
    val before = w.begins.select(b => b < m.seq).length()
    (m.kind == "changes" and before >= ROUNDS) or (m.kind == "stopped" and before < ROUNDS)
  }).length() == 0

  // 5. A message is written only while the client's session and the project's access are open: no message is stamped after the
  // close (the stop's own decision shares the close's stamp) or after the session's end.
  val writtenForOpenAccess = w.msgs.select(m => (w.closedAt > 0 and m.seq > w.closedAt) or (w.endedAt > 0 and m.seq > w.endedAt)).length() == 0

  // 6. An answer is written only while the review awaits one: no revision round began between the review it names and the answer.
  val answeredInReviewStage = w.msgs.select(m =>
    isDecision(m) and w.begins.select(b => b > w.pubAt.get(m.named) and b < m.seq).length() > 0).length() == 0

  // 7. A stop closes the project's access: no state holds the decision without the closed access.
  val stopClosesAccess = w.msgs.select(m => m.kind == "stopped").length() == 0 or w.closedAt > 0

  // 8. A plain message is written only while the project is not complete: none is stamped after the completion.
  val plainMessageBeforeCompletion = w.msgs.select(m => m.kind == "send" and w.completedAt > 0 and m.seq > w.completedAt).length() == 0

  // 9. A message or an answer is written only while the request is not withdrawn: none is stamped after the withdrawal.
  val noMessageAfterWithdrawal = w.msgs.select(m => w.withdrawnAt > 0 and m.seq > w.withdrawnAt).length() == 0

  val allProperties = and {
    plainMessageBeforeCompletion, noMessageAfterWithdrawal, clientRateBounded, oneDecisionPerReview, decisionNamesLatestReview, changesWithinRounds,
    writtenForOpenAccess, answeredInReviewStage, stopClosesAccess,
  }

  // Reachability witness, for a hand with the negated invariant: a client's change request is stored.
  val changesStored = w.msgs.select(m => m.kind == "changes").length() > 0
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
module projectMessagesWriteNoRounds { import audioProjectMessages(MUTANT = "write-no-rounds").* }
module projectMessagesRuleNoCount { import audioProjectMessages(MUTANT = "rule-no-count").* }
module projectMessagesSendNoStage { import audioProjectMessages(MUTANT = "send-no-stage").* }
module projectMessagesNoWithdrawn { import audioProjectMessages(MUTANT = "no-withdrawn").* }
