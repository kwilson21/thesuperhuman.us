// Quint model of one software request whose offer carries a discount: versions drafted, edited, sent, superseded and
// withdrawn by the owner while the client reviews and signs, and invoices reserved and written before and after a
// revision. Written before the code, from the design in docs/plans/2026-11-discount-flow.md ("The model").
// Code modelled (as it is today; the discount adds data to the terms, not new moves):
//   draft, send, decline:      src/pages/api/owner/requests/[id]/software.ts (UPDATE ... WHERE status='draft', the
//                              deposit guard depositOfferGuard, the signing guard, retireRequestSigning)
//   reopen:                    src/lib/owner-requests.ts (resolved to new, no project)
//   review, sign:              src/lib/software-agreements.ts (text rendered from the offer's terms at review; the sign
//                              batch has liveSigningGuard and the session guard)
//   invoice reserve, write:    reserveSoftwareInvoice in src/lib/software-invoices.ts (amount from the terms read first,
//                              then a guarded batch)
//   start:                     src/pages/api/owner/requests/[id]/project.ts (copies the sent offer's terms)
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module discountOffers {
  // "none" is the design: today's code, with the one change the plan proposes to the deposit guard (see "today-deposit-
  // guard"). Every other value changes one thing so a property must fail (the mutants):
  //   "edit-sent"              the draft update does not require status draft, so a sent offer's terms can change
  //   "latest-terms"           an invoice amount is computed from the newest version's terms, not the invoice's own
  //   "deposit-from-usual"     the deposit is half the usual fee instead of half the discounted fee
  //   "no-deposit-guard"       a new version is sent while the old one has an open or paid deposit
  //   "today-deposit-guard"    the deposit guard as it is today: it looks only at the sent offer, so a paid deposit on a
  //                            withdrawn offer (decline, then reopen) does not stop the next version (found by this model)
  //   "no-write-status-guard"  the invoice batch does not re-check that its offer is still sent (a stale read is trusted)
  //   "no-sign-guards"         the sign batch checks neither that the offer is still sent nor that the review session
  //                            survived a resend (liveSigningGuard and retireRequestSigning gone)
  //   "send-after-sign"        a new version can be sent after the client signed (the signing guard of send gone)
  //   "start-copies-newest"    the project copies the newest version's terms instead of the signed offer's
  //   "start-drops-discount"   the project copies the signed offer's terms without the discount fields
  const MUTANT: str
  // Offer versions the owner can create. Two are enough for every path the properties need (a revision, a decline then
  // a new offer) and keep the random runs fast; the manual Apalache check uses the same module.
  const VERSIONS: int

  // ---- Bounds for the checker -------------------------------------------------------------------------------------
  // Two milestones with odd usual fees, in units where 1 is the smallest fee a client may pay ($1 in code). A discount
  // leaves at least 1, as in code (feeCents at least 100).
  val USUAL_0 = 5
  val USUAL_1 = 4

  // d0 and d1: the discount on each milestone. std: the standard payment mode (deposit then balance), else invoice terms.
  type Terms = { d0: int, d1: int, std: bool }
  // status: "none" (not created), "draft", "sent", "superseded", "withdrawn".
  type Offer = { status: str, terms: Terms }
  // One invoice slot (version, milestone, kind), as software_invoices rows for it: status "none" (no row), "open",
  // "paid", "void". A void slot can be invoiced again (Replace invoice), so at most one row of a slot is live.
  type Bill = { status: str, amount: int }
  // A pending invoice reservation: the read was made, the batch has not run.
  type Pending = { active: bool, slot: int, amount: int }
  // The client's review: the agreement text is rendered from these terms. revoked: retireRequestSigning ran since.
  type Review = { v: int, terms: Terms, revoked: bool }
  type Signed = { v: int, terms: Terms }
  type Ghost = {
    badSign: bool,     // a sign batch wrote while its offer was not sent
    badInvoice: bool,  // an invoice was written for an offer that was neither sent nor the project's
  }

  // ---- State ------------------------------------------------------------------------------------------------------
  var offers: int -> Offer
  var versions: int            // versions created so far (the newest version)
  var sentTerms: int -> Terms  // the terms each version had when it was sent (ghost)
  var wasSent: Set[int]
  var requestOpen: bool        // false once declined (resolved); reopen makes it true again
  var review: Review           // v 0: none
  var signed: Signed           // v 0: not signed
  var project: int             // the version the project started from, 0 none
  // software_projects.terms_json: the terms copied from the offer at start. The client's project page states the
  // installments from this copy, while reserveSoftwareInvoice computes each invoice from the offer's terms_json, so the
  // two must be the signed terms.
  var projectTerms: Terms
  var bills: int -> Bill   // by slot number (slotOf)
  var pending: Pending
  var ghost: Ghost

  // ---- The money rule, as pure functions (tests/fixtures/discount-installments.ts) --------------------------------
  pure def usual(m: int): int = if (m == 0) USUAL_0 else USUAL_1
  pure def discountOf(t: Terms, m: int): int = if (m == 0) t.d0 else t.d1
  pure def fee(t: Terms, m: int): int = usual(m) - discountOf(t, m)

  pure def installment(t: Terms, m: int, kind: str): int = {
    val deposit = if (MUTANT == "deposit-from-usual") usual(m) / 2 else fee(t, m) / 2
    if (kind == "deposit") deposit
    else if (kind == "balance") fee(t, m) - fee(t, m) / 2
    else fee(t, m)
  }

  pure def inPlan(t: Terms, kind: str): bool = if (t.std) kind != "milestone" else kind == "milestone"
  pure def total(t: Terms): int = fee(t, 0) + fee(t, 1)
  pure def planSum(t: Terms): int =
    if (t.std) installment(t, 0, "deposit") + installment(t, 0, "balance") + installment(t, 1, "deposit") + installment(t, 1, "balance")
    else installment(t, 0, "milestone") + installment(t, 1, "milestone")

  // ---- Helpers ------------------------------------------------------------------------------------------------------
  val versionIds = 1.to(VERSIONS)
  // Invoice slots are numbered 0 to 6 * VERSIONS - 1: version, milestone (0 or 1) and kind. Plain numbers keep the
  // random runs fast.
  val slots = 0.to(6 * VERSIONS - 1)
  pure def slotOf(v: int, m: int, kind: str): int = (v - 1) * 6 + m * 3 + (if (kind == "deposit") 0 else if (kind == "balance") 1 else 2)
  pure def vOf(k: int): int = k / 6 + 1
  pure def mOf(k: int): int = (k % 6) / 3
  pure def kindOf(k: int): str = if (k % 3 == 0) "deposit" else if (k % 3 == 1) "balance" else "milestone"
  val noTerms = { d0: 0, d1: 0, std: true }
  val hasDraft = versionIds.exists(v => offers.get(v).status == "draft")
  pure def live(b: Bill): bool = b.status == "open" or b.status == "paid"
  val liveSlots = slots.filter(k => live(bills.get(k)))

  // The deposit guard of send (depositOfferGuard): no open or paid first deposit on another version. The design counts
  // every other version; today's code ("today-deposit-guard") counts only the sent one.
  def blocksSend(k: int, sendingV: int): bool =
    mOf(k) == 0 and kindOf(k) == "deposit" and vOf(k) != sendingV and
      (MUTANT != "today-deposit-guard" or offers.get(vOf(k)).status == "sent")

  // ---- Actions ----------------------------------------------------------------------------------------------------
  action init = all {
    offers' = versionIds.mapBy(_ => { status: "none", terms: noTerms }),
    versions' = 0,
    sentTerms' = versionIds.mapBy(_ => noTerms),
    wasSent' = Set(),
    requestOpen' = true,
    review' = { v: 0, terms: noTerms, revoked: false },
    signed' = { v: 0, terms: noTerms },
    project' = 0,
    projectTerms' = noTerms,
    bills' = slots.mapBy(_ => { status: "none", amount: 0 }),
    pending' = { active: false, slot: 0, amount: 0 },
    ghost' = { badSign: false, badInvoice: false },
  }

  // Everything else stays as it is.
  action keepOffers = all { offers' = offers, versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent }
  action keepClient = all { review' = review, signed' = signed }
  action keepMoney = all { bills' = bills, pending' = pending, project' = project, projectTerms' = projectTerms }

  // The owner saves a new draft (the next version), with any terms: any discount on each milestone, either mode.
  action newDraft = {
    val v = versions + 1
    nondet d0 = 0.to(USUAL_0 - 1).oneOf()
    nondet d1 = 0.to(USUAL_1 - 1).oneOf()
    nondet std = Set(true, false).oneOf()
    all {
      requestOpen, project == 0, not(hasDraft), v <= VERSIONS,
      offers' = offers.set(v, { status: "draft", terms: { d0: d0, d1: d1, std: std } }),
      versions' = v,
      sentTerms' = sentTerms, wasSent' = wasSent, requestOpen' = requestOpen,
      keepClient, keepMoney, ghost' = ghost,
    }
  }

  // The owner edits the discount (or anything) on the draft: UPDATE software_offers ... WHERE id=? AND status='draft'.
  action editDraft = {
    nondet v = versionIds.oneOf()
    nondet d0 = 0.to(USUAL_0 - 1).oneOf()
    nondet d1 = 0.to(USUAL_1 - 1).oneOf()
    nondet std = Set(true, false).oneOf()
    all {
      requestOpen, project == 0,
      offers.get(v).status == "draft" or (MUTANT == "edit-sent" and offers.get(v).status == "sent"),
      offers' = offers.set(v, { ...offers.get(v), terms: { d0: d0, d1: d1, std: std } }),
      versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent, requestOpen' = requestOpen,
      keepClient, keepMoney, ghost' = ghost,
    }
  }

  // The owner sends the draft: the sent offer becomes superseded, the review session is revoked.
  action send = {
    nondet v = versionIds.oneOf()
    all {
      requestOpen, project == 0, offers.get(v).status == "draft",
      signed.v == 0 or MUTANT == "send-after-sign",
      MUTANT == "no-deposit-guard" or not(liveSlots.exists(k => blocksSend(k, v))),
      offers' = versionIds.mapBy(w =>
        if (w == v) { ...offers.get(w), status: "sent" }
        else if (offers.get(w).status == "sent") { ...offers.get(w), status: "superseded" }
        else offers.get(w)),
      versions' = versions,
      sentTerms' = sentTerms.set(v, offers.get(v).terms),
      wasSent' = wasSent.union(Set(v)),
      review' = { ...review, revoked: true },
      requestOpen' = requestOpen, signed' = signed, keepMoney, ghost' = ghost,
    }
  }

  // The owner declines the request: sent and draft offers are withdrawn, signing retired. An open deposit blocks it; a
  // paid one does not (depositOfferGuard with decline = true).
  action decline = all {
    requestOpen, project == 0, signed.v == 0,
    not(liveSlots.exists(k => kindOf(k) == "deposit" and bills.get(k).status == "open")),
    offers' = versionIds.mapBy(w =>
      if (offers.get(w).status == "sent" or offers.get(w).status == "draft") { ...offers.get(w), status: "withdrawn" }
      else offers.get(w)),
    versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent,
    requestOpen' = false,
    review' = { ...review, revoked: true }, signed' = signed, keepMoney, ghost' = ghost,
  }

  // The owner reopens the resolved request (no project yet), so a new offer can be made.
  action reopen = all {
    not(requestOpen), project == 0,
    requestOpen' = true,
    keepOffers, keepClient, keepMoney, ghost' = ghost,
  }

  // The client opens review: the agreement text is rendered from the sent offer's terms as they are now.
  action reviewRead = {
    nondet v = versionIds.oneOf()
    all {
      requestOpen, project == 0, signed.v == 0, offers.get(v).status == "sent",
      review' = { v: v, terms: offers.get(v).terms, revoked: false },
      keepOffers, requestOpen' = requestOpen, signed' = signed, keepMoney, ghost' = ghost,
    }
  }

  // The client signs what they reviewed. The batch: liveSigningGuard (offer sent, link live, no project) and the
  // session guard (not revoked), and no earlier client signature.
  action sign = all {
    review.v != 0, signed.v == 0, project == 0,
    MUTANT == "no-sign-guards" or (offers.get(review.v).status == "sent" and not(review.revoked)),
    signed' = { v: review.v, terms: review.terms },
    ghost' = { ...ghost, badSign: ghost.badSign or offers.get(review.v).status != "sent" },
    review' = review, keepOffers, requestOpen' = requestOpen, keepMoney,
  }

  // The owner starts the project from the signed, sent offer; standard terms need the first deposit paid. The project
  // copies the offer's terms.
  action start = all {
    signed.v != 0, project == 0, requestOpen, offers.get(signed.v).status == "sent",
    not(offers.get(signed.v).terms.std) or bills.get(slotOf(signed.v, 0, "deposit")).status == "paid",
    project' = signed.v,
    // INSERT INTO software_projects ... SELECT ... terms_json FROM software_offers WHERE id = the signed offer.
    projectTerms' =
      if (MUTANT == "start-copies-newest") offers.get(versions).terms
      else if (MUTANT == "start-drops-discount") { ...offers.get(signed.v).terms, d0: 0, d1: 0 }
      else offers.get(signed.v).terms,
    bills' = bills, pending' = pending,
    keepOffers, keepClient, requestOpen' = requestOpen, ghost' = ghost,
  }

  // reserveSoftwareInvoice, the reads: the offer (sent, or the project's), the slot (before the project only the first
  // deposit), no live invoice in the slot; the amount comes from the offer's terms_json as read now, also after the
  // project started (the code reads software_offers, not the project's copy).
  action invoiceRead = {
    nondet k = slots.oneOf()
    val t = offers.get(vOf(k)).terms
    val amountTerms = if (MUTANT == "latest-terms" and versions > 0) offers.get(versions).terms else t
    all {
      not(pending.active),
      if (project != 0) vOf(k) == project else offers.get(vOf(k)).status == "sent",
      inPlan(t, kindOf(k)),
      project != 0 or (mOf(k) == 0 and kindOf(k) == "deposit"),
      not(live(bills.get(k))),
      pending' = { active: true, slot: k, amount: installment(amountTerms, mOf(k), kindOf(k)) },
      bills' = bills, project' = project, projectTerms' = projectTerms,
      keepOffers, keepClient, requestOpen' = requestOpen, ghost' = ghost,
    }
  }

  // reserveSoftwareInvoice, the batch: the offer is still sent and there is no project (or the project is this offer's),
  // and the slot is still free; then the invoice row is inserted with the amount computed at the read.
  action invoiceWrite = {
    val k = pending.slot
    val offerOk = if (project != 0) vOf(k) == project else offers.get(vOf(k)).status == "sent"
    val writes = (offerOk or MUTANT == "no-write-status-guard") and not(live(bills.get(k)))
    all {
      pending.active,
      pending' = { ...pending, active: false },
      bills' = if (writes) bills.set(k, { status: "open", amount: pending.amount }) else bills,
      ghost' = { ...ghost, badInvoice: ghost.badInvoice or (writes and not(offerOk)) },
      project' = project, projectTerms' = projectTerms, keepOffers, keepClient, requestOpen' = requestOpen,
    }
  }

  // Stripe: the client pays an open invoice, or the owner voids it.
  action settle = {
    nondet k = slots.oneOf()
    nondet outcome = Set("paid", "void").oneOf()
    all {
      bills.get(k).status == "open",
      bills' = bills.set(k, { ...bills.get(k), status: outcome }),
      pending' = pending, project' = project, projectTerms' = projectTerms,
      keepOffers, keepClient, requestOpen' = requestOpen, ghost' = ghost,
    }
  }

  action step = any {
    newDraft, editDraft, send, decline, reopen, reviewRead, sign, start, invoiceRead, invoiceWrite, settle,
  }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is, so the end
  // of a run is not reported as a deadlock. The random runs use `step`.
  action finished = all {
    keepOffers, keepClient, keepMoney, requestOpen' = requestOpen, ghost' = ghost,
  }

  action stepOrEnd = any { step, finished }

  // ---- Properties -------------------------------------------------------------------------------------------------
  // 1. The total invoiced for a signed offer equals the amount the client signed for: every live invoice of the signed
  //    version is the installment the signed terms give for its slot (a slot has at most one live invoice), so a fully
  //    invoiced offer adds up to the signed total. Invoices read the offer's terms and the project page reads the project's
  //    copy, so both must be the signed terms.
  val invoicedMatchesSigned = signed.v == 0 or and {
    liveSlots.forall(k => vOf(k) != signed.v or bills.get(k).amount == installment(signed.terms, mOf(k), kindOf(k))),
    project == 0 or (offers.get(project).terms == signed.terms and projectTerms == signed.terms),
  }

  // 2. A discount change never alters a sent or signed offer version: a version keeps the terms it was sent with, and
  //    the signed terms are that version's terms.
  val sentTermsFrozen = and {
    wasSent.forall(v => offers.get(v).terms == sentTerms.get(v)),
    signed.v == 0 or signed.terms == offers.get(signed.v).terms,
  }

  // 3. Invoices never mix terms from two versions: every open or paid invoice belongs to the same offer version.
  val oneVersionInvoiced = liveSlots.map(vOf).size() <= 1

  // 4. The installments of every offer version sum to its discounted total.
  val installmentsSum = versionIds.forall(v => offers.get(v).status == "none" or planSum(offers.get(v).terms) == total(offers.get(v).terms))

  // 5. A superseded or withdrawn offer can never be signed or invoiced: no sign or invoice batch wrote for an offer that
  //    was not sent at that moment, and a signed offer stays the sent one.
  val supersededInert = and {
    not(ghost.badSign), not(ghost.badInvoice),
    signed.v == 0 or offers.get(signed.v).status == "sent",
  }

  val allProperties = and {
    invoicedMatchesSigned, sentTermsFrozen, oneVersionInvoiced, installmentsSum, supersededInert,
  }

  // Reachability witness, for a hand run with the negated invariant (docs/plans/2026-11-discount-flow.md, "The model"):
  // a project started from a revised, discounted offer, with every installment of its plan invoiced and paid.
  val fullyPaidAfterRevision = and {
    project > 1, discountOf(offers.get(project).terms, 0) + discountOf(offers.get(project).terms, 1) > 0,
    slots.forall(k => (vOf(k) == project and inPlan(offers.get(project).terms, kindOf(k))) implies bills.get(k).status == "paid"),
  }
  val neverFullyPaidAfterRevision = not(fullyPaidAfterRevision)

  // The same on standard terms, after the first version was sent and then superseded (a real revision). It needs about
  // 19 steps, so the hand run uses more steps and runs than CI.
  val standardPaidAfterSentRevision = and {
    fullyPaidAfterRevision, wasSent.contains(1), offers.get(1).status == "superseded", offers.get(project).terms.std,
  }
  val neverStandardPaidAfterSentRevision = not(standardPaidAfterSentRevision)
}

module discount { import discountOffers(MUTANT = "none", VERSIONS = 2).* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module discountEditSent { import discountOffers(MUTANT = "edit-sent", VERSIONS = 2).* }
module discountLatestTerms { import discountOffers(MUTANT = "latest-terms", VERSIONS = 2).* }
module discountDepositFromUsual { import discountOffers(MUTANT = "deposit-from-usual", VERSIONS = 2).* }
module discountNoDepositGuard { import discountOffers(MUTANT = "no-deposit-guard", VERSIONS = 2).* }
module discountTodayDepositGuard { import discountOffers(MUTANT = "today-deposit-guard", VERSIONS = 2).* }
module discountNoWriteStatusGuard { import discountOffers(MUTANT = "no-write-status-guard", VERSIONS = 2).* }
module discountNoSignGuards { import discountOffers(MUTANT = "no-sign-guards", VERSIONS = 2).* }
module discountSendAfterSign { import discountOffers(MUTANT = "send-after-sign", VERSIONS = 2).* }
module discountStartCopiesNewest { import discountOffers(MUTANT = "start-copies-newest", VERSIONS = 2).* }
module discountStartDropsDiscount { import discountOffers(MUTANT = "start-drops-discount", VERSIONS = 2).* }
