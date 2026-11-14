// Quint model of the agreement archive link (POST /api/agreements/link) and of the single redeem of the link it sends
// (GET/POST /agreements/verify, which completes it), for requests that arrive at once. Written for the conversion of the
// agreement routes (branch effect-13-agreement-access).
// Code modelled:
//   the cooldown:        src/server/agreement-store.ts takeCooldown: a compare-and-set on the address's row, taken when
//                        the row is absent or its window has passed (the instant is the request's).
//   the executed lookup: src/server/agreement-store.ts hasExecutedAgreement: a link is issued only for an address with an
//                        executed agreement (src/server/flows/agreement-link.ts; nothing to do otherwise).
//   the link batch:      storeArchiveLink: one batch whose first statement is the guard "no link for this address issued in
//                        the window", then the insert. The batch is one step: no other request stores between the guard
//                        and the insert.
//   the redeem:          src/lib/agreement-access.ts completeAgreementLink: the link is consumed once, and only before its
//                        expiry (a batch guard on the unused row).
// What is left out, on purpose: the allowances (they count per address and answer 429 before any of these steps), the
// mail (its outcome only decides whether older links are consumed, which does not change a property below), and the
// answer text, which is one receipt for every address.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module agreementLinkProtocol {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-guard"      the batch's guard is not checked: a second link for an address within the window is stored
  //   "split-guard"   the guard is read in one step and the insert done in a later one, so another request can store in
  //                   between (the code before the batch: two D1 calls)
  //   "no-lookup"     a link is issued without reading whether the address has an executed agreement
  //   "redeem-twice"  a link may be redeemed again after its first redeem
  //   "redeem-late"   a link may be redeemed after its expiry
  const MUTANT: str

  val WINDOW = 2
  val EXPIRY = 3
  val TMAX = 5
  val RUNS = 1.to(3)
  val EMAILS = 1.to(2)
  // Address 1 has an executed agreement; address 2 has none.
  pure def hasAgreement(e: int): bool = e == 1

  // A stored link: the request that stored it (its id), the address, when it was issued, and when it expires.
  type Link = { id: int, email: int, issued: int, expires: int }

  // A request: its phase ("none", "asked", "cooled", "found", "checked", "done"), its address, whether the lookup found an
  // agreement, whether the split guard passed, and how it ended.
  type Run = { phase: str, email: int, found: bool, guardOk: bool, outcome: str }

  var now: int
  var links: Set[Link]
  var coolAt: int -> int
  var redeems: int -> int
  var runs: int -> Run
  // Ghosts: set from the real state at the moment of the step, never from the mutant.
  var doubleIssue: bool
  var issuedWithoutAgreement: bool
  var doubleRedeem: bool
  var redeemedLate: bool

  val idle = { phase: "none", email: 0, found: false, guardOk: false, outcome: "none" }

  // The guard the batch checks: no link for this address was issued within the window before now.
  pure def windowFree(ls: Set[Link], e: int, t: int): bool =
    not(ls.exists(l => l.email == e and l.issued > t - WINDOW))

  action init = all {
    now' = 0,
    links' = Set(),
    coolAt' = EMAILS.mapBy(e => -100),
    redeems' = RUNS.mapBy(l => 0),
    runs' = RUNS.mapBy(r => idle),
    doubleIssue' = (false),
    issuedWithoutAgreement' = (false),
    doubleRedeem' = (false),
    redeemedLate' = (false),
  }

  // Time passes.
  action tick = all {
    now < TMAX,
    now' = now + 1,
    links' = links,
    coolAt' = coolAt,
    redeems' = redeems,
    runs' = runs,
    doubleIssue' = (doubleIssue),
    issuedWithoutAgreement' = (issuedWithoutAgreement),
    doubleRedeem' = (doubleRedeem),
    redeemedLate' = (redeemedLate),
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
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The cooldown: a compare-and-set on the address's row. A request whose window is still running is answered at once.
  action takeCooldown = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "asked").oneOf()
    val h = runs.get(r)
    val free = now >= coolAt.get(h.email) + WINDOW
    all {
      now' = now,
      links' = links,
      coolAt' = if (free) coolAt.set(h.email, now) else coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (free) { ...h, phase: "cooled" } else { ...h, phase: "done", outcome: "cooling" }),
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The executed lookup: an address with no executed agreement gets its receipt with nothing stored.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "cooled").oneOf()
    val h = runs.get(r)
    val found = hasAgreement(h.email)
    all {
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, if (found or MUTANT == "no-lookup") { ...h, phase: "found", found: found } else { ...h, phase: "done", outcome: "nothingToDo" }),
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The link batch, as one step: the guard and the insert together.
  action storeLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    val guardOk = MUTANT == "no-guard" or windowFree(links, h.email, now)
    val stores = guardOk
    val newLink = { id: r, email: h.email, issued: now, expires: now + EXPIRY }
    all {
      now' = now,
      links' = if (stores) links.union(Set(newLink)) else links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, { ...h, phase: "done", outcome: if (stores) "stored" else "cooling" }),
      // Ghost, from the real state: a link was stored while another link for this address is inside the window.
      doubleIssue' = (doubleIssue or (stores and not(windowFree(links, h.email, now)))),
      issuedWithoutAgreement' = (issuedWithoutAgreement or (stores and not(hasAgreement(h.email)))),
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
      runs' = runs.set(r, { ...h, phase: "checked", guardOk: windowFree(links, h.email, now) }),
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // ... and the insert in a later step, when the guard said so.
  action insertLink = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "checked").oneOf()
    val h = runs.get(r)
    val newLink = { id: r, email: h.email, issued: now, expires: now + EXPIRY }
    all {
      MUTANT == "split-guard",
      now' = now,
      links' = if (h.guardOk) links.union(Set(newLink)) else links,
      coolAt' = coolAt,
      redeems' = redeems,
      runs' = runs.set(r, { ...h, phase: "done", outcome: if (h.guardOk) "stored" else "cooling" }),
      doubleIssue' = (doubleIssue or (h.guardOk and not(windowFree(links, h.email, now)))),
      issuedWithoutAgreement' = (issuedWithoutAgreement or (h.guardOk and not(hasAgreement(h.email)))),
      doubleRedeem' = (doubleRedeem),
      redeemedLate' = (redeemedLate),
    }
  }

  // The redeem of a stored link. Once per link, and only before its expiry.
  action redeem = {
    nondet l = links.oneOf()
    val used = redeems.get(l.id) > 0
    val late = now >= l.expires
    val allowed = (not(used) or MUTANT == "redeem-twice") and (not(late) or MUTANT == "redeem-late")
    all {
      allowed,
      now' = now,
      links' = links,
      coolAt' = coolAt,
      redeems' = redeems.set(l.id, redeems.get(l.id) + 1),
      runs' = runs,
      doubleIssue' = (doubleIssue),
      issuedWithoutAgreement' = (issuedWithoutAgreement),
      doubleRedeem' = (doubleRedeem or used),
      redeemedLate' = (redeemedLate or late),
    }
  }

  action step = any { tick, ask, takeCooldown, lookup, storeLink, checkGuard, insertLink, redeem }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. Two links for one address are never issued inside the window.
  val oneIssuePerWindow = not(doubleIssue)

  // 2. A link is issued only for an address with an executed agreement.
  val issuedOnlyWithAgreement = not(issuedWithoutAgreement)

  // 3. A link is redeemed at most once.
  val redeemedOnce = not(doubleRedeem)

  // 4. A link is redeemed only before it expires.
  val redeemedUnexpired = not(redeemedLate)

  val allProperties = and {
    oneIssuePerWindow, issuedOnlyWithAgreement, redeemedOnce, redeemedUnexpired,
  }
}

module agreementLink { import agreementLinkProtocol(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module agreementLinkNoGuard { import agreementLinkProtocol(MUTANT = "no-guard").* }
module agreementLinkSplitGuard { import agreementLinkProtocol(MUTANT = "split-guard").* }
module agreementLinkNoLookup { import agreementLinkProtocol(MUTANT = "no-lookup").* }
module agreementLinkRedeemTwice { import agreementLinkProtocol(MUTANT = "redeem-twice").* }
module agreementLinkRedeemLate { import agreementLinkProtocol(MUTANT = "redeem-late").* }
