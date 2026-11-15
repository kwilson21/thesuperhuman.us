// Quint model of the agreement archive link (POST /api/agreements/link) and of the single redeem of the link it sends
// (GET/POST /agreements/verify, which completes it), for requests that arrive at once. Written for the conversion of the
// agreement routes (branch effect-13-agreement-access).
// Code modelled, step for step as the code reads and writes:
//   the cooldown:   src/server/flows/agreement-link.ts: read the address's cooldown row (one step), the rule judges it at
//                   the request's instant `at`, then a compare-and-set on the row (a second step) that re-checks the same
//                   condition against the row as it is then. A lost set reads and judges again, three tries in all.
//   the lookup:     readLinkFacts: the address's agreements and its links, read in ONE batch (one step, one snapshot). The
//                   rule has nothing to do for an address with no executed agreement, and refuses with the cooldown's
//                   sentence when a link was issued inside the window.
//   the link batch: storeArchiveLink: one batch (one step) whose first statement is the guard "no link for this address
//                   issued in the window before `at`", then the insert. A lost guard reads again, three tries in all. The
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
// Ghost flags are set from what was true at the step that reads (the lookup's read, the redeem's read) or from the real
// state at the write, never from the mutant. `issuedStillExecuted` is NOT in `allProperties`: it is a finding, kept as a
// named value so it can be run by hand (docs/verification.md, "The agreement-link model").
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

  // A stored link: the request that stored it (its id), the address, when it was issued, and when it expires.
  type Link = { id: int, email: int, issued: int, expires: int }

  // A request: its phase ("none", "asked", "coolChecked", "cooled", "found", "checked", "done"), its address, the instant
  // `at` it judges at, whether the lookup found an executed agreement (as read), whether the split guard passed, how many
  // tries it has used, and how it ended.
  type Run = { phase: str, email: int, at: int, found: bool, guardOk: bool, tries: int, outcome: str }

  // A redeem: its phase ("none", "read", "done"), the link it read, the instant `at` of the read, and whether the link was
  // already past its expiry at that instant (what was true at the read).
  type Redeem = { phase: str, link: int, at: int, expiredAtRead: bool }

  var now: int
  var links: Set[Link]
  var coolAt: int -> int
  var redeems: int -> int
  var runs: int -> Run
  var rd: int -> Redeem
  var executed: int -> bool
  var doubleIssue: bool
  var issuedWithoutAgreement: bool
  var issuedAfterEnd: bool
  var doubleRedeem: bool
  var redeemedLate: bool

  val idle = { phase: "none", email: 0, at: 0, found: false, guardOk: false, tries: 0, outcome: "none" }
  val idleRedeem = { phase: "none", link: 0, at: 0, expiredAtRead: false }

  // The guard the batch checks: no link for this address was issued within the window before `t`.
  pure def windowFree(ls: Set[Link], e: int, t: int): bool =
    not(ls.exists(l => l.email == e and l.issued > t - WINDOW))

  action init = all {
    now' = 0,
    links' = Set(),
    coolAt' = EMAILS.mapBy(e => -100),
    redeems' = RUNS.mapBy(l => 0),
    runs' = RUNS.mapBy(r => idle),
    rd' = REDEEMERS.mapBy(r => idleRedeem),
    executed' = EMAILS.mapBy(e => startsExecuted(e)),
    doubleIssue' = (false),
    issuedWithoutAgreement' = (false),
    issuedAfterEnd' = (false),
    doubleRedeem' = (false),
    redeemedLate' = (false),
  }

  // Time passes.
  action tick = {
    all {
      now < TMAX,
      now' = now + 1,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs,
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The address's executed agreement stops being executed (the code never does this today: an executed agreement only moves forward).
  action agreementEnds = {
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs,
      rd' = rd,
      executed' = executed.set(1, false),
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // A client asks for a link for an address.
  action ask = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet e = EMAILS.oneOf()
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, { ...idle, phase: "asked", email: e }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The cooldown, step 1: read the address's row; the rule judges it at this request's instant. A running window is answered at once.
  action coolRead = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "asked").oneOf()
    val h = runs.get(r)
    val free = now >= coolAt.get(h.email) + WINDOW
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (free) { ...h, phase: "coolChecked", at: now } else { ...h, phase: "done", outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The cooldown, step 2: the compare-and-set re-checks the condition against the row as it is now. A lost set reads again (three tries).
  action coolWrite = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "coolChecked").oneOf()
    val h = runs.get(r)
    val cas = coolAt.get(h.email) + WINDOW <= h.at
    val retry = not(cas) and h.tries + 1 < TRIES
    all {
      now' = now,
      links' = links,
      coolAt' = if (cas) coolAt.set(h.email, h.at) else coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (cas) { ...h, phase: "cooled" } else if (retry) { ...h, phase: "asked", tries: h.tries + 1 } else { ...h, phase: "done", outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The lookup: the agreements and the links of the address, read in one step. No executed agreement: nothing to do. A link inside the window: the cooldown's refusal.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "cooled").oneOf()
    val h = runs.get(r)
    val found = executed.get(h.email)
    val blocked = not(windowFree(links, h.email, now))
    val proceeds = (found or MUTANT == "no-lookup")
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (not(proceeds)) { ...h, phase: "done", outcome: "nothingToDo" } else if (blocked and MUTANT != "no-guard") { ...h, phase: "done", outcome: "cooling", found: found } else { ...h, phase: "found", found: found, at: now }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The link batch, as one step: the guard and the insert together. A lost guard reads again (three tries).
  action storeLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    val guardOk = MUTANT == "no-guard" or windowFree(links, h.email, h.at)
    val retry = not(guardOk) and h.tries + 1 < TRIES
    val newLink = { id: r, email: h.email, issued: h.at, expires: h.at + EXPIRY }
    all {
      now' = now,
      links' = if (guardOk) links.union(Set(newLink)) else links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (guardOk) { ...h, phase: "done", outcome: "stored" } else if (retry) { ...h, phase: "cooled", tries: h.tries + 1 } else { ...h, phase: "done", outcome: "cooling" }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue or (guardOk and not(windowFree(links, h.email, h.at)))),
      issuedWithoutAgreement' = (issuedWithoutAgreement or (guardOk and not(h.found))),
      issuedAfterEnd' = (issuedAfterEnd or (guardOk and not(executed.get(h.email)))),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
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
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, { ...h, phase: "checked", guardOk: windowFree(links, h.email, h.at) }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // ... and the insert in a later step, when the guard said so.
  action insertLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "checked").oneOf()
    val h = runs.get(r)
    val newLink = { id: r, email: h.email, issued: h.at, expires: h.at + EXPIRY }
    all {
      MUTANT == "split-guard",
      now' = now,
      links' = if (h.guardOk) links.union(Set(newLink)) else links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, { ...h, phase: "done", outcome: if (h.guardOk) "stored" else "cooling" }),
      rd' = rd,
      executed' = executed,
      doubleIssue' = (doubleIssue or (h.guardOk and not(windowFree(links, h.email, h.at)))),
      issuedWithoutAgreement' = (issuedWithoutAgreement or (h.guardOk and not(h.found))),
      issuedAfterEnd' = (issuedAfterEnd or (h.guardOk and not(executed.get(h.email)))),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The redeem, step 1: read a stored link as unused and unexpired at this instant. Whether it was already expired is recorded as it was at this read.
  action redeemRead = {
    nondet q = REDEEMERS.filter(i => rd.get(i).phase == "none").oneOf()
    nondet l = links.oneOf()
    val usable = redeems.get(l.id) == 0 and (now < l.expires or MUTANT == "redeem-no-expiry")
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs,
      rd' = rd.set(q, if (usable) { phase: "read", link: l.id, at: now, expiredAtRead: now >= l.expires } else { ...idleRedeem, phase: "done" }),
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The redeem, step 2: the batch consumes the link while it is still unused (and, with the same instant, unexpired).
  action redeemWrite = {
    nondet q = REDEEMERS.filter(i => rd.get(i).phase == "read").oneOf()
    val h = rd.get(q)
    val stillUnused = redeems.get(h.link) == 0
    val guardOk = stillUnused or MUTANT == "redeem-no-guard"
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = if (guardOk) redeems.set(h.link, redeems.get(h.link) + 1) else redeems,
      runs' = runs,
      rd' = rd.set(q, { ...h, phase: "done" }),
      executed' = executed,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      issuedAfterEnd' = (issuedAfterEnd),
      doubleRedeem' = (doubleRedeem or (guardOk and not(stillUnused))),
      redeemedLate' = (redeemedLate or (guardOk and h.expiredAtRead)),
    }
  }

  action step = any {
    tick, agreementEnds, ask, coolRead, coolWrite, lookup, storeLink, checkGuard, insertLink, redeemRead, redeemWrite,
  }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. Two links for one address are never issued inside the window.
  val oneIssuePerWindow = not(doubleIssue)

  // 2. A link is issued only when the lookup read an executed agreement for the address.
  val issuedOnlyWithAgreement = not(issuedWithoutAgreement)

  // 3. A link is redeemed at most once.
  val redeemedOnce = not(doubleRedeem)

  // 4. A link is redeemed only if it was unexpired at the redeem's read.
  val redeemedUnexpired = not(redeemedLate)

  // The finding, NOT in allProperties: a link is issued only while the agreement is still executed at the batch. The
  // batch does not re-check the status, so a link can be issued for an agreement that stopped being executed after the
  // lookup. The code never moves an agreement out of "executed" today, so this cannot happen yet; run it by hand to see it.
  val issuedStillExecuted = not(issuedAfterEnd)

  val allProperties = and {
    oneIssuePerWindow, issuedOnlyWithAgreement, redeemedOnce, redeemedUnexpired,
  }
}

module agreementLink { import agreementLinkProtocol(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module agreementLinkNoGuard { import agreementLinkProtocol(MUTANT = "no-guard").* }
module agreementLinkSplitGuard { import agreementLinkProtocol(MUTANT = "split-guard").* }
module agreementLinkNoLookup { import agreementLinkProtocol(MUTANT = "no-lookup").* }
module agreementLinkRedeemNoGuard { import agreementLinkProtocol(MUTANT = "redeem-no-guard").* }
module agreementLinkRedeemNoExpiry { import agreementLinkProtocol(MUTANT = "redeem-no-expiry").* }
