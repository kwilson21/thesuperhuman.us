// Quint model of the daily suggestion budget (POST /api/software/brief/suggest): a visitor may take 300 suggestions a day and
// the site 10,000, counted in the table brief_suggestion_budget, to a Worker that serves several requests at once. Written
// for the conversion of the public intake routes. The caps are scaled down to 2 for a visitor and 3 for the site.
// Code modelled:
//   the early read:      src/server/flows/brief-suggest.ts reads the site's count (`readSiteCount`) and `withinSiteBudget`
//                        answers empty when it is at the cap: a plain read, which another request can make stale at once
//   the reservations:    `reserve` (src/server/brief-suggest-store.ts), visitor first and then site: ONE statement each, an
//                        upsert that adds one only while the stored count is under the cap (`ON CONFLICT ... DO UPDATE SET
//                        count = count + 1 WHERE count < ? RETURNING count`), so it is one step and never a read and a write
//   the model call:      made only when both reservations were made; a reservation that was refused answers empty
// What is left out, on purpose: the minute limits (Cloudflare's own counters), the pass and the captcha, the model's
// answer, and the cleanup of old days (it deletes only rows of earlier days, never the day's counters).
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module suggestionBudget {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "unguarded-visitor" a visitor's reservation adds one without the `WHERE count < cap` guard (nothing else reads a visitor's count)
  //   "unguarded-site"  the site's reservation adds one without the guard, so only the early read protects the site
  //   "read-then-write" the reservation reads the count in one step and writes it plus one in another (two statements)
  //   "ignore-refusal"  a refused reservation does not stop the request: the model is called anyway
  const MUTANT: str

  // The counters: scope 0 is the site, scope 1 and 2 are two visitors. A request reserves for its visitor, then the site.
  // One delivery: phase "none", "early" (about to read the site's count), "visitor" (about to reserve for the visitor),
  // "visitorRead" and "siteRead" (only in the read-then-write mutant: read, write follows), "site" (about to reserve for the
  // site), "asked" (the model is called) or "done"; how many reservations it made.
  type Run = { phase: str, visitor: int, read: int, reserved: Set[int], asked: bool }

  var counts: int -> int
  var runs: int -> Run

  val RUNS = 1.to(4)
  val VISITORS = 1.to(2)
  val SITE = 0
  val SCOPES = 0.to(2)
  val CAP_VISITOR = 2
  val CAP_SITE = 3

  def capOf(scope: int): int = if (scope == SITE) CAP_SITE else CAP_VISITOR

  val idle = { phase: "none", visitor: 0, read: 0, reserved: Set(), asked: false }

  action init = all {
    counts' = SCOPES.mapBy(s => 0),
    runs' = RUNS.mapBy(r => idle),
  }

  action deliver = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet visitor = VISITORS.oneOf()
    all {
      counts' = counts,
      runs' = runs.set(r, { ...idle, phase: "early", visitor: visitor }),
    }
  }

  // The plain read of the site's count, and the rule that answers empty at the cap. It decides nothing that is kept: another
  // request may reserve the last unit before this one's reservation.
  action early = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "early").oneOf()
    val h = runs.get(r)
    all {
      counts' = counts,
      runs' = runs.set(r, if (counts.get(SITE) >= CAP_SITE) { ...h, phase: "done" } else { ...h, phase: "visitor" }),
    }
  }

  // A reservation of `scope` as ONE statement: it adds one while the count is under the cap, and answers refused otherwise.
  // Refused: the request ends, unless the mutant carries on to the model.
  action reserve = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "visitor" or runs.get(i).phase == "site").oneOf()
    val h = runs.get(r)
    val scope = if (h.phase == "visitor") h.visitor else SITE
    val allowed = counts.get(scope) < capOf(scope) or (MUTANT == "unguarded-site" and scope == SITE) or (MUTANT == "unguarded-visitor" and scope != SITE)
    all {
      MUTANT != "read-then-write",
      counts' = if (allowed) counts.set(scope, counts.get(scope) + 1) else counts,
      runs' = runs.set(r,
        if (not(allowed) and MUTANT != "ignore-refusal") { ...h, phase: "done" }
        else {
          ...h,
          phase: if (h.phase == "visitor") "site" else "asked",
          reserved: if (allowed) h.reserved.union(Set(scope)) else h.reserved,
        }),
    }
  }

  // The read-then-write mutant: the count is read in one step ...
  action readCount = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "visitor" or runs.get(i).phase == "site").oneOf()
    val h = runs.get(r)
    val scope = if (h.phase == "visitor") h.visitor else SITE
    all {
      MUTANT == "read-then-write",
      counts' = counts,
      runs' = runs.set(r, { ...h, phase: if (h.phase == "visitor") "visitorRead" else "siteRead", read: counts.get(scope) }),
    }
  }

  // ... and written, plus one, in a later one, after another request may have written.
  action writeCount = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "visitorRead" or runs.get(i).phase == "siteRead").oneOf()
    val h = runs.get(r)
    val scope = if (h.phase == "visitorRead") h.visitor else SITE
    val allowed = h.read < capOf(scope)
    all {
      MUTANT == "read-then-write",
      counts' = if (allowed) counts.set(scope, h.read + 1) else counts,
      runs' = runs.set(r,
        if (not(allowed)) { ...h, phase: "done" }
        else { ...h, phase: if (h.phase == "visitorRead") "site" else "asked", reserved: h.reserved.union(Set(scope)) }),
    }
  }

  // The model is called, and the request ends.
  action ask = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "asked").oneOf()
    val h = runs.get(r)
    all {
      counts' = counts,
      runs' = runs.set(r, { ...h, phase: "done", asked: true }),
    }
  }

  action step = any { deliver, early, reserve, readCount, writeCount, ask }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. A visitor's count never passes the daily cap.
  val visitorWithinCap = VISITORS.forall(v => counts.get(v) <= CAP_VISITOR)

  // 2. The site's count never passes the daily cap, however many requests read it as under the cap at once.
  val siteWithinCap = counts.get(SITE) <= CAP_SITE

  // 3. Each count is exactly the reservations made: no reservation is lost or counted twice.
  val countsAreReservations = SCOPES.forall(s => counts.get(s) == RUNS.filter(r => runs.get(r).reserved.contains(s)).size())

  // 4. The model is called only for a request that holds both of its reservations.
  val modelOnlyForReserved = RUNS.forall(r => not(runs.get(r).asked) or (runs.get(r).reserved.contains(SITE) and runs.get(r).reserved.contains(runs.get(r).visitor)))

  val allProperties = and {
    visitorWithinCap, siteWithinCap, countsAreReservations, modelOnlyForReserved,
  }

  // Reachability witness, for a hand h with the negated invariant: the site's budget is used up, by requests that all asked.
  val exhausted = counts.get(SITE) == CAP_SITE and RUNS.filter(r => runs.get(r).asked).size() == CAP_SITE
  val neverExhausted = not(exhausted)
}

module budget { import suggestionBudget(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module budgetUnguardedVisitor { import suggestionBudget(MUTANT = "unguarded-visitor").* }
module budgetUnguardedSite { import suggestionBudget(MUTANT = "unguarded-site").* }
module budgetReadThenWrite { import suggestionBudget(MUTANT = "read-then-write").* }
module budgetIgnoreRefusal { import suggestionBudget(MUTANT = "ignore-refusal").* }
