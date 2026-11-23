// Quint model of the daily AI allowance that the living brief's board and the offer board count against
// (`brief_suggestion_budget`). Many requests run at once: each reads the day's counts, decides with a pure rule, and saves
// behind a guard in one batch that re-checks the counts, reading and deciding again after a lost race, three tries in all.
// The first reservation of a day also removes the rows of days before yesterday. Written after the code (both PRs used
// the pattern the autocomplete already had), so the next change to it is checked by search, not by reading.
// Code modelled:
//   read:     src/server/brief-board-store.ts `readBoardBudget` (the visitor's and the site's counts, one statement)
//   decide:   src/server/rules/brief-board.ts `reserveInterpretation` (refuse at either limit; clean on the day's first)
//   save:     src/server/brief-board-store.ts `reserveBoardBudget` (guard, then both upserts, one batch; a failed guard is
//             ChangedSinceRead) and src/server/guarded-save.ts `decideAndSave` (three tries, then SaveKeptChanging)
//   clean:    src/server/brief-board-store.ts `forgetOldBudgetDays`
// The offer board's reservation (src/server/offer-board-store.ts `reserveOfferBudget`, src/server/rules/offer-board.ts)
// is the same guard with one scope; a visitor whose limit is the site's is that case.
// What is left out, on purpose: the model call after a reservation (a reservation is spent whether or not the model
// answers), the Cloudflare rate limits and Turnstile in front of the route, and D1 errors (a failed batch writes nothing).
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module dailyAllowanceModel {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-guard"            the batch writes without re-checking the counts
  //   "snapshot-guard"      the guard re-checks the counts as they were read, not as they are stored
  //   "visitor-guard-only"  the guard re-checks the visitor's count and not the site's
  //   "split-batch"         the guard and the two counts are separate statements, so another request runs in between
  //   "clean-today"         the day's first reservation removes today's rows as well as old ones
  //   "no-retry"            a lost race is answered at once instead of read and decided again
  //   "off-by-one"          the rule refuses one reservation early
  const MUTANT: str

  type Req = { visitor: int, day: int, phase: str, readVisitor: int, readSite: int, tries: int, clean: bool }

  val VISITORS = Set(1, 2)
  // Scope 0 is the site's count.
  val SITE = 0
  val VISITOR_LIMIT = 2
  val SITE_LIMIT = 3
  val LAST_DAY = 3
  val MAXREQ = 7
  val TRIES = 3

  var today: int
  // (day, scope) -> count; a missing key is 0.
  var counts: (int, int) -> int
  var reqs: int -> Req
  var started: int
  // Ghosts: the reservations that really succeeded, per day and scope, and the answers given.
  var granted: (int, int) -> int
  var limitWhileRoom: bool
  var keptChangingAnswered: int

  pure def countOf(m: (int, int) -> int, k: (int, int)): int = if (m.keys().contains(k)) m.get(k) else 0
  pure def bump(m: (int, int) -> int, k: (int, int)): (int, int) -> int = m.put(k, countOf(m, k) + 1)

  action init = all {
    today' = 1,
    counts' = Map(),
    reqs' = Map(),
    started' = 0,
    granted' = Map(),
    limitWhileRoom' = false,
    keptChangingAnswered' = 0,
  }

  action unchangedGhosts = all {
    granted' = granted, limitWhileRoom' = limitWhileRoom, keptChangingAnswered' = keptChangingAnswered,
  }

  // The UTC day turns. Requests already running keep the day they started on. A Worker request lasts seconds, so it sees at
  // most one midnight: the day turns only when every running request started today. (Without this bound, a request
  // stalled across two midnights saves after the day's rows were cleaned and is granted past the limit: the reason the
  // cleanup keeps yesterday's rows.)
  def running(r: Req): bool = not(Set("done", "limit", "kept-changing").contains(r.phase))
  action nextDay = all {
    today < LAST_DAY,
    reqs.keys().forall(k => running(reqs.get(k)) implies reqs.get(k).day == today),
    today' = today + 1,
    counts' = counts, reqs' = reqs, started' = started, unchangedGhosts,
  }

  action start = {
    nondet v = VISITORS.oneOf()
    all {
      started < MAXREQ,
      reqs' = reqs.put(started + 1, {
        visitor: v, day: today, phase: "read", readVisitor: 0, readSite: 0, tries: 0, clean: false,
      }),
      started' = started + 1,
      today' = today, counts' = counts, unchangedGhosts,
    }
  }

  action setReq(id: int, r: Req): bool = all { reqs' = reqs.set(id, r), today' = today, started' = started }

  // Read and decide: the rule refuses at either limit; otherwise the reservation is saved next.
  action readAndDecide = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "read").oneOf()
    val r = reqs.get(id)
    val v = countOf(counts, (r.day, r.visitor))
    val s = countOf(counts, (r.day, SITE))
    val margin = if (MUTANT == "off-by-one") 1 else 0
    val refuse = v + margin >= VISITOR_LIMIT or s + margin >= SITE_LIMIT
    all {
      setReq(id, { ...r, phase: if (refuse) "limit" else "save", readVisitor: v, readSite: s, clean: s == 0 }),
      counts' = counts,
      granted' = granted,
      keptChangingAnswered' = keptChangingAnswered,
      // A refusal for the limit is true: the limit really was reached (the counts only grow during a day).
      limitWhileRoom' = (limitWhileRoom
        or (refuse and countOf(granted, (r.day, r.visitor)) < VISITOR_LIMIT and countOf(granted, (r.day, SITE)) < SITE_LIMIT)),
    }
  }

  // The guard as the batch checks it.
  def guardHolds(r: Req): bool = {
    val v = if (MUTANT == "snapshot-guard") r.readVisitor else countOf(counts, (r.day, r.visitor))
    val s = if (MUTANT == "snapshot-guard") r.readSite else countOf(counts, (r.day, SITE))
    if (MUTANT == "no-guard") true
    else if (MUTANT == "visitor-guard-only") v < VISITOR_LIMIT
    else v < VISITOR_LIMIT and s < SITE_LIMIT
  }

  // A lost race: read and decide again, or after the third try answer that the save kept changing.
  def lost(r: Req): Req =
    if (MUTANT != "no-retry" and r.tries + 1 < TRIES) { ...r, phase: "read", tries: r.tries + 1 }
    else { ...r, phase: "kept-changing", tries: r.tries + 1 }

  // The batch: the guard and both counts, all or nothing.
  action save = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "save").oneOf()
    val r = reqs.get(id)
    val ok = guardHolds(r)
    val after = if (ok) bump(bump(counts, (r.day, r.visitor)), (r.day, SITE)) else counts
    val afterSave = if (ok) { ...r, phase: if (r.clean) "clean" else "done" } else lost(r)
    all {
      MUTANT != "split-batch",
      setReq(id, afterSave),
      counts' = after,
      granted' = if (ok) bump(bump(granted, (r.day, r.visitor)), (r.day, SITE)) else granted,
      limitWhileRoom' = limitWhileRoom,
      keptChangingAnswered' = keptChangingAnswered + (if (afterSave.phase == "kept-changing") 1 else 0),
    }
  }

  // The "split-batch" mutant: the guard, then the visitor's count, then the site's, each its own step.
  action splitGuard = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "save").oneOf()
    val r = reqs.get(id)
    val ok = guardHolds(r)
    all {
      MUTANT == "split-batch",
      setReq(id, if (ok) { ...r, phase: "count-visitor" } else lost(r)),
      counts' = counts, unchangedGhosts,
    }
  }

  action splitCount = {
    nondet id = reqs.keys().filter(k => Set("count-visitor", "count-site").contains(reqs.get(k).phase)).oneOf()
    val r = reqs.get(id)
    val scope = if (r.phase == "count-visitor") r.visitor else SITE
    all {
      setReq(id, { ...r, phase: if (r.phase == "count-visitor") "count-site" else if (r.clean) "clean" else "done" }),
      counts' = bump(counts, (r.day, scope)),
      granted' = if (r.phase == "count-site") bump(bump(granted, (r.day, r.visitor)), (r.day, SITE)) else granted,
      limitWhileRoom' = limitWhileRoom,
      keptChangingAnswered' = keptChangingAnswered,
    }
  }

  // The day's first reservation removes the rows of days before yesterday (its failure is ignored; it never blocks).
  action clean = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "clean").oneOf()
    val r = reqs.get(id)
    val keepFrom = if (MUTANT == "clean-today") r.day + 1 else r.day - 1
    all {
      setReq(id, { ...r, phase: "done" }),
      counts' = counts.keys().filter(k => k._1 >= keepFrom).mapBy(k => counts.get(k)),
      unchangedGhosts,
    }
  }

  action step = any { nextDay, start, readAndDecide, save, splitGuard, splitCount, clean }

  // For the Apalache check only (`--step stepOrEnd`).
  action finished = all { today' = today, counts' = counts, reqs' = reqs, started' = started, unchangedGhosts }
  action stepOrEnd = any { step, finished }

  // ---- Properties -----------------------------------------------------------------------------------------------------
  // 1. No visitor and not the site is granted more interpretations in a day than its limit, however requests interleave.
  val limitsHold = granted.keys().forall(k => granted.get(k) <= (if (k._2 == SITE) SITE_LIMIT else VISITOR_LIMIT))

  // 2. Today's and yesterday's stored counts are the reservations granted: none lost, none counted twice.
  val countsTrue = granted.keys().forall(k => k._1 < today - 1 or countOf(counts, k) == granted.get(k))

  // 3. "Today's limit" is answered only when the limit really was reached.
  val limitAnswersTrue = not(limitWhileRoom)

  // 4. A request that loses a race is read and decided again: "kept changing" only after three lost races. With at most
  //    MAXREQ requests, it is answered only when others really kept winning.
  val retriesBeforeAnswer = reqs.keys().forall(k => reqs.get(k).phase == "kept-changing" implies reqs.get(k).tries == TRIES)

  val allProperties = and { limitsHold, countsTrue, limitAnswersTrue, retriesBeforeAnswer }

  // Reachability witnesses, for a hand check with the negated invariant: the site's limit reached by two visitors racing,
  // and a request that lost a race and then succeeded.
  val siteFullToday = countOf(granted, (today, SITE)) == SITE_LIMIT
  val neverSiteFull = not(siteFullToday)
  val retriedThenGranted = reqs.keys().exists(k => reqs.get(k).tries > 0 and Set("done", "clean").contains(reqs.get(k).phase))
  val neverRetriedThenGranted = not(retriedThenGranted)
}

module allowance { import dailyAllowanceModel(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module allowanceNoGuard { import dailyAllowanceModel(MUTANT = "no-guard").* }
module allowanceSnapshotGuard { import dailyAllowanceModel(MUTANT = "snapshot-guard").* }
module allowanceVisitorGuardOnly { import dailyAllowanceModel(MUTANT = "visitor-guard-only").* }
module allowanceSplitBatch { import dailyAllowanceModel(MUTANT = "split-batch").* }
module allowanceCleanToday { import dailyAllowanceModel(MUTANT = "clean-today").* }
module allowanceNoRetry { import dailyAllowanceModel(MUTANT = "no-retry").* }
module allowanceOffByOne { import dailyAllowanceModel(MUTANT = "off-by-one").* }
