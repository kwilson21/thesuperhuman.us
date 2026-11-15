// Quint model of the agreement archive link (POST /api/agreements/link) and of the single redeem of the link it sends
// (GET/POST /agreements/verify, which completes it), for requests that arrive at once. Written for the conversion of the
// agreement routes (branch effect-13-agreement-access).
// Code modelled, step for step as the code reads and writes:
//   the cooldown:   src/server/flows/agreement-link.ts: read the address's cooldown row (one step), the rule judges it at
//                   the request's instant `at`, then a compare-and-set on the row (a second step) that re-checks the same
//                   condition against the row as it is then. A lost set reads and judges again, three tries in all, and the retry keeps the request's first instant (`cooling`).
//   the lookup:     readLinkFacts: the address's agreements and its links, read in ONE batch (one step, one snapshot). The
//                   rule has nothing to do for an address with no executed agreement, and refuses with the cooldown's
//                   sentence when a link was issued inside the window.
//   the link batch: storeArchiveLink: one batch (one step) whose first statement is the guard "no link for this address
//                   issued in the window before `at`", then the insert. A lost guard reads again, three tries in all (a counter of its own), and the retry keeps the first attempt's `at`. The
//                   batch does NOT re-check the agreement's status: see `issuedStillExecuted`.
//   the redeem:     src/lib/agreement-access.ts completeAgreementLink: a READ of the link as unused and unexpired at the
//                   instant `at` (one step), then a guarded batch (a second step) that consumes it while it is still
//                   unused. The expiry is judged once, at the read's `at`: the batch repeats the clause with the same `at`,
//                   and an expiry never moves, so time passing between the two steps does not matter; a redeem that began
//                   before the expiry completes (its session starts at `at`).
// What is left out, on purpose: the allowances (they count per address and answer 429 before any of these steps), the mail
// (its outcome only decides whether older links are consumed, which does not change a property below), and the answer
// text, which is one receipt for every address.
//
// The properties are invariants over the real state (the stored links and cooldowns, how often and when each link was
// redeemed), not flags set by a step. `issuedStillExecuted` is NOT in `allProperties`: it is a finding, kept as a named value so it can be run by
// hand (docs/verification.md, "The agreement-link model").
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module agreementLinkProtocol {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-guard"          the link batch's guard is not checked: a second link for an address within the window is stored
  //   "split-guard"       the guard is read in one step and the insert done in a later one, so another request can store in
  //                       between (the code before the batch: two D1 calls)
  //   "no-lookup"         a link is issued without reading whether the address has an executed agreement
  //   "redeem-no-guard"   the redeem's batch does not check the link is still unused: two redeems that both read it unused
  //                       both consume it
  //   "redeem-no-expiry"  neither the redeem's read nor its batch checks the expiry
  //   "no-cas"            the cooldown's compare-and-set does not re-check the row: two requests that both read it free both take it
  //   "retry-new-cool"    a cooldown retry takes a new instant instead of keeping its first
  //   "retry-new-at"      a link retry takes a new instant instead of keeping its first
  const MUTANT: str

  val WINDOW = 2
  val EXPIRY = 3
  val TMAX = 5
  val TRIES = 3
  val RUNS = 1.to(3)
  val REDEEMERS = 1.to(2)
  val EMAILS = 1.to(2)
  // Address 1 starts with an executed agreement; address 2 has none. `executed` changes for address 1 (the finding).
  pure def startsExecuted(e: int): bool = e == 1

  // A stored link: the request that stored it (its id), the address, when it was issued, when it expires, and whether the
  // agreement was still executed when it was stored.
  type Link = { id: int, email: int, issued: int, expires: int, executedAtStore: bool }

  // A taken cooldown: the request that took it, the address, and the instant it was taken at.
  type Take = { by: int, email: int, at: int }

  // A request: its phase ("none", "asked", "coolChecked", "cooled", "found", "checked", "done"), its address, `cool` (the
  // instant of its first cooldown read, -1 before it), `at` (the instant of its first lookup, -1 before it; both are kept
  // across retries), whether the lookup found an executed agreement (as read), whether the split guard passed, the tries
  // of the cooldown loop and of the link loop (three each), and how it ended.
  type Run = { phase: str, email: int, cool: int, at: int, found: bool, guardOk: bool, coolTries: int, tries: int, outcome: str }

  // A redeem: its phase ("none", "read", "done"), the link it read, and the instant `at` of the read.
  type Redeem = { phase: str, link: int, at: int }

  var now: int
  var links: Set[Link]
  var takes: Set[Take]
  var coolAt: int -> int
  // How many times each link was consumed, and the instant of the read of the redeem that last consumed it (-1 for none).
  var redeems: int -> int
  var redeemedAt: int -> int
  var runs: int -> Run
  var rd: int -> Redeem
  var executed: int -> bool

  val idle = { phase: "none", email: 0, cool: -1, at: -1, found: false, guardOk: false, coolTries: 0, tries: 0, outcome: "none" }
  val idleRedeem = { phase: "none", link: 0, at: 0 }

  // The guard the batch checks: no link for this address was issued within the window before `t`.
  pure def windowFree(ls: Set[Link], e: int, t: int): bool =
    not(ls.exists(l => l.email == e and l.issued > t - WINDOW))

  // The search for "retry-new-at" needs a long, exact interleaving of two issue requests and the clock (a lost guard, then a later
  // retry), so it leaves out the steps that cannot take part in it: the redeems and the agreement ending.
  val onlyIssue = MUTANT == "retry-new-at"

  pure def apart(a: int, b: int): bool = (a - b >= WINDOW) or (b - a >= WINDOW)

  action init = all {
    now' = 0,
    links' = Set(),
    takes' = Set(),
    coolAt' = EMAILS.mapBy(e => -100),
    redeems' = RUNS.mapBy(l => 0),
    redeemedAt' = RUNS.mapBy(l => -1),
    runs' = RUNS.mapBy(r => idle),
    rd' = REDEEMERS.mapBy(r => idleRedeem),
    executed' = EMAILS.mapBy(e => startsExecuted(e)),
  }

  // Time passes.
  action tick = {
    all {
      now < TMAX,
      now' = now + 1,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs,
      rd' = rd,
      executed' = executed,
    }
  }

  // The address's executed agreement stops being executed (retention can delete an executed agreement; see the record).
  action agreementEnds = {
    all {
      not(onlyIssue),
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs,
      rd' = rd,
      executed' = executed.set(1, false),
    }
  }

  // A client asks for a link for an address.
  action ask = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet e = EMAILS.oneOf()
    all {
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, { ...idle, phase: "asked", email: e }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The cooldown, step 1: read the address's row; the rule judges it at this request's first instant (a retry keeps it). A running window is answered at once.
  action coolRead = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "asked").oneOf()
    val h = runs.get(r)
    val cool = if (h.cool < 0 or MUTANT == "retry-new-cool") now else h.cool
    val free = coolAt.get(h.email) + WINDOW <= cool
    all {
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, if (free) { ...h, phase: "coolChecked", cool: cool } else { ...h, phase: "done", cool: cool, outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The cooldown, step 2: the compare-and-set re-checks the condition against the row as it is now. A lost set reads again (three tries).
  action coolWrite = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "coolChecked").oneOf()
    val h = runs.get(r)
    val cas = MUTANT == "no-cas" or coolAt.get(h.email) + WINDOW <= h.cool
    val retry = not(cas) and h.coolTries + 1 < TRIES
    all {
      now' = now,
      links' = links,
      takes' = if (cas) takes.union(Set({ by: r, email: h.email, at: h.cool })) else takes,
      coolAt' = if (cas) coolAt.set(h.email, h.cool) else coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, if (cas) { ...h, phase: "cooled" } else if (retry) { ...h, phase: "asked", coolTries: h.coolTries + 1 } else { ...h, phase: "done", outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The lookup: the agreements and the links of the address, read in one step. No executed agreement: nothing to do. A link inside the window: the cooldown's refusal. The instant `at` is the first attempt's and is kept by a retry.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "cooled").oneOf()
    val h = runs.get(r)
    val at = if (h.at < 0 or MUTANT == "retry-new-at") now else h.at
    val found = executed.get(h.email)
    val blocked = not(windowFree(links, h.email, at))
    val proceeds = (found or MUTANT == "no-lookup")
    all {
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, if (not(proceeds)) { ...h, phase: "done", at: at, outcome: "nothingToDo" } else if (blocked and MUTANT != "no-guard") { ...h, phase: "done", at: at, outcome: "cooling", found: found } else { ...h, phase: "found", found: found, at: at }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The link batch, as one step: the guard and the insert together. A lost guard reads again (three tries).
  action storeLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    val guardOk = MUTANT == "no-guard" or windowFree(links, h.email, h.at)
    val retry = not(guardOk) and h.tries + 1 < TRIES
    val newLink = { id: r, email: h.email, issued: h.at, expires: h.at + EXPIRY, executedAtStore: executed.get(h.email) }
    all {
      now' = now,
      links' = if (guardOk) links.union(Set(newLink)) else links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, if (guardOk) { ...h, phase: "done", outcome: "stored" } else if (retry) { ...h, phase: "cooled", tries: h.tries + 1 } else { ...h, phase: "done", outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The split guard (the mutant): the guard is read first ...
  action checkGuard = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    all {
      MUTANT == "split-guard",
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, { ...h, phase: "checked", guardOk: windowFree(links, h.email, h.at) }),
      rd' = rd,
      executed' = executed,
    }
  }

  // ... and the insert in a later step, when the guard said so.
  action insertLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "checked").oneOf()
    val h = runs.get(r)
    val newLink = { id: r, email: h.email, issued: h.at, expires: h.at + EXPIRY, executedAtStore: executed.get(h.email) }
    all {
      MUTANT == "split-guard",
      now' = now,
      links' = if (h.guardOk) links.union(Set(newLink)) else links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs.set(r, { ...h, phase: "done", outcome: if (h.guardOk) "stored" else "cooling" }),
      rd' = rd,
      executed' = executed,
    }
  }

  // The redeem, step 1: read a stored link as unused and unexpired at this instant.
  action redeemRead = {
    nondet q = REDEEMERS.filter(i => rd.get(i).phase == "none").oneOf()
    nondet l = links.oneOf()
    val usable = redeems.get(l.id) == 0 and (now < l.expires or MUTANT == "redeem-no-expiry")
    all {
      not(onlyIssue),
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = redeems,
      redeemedAt' = redeemedAt,
      runs' = runs,
      rd' = rd.set(q, if (usable) { phase: "read", link: l.id, at: now } else { ...idleRedeem, phase: "done" }),
      executed' = executed,
    }
  }

  // The redeem, step 2: the batch consumes the link while it is still unused (and, with the same instant, unexpired).
  action redeemWrite = {
    nondet q = REDEEMERS.filter(i => rd.get(i).phase == "read").oneOf()
    val h = rd.get(q)
    val guardOk = redeems.get(h.link) == 0 or MUTANT == "redeem-no-guard"
    all {
      not(onlyIssue),
      now' = now,
      links' = links,
      takes' = takes,
      coolAt' = coolAt,
      redeems' = if (guardOk) redeems.set(h.link, redeems.get(h.link) + 1) else redeems,
      redeemedAt' = if (guardOk) redeemedAt.set(h.link, h.at) else redeemedAt,
      runs' = runs,
      rd' = rd.set(q, { ...h, phase: "done" }),
      executed' = executed,
    }
  }

  action step = any {
    tick, agreementEnds, ask, coolRead, coolWrite, lookup, storeLink, checkGuard, insertLink, redeemRead, redeemWrite,
  }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is.
  action finished = all {
    now' = now, links' = links, takes' = takes, coolAt' = coolAt, redeems' = redeems, redeemedAt' = redeemedAt,
    runs' = runs, rd' = rd, executed' = executed,
  }
  action stepOrEnd = any { step, finished }

  // ---- Properties: invariants over the real state ---------------------------------------------------------------------
  // 1. No two stored links for one address were issued less than the window apart.
  val oneIssuePerWindow = links.forall(a => links.forall(b => a.id == b.id or a.email != b.email or apart(a.issued, b.issued)))

  // 2. Only an address that started with an executed agreement has a link (address 1; address 2 never does). This reads the
  // starting state, so it still holds for an address whose agreement ends later; `issuedStillExecuted` is the finding about that.
  val issuedOnlyWithAgreement = links.forall(l => startsExecuted(l.email))

  // 3. A link is consumed at most once.
  val redeemedOnce = RUNS.forall(l => redeems.get(l) <= 1)

  // 4. A link is consumed only by a redeem whose read was before its expiry.
  val redeemedUnexpired = links.forall(l => redeemedAt.get(l.id) < l.expires)

  // 5. No two cooldowns for one address were taken less than the window apart.
  val oneCooldownPerWindow = takes.forall(a => takes.forall(b => a.by == b.by or a.email != b.email or apart(a.at, b.at)))

  // 6. A request that lost its cooldown compare-and-set never takes a cooldown. A retry keeps the request's first instant, so
  // the row that beat it still beats it; a retry that took a new instant would succeed.
  val lostCooldownNeverTakes = takes.forall(t => runs.get(t.by).coolTries == 0)

  // 7. A request that lost the link batch's guard never stores a link, for the same reason.
  val lostGuardNeverStores = links.forall(l => runs.get(l.id).tries == 0)

  // The finding, NOT in allProperties: a link was issued only while the agreement was still executed at the batch. The
  // batch does not re-check the status, so a link can be issued for an agreement that stopped being executed after the
  // lookup (see docs/verification.md); run it by hand to see it.
  val issuedStillExecuted = links.forall(l => l.executedAtStore)

  val allProperties = and {
    oneIssuePerWindow, issuedOnlyWithAgreement, redeemedOnce, redeemedUnexpired,
    oneCooldownPerWindow, lostCooldownNeverTakes, lostGuardNeverStores,
  }
}

module agreementLink { import agreementLinkProtocol(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module agreementLinkNoGuard { import agreementLinkProtocol(MUTANT = "no-guard").* }
module agreementLinkSplitGuard { import agreementLinkProtocol(MUTANT = "split-guard").* }
module agreementLinkNoLookup { import agreementLinkProtocol(MUTANT = "no-lookup").* }
module agreementLinkRedeemNoGuard { import agreementLinkProtocol(MUTANT = "redeem-no-guard").* }
module agreementLinkRedeemNoExpiry { import agreementLinkProtocol(MUTANT = "redeem-no-expiry").* }
module agreementLinkNoCas { import agreementLinkProtocol(MUTANT = "no-cas").* }
module agreementLinkRetryNewCool { import agreementLinkProtocol(MUTANT = "retry-new-cool").* }
module agreementLinkRetryNewAt { import agreementLinkProtocol(MUTANT = "retry-new-at").* }
