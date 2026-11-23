// Quint model of refreshing the market research (docs/plans/2026-11-market-refresh.md). A daily run searches when the
// owner asked or the research is old, and saves a proposal; the owner uses or discards a proposal from /owner/pricing.
// Code modelled:
//   ask:      src/pages/api/owner/pricing.ts, action "ask-refresh" (stores the time of the ask)
//   run:      src/server/flows/market-refresh.ts (reads the ask when it starts; saves the proposal, which replaces older
//             ones, then clears the ask only if it was made before the run started)
//   load:     src/pages/owner/pricing.astro (shows the newest proposal and its id)
//   accept:   action "accept-proposal" (the proposal the page showed, by its id, through the versioned save; then that id
//             is removed)
//   discard:  action "discard-proposal" (removes that id only)
// The module that must keep every property (`refresh`) is the design. What is left out, on purpose: whether a run
// searches (the rule in src/server/rules/market-refresh.ts decides from facts read first, and any run may search here),
// the versioned save itself (verification/pricing-save.qnt), search failures (a failed run saves nothing), and KV's
// delay (a read a few seconds old moves an ask to the next day's run).
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module marketRefreshModel {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "clear-any-ask"  a run clears the ask even when it was made after the run started
  //   "discard-all"    Discard removes every stored proposal, not only the one the page showed
  //   "accept-latest"  Use these figures takes the newest stored proposal, not the one the page showed
  const MUTANT: str

  // A run: when it started (the clock tick), and whether it has saved yet.
  type Run = { startedAt: int, phase: str }

  val PAGES = Set(1, 2)
  val MAXCLOCK = 7

  // The clock ticks once for each ask, run start and save; a proposal's id is the tick it was saved at.
  var clock: int
  // When the waiting ask was made (0: none).
  var askedAt: int
  var runs: int -> Run
  var nextRun: int
  // The ids of the stored proposals.
  var proposals: Set[int]
  // The proposal whose figures the research holds (0: the research imported by hand).
  var research: int
  // The proposal each page shows (0: none).
  var shown: int -> int
  // Ghosts.
  var askLost: bool
  var newerRemoved: bool
  var unseenAccepted: bool

  pure def newest(ids: Set[int]): int = ids.fold(0, (a, b) => if (b > a) b else a)

  action init = all {
    clock' = 0,
    askedAt' = 0,
    runs' = Map(),
    nextRun' = 1,
    proposals' = Set(),
    research' = 0,
    shown' = PAGES.mapBy(_ => 0),
    askLost' = false,
    newerRemoved' = false,
    unseenAccepted' = false,
  }

  action unchangedGhosts = all {
    askLost' = askLost,
    newerRemoved' = newerRemoved,
    unseenAccepted' = unseenAccepted,
  }

  // The owner presses Search for new figures.
  action ask = all {
    clock < MAXCLOCK,
    clock' = clock + 1,
    askedAt' = clock + 1,
    runs' = runs,
    nextRun' = nextRun,
    proposals' = proposals,
    research' = research,
    shown' = shown,
    unchangedGhosts,
  }

  // A daily run starts.
  action start = all {
    clock < MAXCLOCK,
    clock' = clock + 1,
    askedAt' = askedAt,
    runs' = runs.put(nextRun, { startedAt: clock + 1, phase: "searching" }),
    nextRun' = nextRun + 1,
    proposals' = proposals,
    research' = research,
    shown' = shown,
    unchangedGhosts,
  }

  // A run saves its proposal, which replaces the older ones, and clears the ask.
  action save = {
    nondet id = runs.keys().filter(k => runs.get(k).phase == "searching").oneOf()
    val job = runs.get(id)
    // The design clears only an ask made before the run started: a later one waits for the next run.
    val kept = if (MUTANT == "clear-any-ask" or askedAt <= job.startedAt) 0 else askedAt
    all {
      clock < MAXCLOCK,
      clock' = clock + 1,
      askedAt' = kept,
      runs' = runs.set(id, { ...job, phase: "saved" }),
      nextRun' = nextRun,
      proposals' = Set(clock + 1),
      research' = research,
      shown' = shown,
      askLost' = (askLost or (askedAt > job.startedAt and kept == 0)),
      newerRemoved' = newerRemoved,
      unseenAccepted' = unseenAccepted,
    }
  }

  // A page loads and shows the newest stored proposal.
  action load = {
    nondet page = PAGES.oneOf()
    all {
      clock' = clock,
      askedAt' = askedAt,
      runs' = runs,
      nextRun' = nextRun,
      proposals' = proposals,
      research' = research,
      shown' = shown.set(page, newest(proposals)),
      unchangedGhosts,
    }
  }

  // Use these figures: the route refuses a proposal that is no longer stored (a newer search replaced it).
  action accept = {
    nondet page = PAGES.filter(p => shown.get(p) > 0).oneOf()
    val seen = shown.get(page)
    val taken = if (MUTANT == "accept-latest") newest(proposals) else seen
    all {
      proposals.contains(taken),
      clock' = clock,
      askedAt' = askedAt,
      runs' = runs,
      nextRun' = nextRun,
      proposals' = proposals.exclude(Set(taken)),
      research' = taken,
      shown' = shown.set(page, 0),
      askLost' = askLost,
      newerRemoved' = (newerRemoved or taken > seen),
      unseenAccepted' = (unseenAccepted or taken != seen),
    }
  }

  // Discard: removes the proposal the page showed.
  action discard = {
    nondet page = PAGES.filter(p => shown.get(p) > 0).oneOf()
    val seen = shown.get(page)
    val removed = if (MUTANT == "discard-all") proposals else proposals.filter(p => p == seen)
    all {
      clock' = clock,
      askedAt' = askedAt,
      runs' = runs,
      nextRun' = nextRun,
      proposals' = proposals.exclude(removed),
      research' = research,
      shown' = shown.set(page, 0),
      askLost' = askLost,
      newerRemoved' = (newerRemoved or removed.exists(p => p > seen)),
      unseenAccepted' = unseenAccepted,
    }
  }

  action step = any { ask, start, save, load, accept, discard }

  // For the Apalache check only (`--step stepOrEnd`).
  action finished = all {
    clock' = clock,
    askedAt' = askedAt,
    runs' = runs,
    nextRun' = nextRun,
    proposals' = proposals,
    research' = research,
    shown' = shown,
    unchangedGhosts,
  }
  action stepOrEnd = any { step, finished }

  // ---- Properties -----------------------------------------------------------------------------------------------------
  // 1. An ask made while a run is going is not cleared by that run: a later run serves it.
  val askNeverLost = not(askLost)

  // 2. Using or discarding a proposal never removes one newer than the page showed.
  val newerKept = not(newerRemoved)

  // 3. The research only ever takes figures the owner was shown.
  val acceptedWasShown = not(unseenAccepted)

  val allProperties = and { askNeverLost, newerKept, acceptedWasShown }

  // Reachability witness: a proposal was used.
  val proposalUsed = research > 0
  val neverUsed = not(proposalUsed)
}

module refresh { import marketRefreshModel(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module refreshClearAnyAsk { import marketRefreshModel(MUTANT = "clear-any-ask").* }
module refreshDiscardAll { import marketRefreshModel(MUTANT = "discard-all").* }
module refreshAcceptLatest { import marketRefreshModel(MUTANT = "accept-latest").* }
