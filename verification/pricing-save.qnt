// Quint model of saving the owner's pricing reference from /owner/pricing (docs/plans/2026-11-offer-board.md, section 4).
// The page has two forms, the values (day value and contingency) and the market research, and each save replaces one
// part of a single stored record. A save names the version its page last saw and is refused when another save came in
// since. The owner may have two tabs open; saves overlap.
// Code modelled:
//   load:  src/pages/owner/pricing.astro (the page reads the record) and src/scripts/owner-pricing.ts (a saved form takes
//          the new version, so the next save from the same page is not refused)
//   save:  src/pages/api/owner/pricing.ts with src/server/rules/pricing.ts `savePricing` and src/server/pricing-store.ts
// The module that must keep every property (`pricing`) is the intended design: the version is checked and the record
// written in one step against the latest record (a compare-and-set, which D1 gives and KV does not). The code today keeps
// the record in KV, whose reads may be up to about a minute old and whose read and write are separate steps: that is the
// `pricingTodayKv` mutant, and the properties it breaks are what today's code allows (docs/verification.md, "The
// pricing-save model"). Moving the record to D1 is the owner's decision; until then this model describes the intended code.
// What is left out, on purpose: the contents of a part (a part is the number of the save that wrote it), the reload a new
// research file triggers, and KV failures (a failed save writes nothing).
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module pricingSaveModel {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-version-check"  a save is written without comparing versions
  //   "split-read-write"  the record is read, then written in a later step (a save in between is overwritten)
  //   "stale-read"        the version is compared against a record that may be up to a few saves old
  //   "today-kv"          both: the code as it is today, on KV
  //   "parallel-saves"    a page sends a second save before the first answers, carrying the version the first replaces
  //                       (the second review: Save the values, then the research, from one tab)
  const MUTANT: str

  // The stored record, and which page wrote this version (0: none yet).
  type Record = { version: int, values: int, market: int, by: int }
  type Page = { version: int, values: int, market: int }
  // A save as sent: its page, form, value and the version its page had when Save was pressed.
  type Req = { page: int, part: str, value: int, version: int, phase: str, base: Record }

  val PAGES = Set(1, 2)
  val MAXSAVES = 4
  // How many saves back a stale read may return (KV caches a read for up to about a minute).
  val LAG = 2

  var stored: Record
  // Every record written, newest last: what a stale read may return.
  var written: List[Record]
  var pages: int -> Page
  var reqs: int -> Req
  var saves: int
  // Ghosts.
  var blindOverwrite: bool
  var otherPartLost: bool
  var falseConflict: bool

  pure val empty: Record = { version: 0, values: 0, market: 0, by: 0 }

  action init = all {
    stored' = empty,
    written' = List(empty),
    pages' = PAGES.mapBy(p => { version: 0, values: 0, market: 0 }),
    reqs' = Map(),
    saves' = 0,
    blindOverwrite' = false,
    otherPartLost' = false,
    falseConflict' = false,
  }

  // The records a read may return: the latest, or with a stale read one of the last LAG written.
  def readable: Set[Record] = {
    val stale = MUTANT == "stale-read" or MUTANT == "today-kv"
    val n = written.length()
    if (stale) 0.to(n - 1).filter(i => i >= n - 1 - LAG).map(i => written[i]) else Set(stored)
  }

  action unchangedGhosts = all {
    blindOverwrite' = blindOverwrite, otherPartLost' = otherPartLost, falseConflict' = falseConflict,
  }

  // The owner opens or reloads a page.
  action load = {
    nondet p = PAGES.oneOf()
    nondet r = readable.oneOf()
    all {
      pages' = pages.set(p, { version: r.version, values: r.values, market: r.market }),
      stored' = stored, written' = written, reqs' = reqs, saves' = saves, unchangedGhosts,
    }
  }

  // The owner presses Save on one form; the save's value is its number. A page sends one save at a time
  // (src/scripts/owner-pricing.ts: every Save button waits while one is on its way).
  def busy(p: int): bool = reqs.keys().exists(k => reqs.get(k).page == p and Set("read", "write").contains(reqs.get(k).phase))
  action press = {
    nondet p = PAGES.oneOf()
    nondet part = Set("values", "market").oneOf()
    all {
      saves < MAXSAVES,
      MUTANT == "parallel-saves" or not(busy(p)),
      reqs' = reqs.put(saves + 1, {
        page: p, part: part, value: saves + 1, version: pages.get(p).version, phase: "read", base: empty,
      }),
      saves' = saves + 1,
      stored' = stored, written' = written, pages' = pages, unchangedGhosts,
    }
  }

  pure def withPart(r: Record, part: str, value: int): Record =
    if (part == "values") { ...r, version: r.version + 1, values: value } else { ...r, version: r.version + 1, market: value }

  // The write: the record read, with this save's part, at the next version. The page takes the new version and part.
  action write(id: int, base: Record): bool = {
    val q = reqs.get(id)
    val saved = { ...withPart(base, q.part, q.value), by: q.page }
    val page = pages.get(q.page)
    all {
      stored' = saved,
      written' = written.append(saved),
      pages' = pages.set(q.page, if (q.part == "values") { ...page, version: saved.version, values: q.value }
        else { ...page, version: saved.version, market: q.value }),
      reqs' = reqs.set(id, { ...q, phase: "saved" }),
      saves' = saves,
      // The save was sent from a view older than the latest save, yet it replaced it.
      blindOverwrite' = (blindOverwrite or q.version != stored.version),
      // The other form's part went back to an older value.
      otherPartLost' = (otherPartLost
        or (q.part == "values" and saved.market != stored.market)
        or (q.part == "market" and saved.values != stored.values)),
      falseConflict' = falseConflict,
    }
  }

  action refuse(id: int): bool = {
    val q = reqs.get(id)
    all {
      reqs' = reqs.set(id, { ...q, phase: "refused" }),
      stored' = stored, written' = written, pages' = pages, saves' = saves,
      blindOverwrite' = blindOverwrite, otherPartLost' = otherPartLost,
      // Refused, though every save since the version it was sent with came from its own page.
      falseConflict' = (falseConflict
        or written.foldl(true, (only, w) => only and (w.version <= q.version or w.by == q.page))),
    }
  }

  // The route reads the record and compares versions; in the design it also writes in the same step.
  action read = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "read").oneOf()
    nondet r = readable.oneOf()
    val q = reqs.get(id)
    val same = MUTANT == "no-version-check" or r.version == q.version
    val split = MUTANT == "split-read-write" or MUTANT == "today-kv"
    if (not(same)) refuse(id)
    else if (split) all {
      reqs' = reqs.set(id, { ...q, phase: "write", base: r }),
      stored' = stored, written' = written, pages' = pages, saves' = saves, unchangedGhosts,
    }
    else write(id, r)
  }

  // The later write of a split save, from the record it read.
  action laterWrite = {
    nondet id = reqs.keys().filter(k => reqs.get(k).phase == "write").oneOf()
    write(id, reqs.get(id).base)
  }

  action step = any { load, press, read, laterWrite }

  // For the Apalache check only (`--step stepOrEnd`).
  action finished = all {
    stored' = stored, written' = written, pages' = pages, reqs' = reqs, saves' = saves, unchangedGhosts,
  }
  action stepOrEnd = any { step, finished }

  // ---- Properties -----------------------------------------------------------------------------------------------------
  // 1. A save never replaces a save its page had not seen (another tab's is refused, and the owner reloads).
  val noBlindOverwrite = not(blindOverwrite)

  // 2. Saving one form never puts the other form's part back to an older value.
  val otherPartKept = not(otherPartLost)

  // 3. A save is refused only when another save really came in since its page last saw the record.
  val noFalseConflict = not(falseConflict)

  val allProperties = and { noBlindOverwrite, otherPartKept, noFalseConflict }

  // Reachability witness: both forms saved, from two pages.
  val bothPartsSaved = stored.values > 0 and stored.market > 0
  val neverBothPartsSaved = not(bothPartsSaved)
}

module pricing { import pricingSaveModel(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module pricingNoVersionCheck { import pricingSaveModel(MUTANT = "no-version-check").* }
module pricingSplitReadWrite { import pricingSaveModel(MUTANT = "split-read-write").* }
module pricingStaleRead { import pricingSaveModel(MUTANT = "stale-read").* }
module pricingTodayKv { import pricingSaveModel(MUTANT = "today-kv").* }
module pricingParallelSaves { import pricingSaveModel(MUTANT = "parallel-saves").* }
