// Quint model of one software request whose offer carries a discount: versions drafted, edited, sent, superseded and
// withdrawn by the owner while the client reviews and signs, and invoices reserved and written before and after a
// revision. Written before the code, from the design in docs/plans/2026-11-discount-flow.md ("The model"). Extended before
// the offers conversion (docs/plans/2026-11-offers-conversion.md, section 7) with the offer link, the 20-second sending
// window, the emails and a clock, so that send and decline are the steps the route takes, not one step each.
// Code modelled (as it is today; the discount adds data to the terms, not new moves):
//   draft:                     src/pages/api/owner/requests/[id]/software.ts (UPDATE ... WHERE status='draft')
//   send:                      the same route, three steps: the batch (G3 the signing guard, G4 depositOfferGuard, G5
//                              offerSendingGuard, G8 the offer as read, G9 a reissue needs the link revoked; the link
//                              upsert, retireRequestSigning), the client email then its copy, then the live-link check
//   decline:                   the same route, three steps: the first batch (G2, G3, G4, G5; offers withdrawn, links
//                              revoked, retireRequestSigning), the client email then its copy, then the second batch (G1
//                              at the write time, G2, G5; the request resolved). G1 holds trivially here and G6 (an audio
//                              project) is not modelled; see declineSecond
//   revoke:                    the same route (G5, G10 the link is still live; retireRequestSigning)
//   the sending window:        offerSendingGuard and offerIsSending in src/lib/software-offers.ts (created_at > now - 20 s)
//   the emails:                sendAudioMessage in src/lib/audio-resend.ts (AbortSignal.timeout(10_000) on each)
//   reopen:                    src/lib/owner-requests.ts (resolved to new, no project)
//   review, sign:              src/lib/software-agreements.ts (text rendered from the offer's terms at review; the sign
//                              batch has liveSigningGuard and the session guard); getLinkedOffer opens the review
//   invoice reserve, write:    reserveSoftwareInvoice in src/lib/software-invoices.ts (amount from the terms read first,
//                              then a guarded batch)
//   start:                     src/pages/api/owner/requests/[id]/project.ts (copies the sent offer's terms)
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module discountOffers {
  // "none" is the design: the code as it is, including the deposit guard of decision 9 (see "today-deposit-guard").
  // Every other value changes one thing so a property must fail (the mutants):
  //   "edit-sent"              the draft update does not require status draft, so a sent offer's terms can change
  //   "latest-terms"           an invoice amount is computed from the newest version's terms, not the invoice's own
  //   "deposit-from-usual"     the deposit is half the usual fee instead of half the discounted fee
  //   "no-deposit-guard"       a new version is sent while the old one has an open or paid deposit
  //   "today-deposit-guard"    the deposit guard as it was before decision 9: it looked only at the sent offer, so a paid
  //                            deposit on a withdrawn offer (decline, then reopen) did not stop the next version (found by
  //                            this model, reproduced and fixed in the code; the name is kept for the CI driver)
  //   "no-write-status-guard"  the invoice batch does not re-check that its offer is still sent (a stale read is trusted)
  //   "no-sign-guards"         the sign batch checks neither that the offer is still sent nor that the review session
  //                            survived a resend (liveSigningGuard and retireRequestSigning gone)
  //   "send-after-sign"        a new version can be sent after the client signed (the signing guard of send gone)
  //   "start-copies-newest"    the project copies the newest version's terms instead of the signed offer's
  //   "start-drops-discount"   the project copies the signed offer's terms without the discount fields
  //   "second-batch-no-sending-guard"
  //                            the decline's second batch has no G5, so a link made less than 20 seconds before it
  //                            survives the decline too
  //   "today-second-batch"     with F10_FIX: the decline's second batch as it is today, which does not look at the offers
  //                            (F10, found by reading and reproduced by this model)
  //   "no-live-check"          the send answers 200 without the live-link check after the email
  const MUTANT: str
  // Offer versions the owner can create. Two are enough for every path the properties need (a revision, a decline then
  // a new offer) and keep the random runs fast; the manual Apalache check uses the same module.
  const VERSIONS: int
  // F10 (docs/plans/2026-11-offers-conversion.md, section 5), not yet decided by the owner. false: the decline's second
  // batch as it is today, and `declinedHasNoOffer` allows exactly what that batch lets through. true: the second batch
  // with the proposed fix (it also refuses while any offer of the request is draft or sent), and `declinedHasNoOffer` is
  // the strict property the fix needs; today's second batch is then the mutant "today-second-batch".
  const F10_FIX: bool

  // ---- Bounds for the checker -------------------------------------------------------------------------------------
  // Two milestones with odd usual fees, in units where 1 is the smallest fee a client may pay ($1 in code). A discount
  // leaves at least 1, as in code (feeCents at least 100).
  val USUAL_0 = 5
  val USUAL_1 = 4
  // The clock ticks in 10-second steps. Each email (the client's, then the copy) ends within its 10-second timeout, so
  // within one tick of its start; the two in a row end within two. The sending window G5 is 20 seconds, two ticks, and
  // compares strictly (created_at > now - 20 s), so a link made two ticks ago no longer blocks.
  val EMAIL_TICKS = 1
  val WINDOW = 2

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
  // software_offer_links, one row per request. live: revoked_at IS NULL. created: created_at, in ticks. token: which send
  // batch wrote the row (its token_hash), 0 before the first send.
  type Link = { live: bool, created: int, token: int }
  // The send whose batch ran and whose answer is not yet given. phase: "none", "email" (the client email, then the copy
  // when it was accepted), "check" (the live-link check). v: the version sent. token: the link it made. start: the tick of
  // its batch. accepted: the client email was accepted.
  type Sending = { phase: str, v: int, token: int, start: int, accepted: bool }
  // The decline whose first batch ran and whose answer is not yet given. phase: "none", "email" (the client email, then
  // the copy), "second" (the email was accepted; the second batch runs next). start: the tick of its first batch.
  type Declining = { phase: str, start: int }
  type Ghost = {
    badSign: bool,         // a sign batch wrote while its offer was not sent
    badInvoice: bool,      // an invoice was written for an offer that was neither sent nor the project's
    badAcceptedSend: bool, // a send answered 200 with its client email accepted while its link was not live at the check
    declined: bool,        // a decline's second batch resolved the request, and it was not reopened since
    declinedAt: int,       // the tick of that second batch
    inDecline: Set[int],   // the versions drafted or sent while the latest decline's email was in flight
    sentAt: int -> int,    // the tick at which each version was sent (its draft's send batch)
    linkInDecline: bool,   // the link row was written while a decline's email was in flight
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
  var clock: int           // ticks of 10 seconds
  var link: Link
  var sending: Sending
  var declining: Declining
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
  pure def draftOrSent(o: Offer): bool = o.status == "draft" or o.status == "sent"

  // The deposit guard of send (depositOfferGuard): no open or paid first deposit on another version. The code counts
  // every other version; the guard before decision 9 ("today-deposit-guard") counted only the sent one.
  def blocksSend(k: int, sendingV: int): bool =
    mOf(k) == 0 and kindOf(k) == "deposit" and vOf(k) != sendingV and
      (MUTANT != "today-deposit-guard" or offers.get(vOf(k)).status == "sent")

  // G5, the sending window (offerSendingGuard in a batch, offerIsSending in a read): a live link made less than 20
  // seconds ago. Send, decline (both batches) and revoke refuse while it holds.
  val stillSending = link.live and clock - link.created < WINDOW
  // A decline's email is in flight: after its first batch, before its second batch (or its failure).
  val declineInFlight = declining.phase != "none"

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
    clock' = 0,
    link' = { live: false, created: 0, token: 0 },
    sending' = { phase: "none", v: 0, token: 0, start: 0, accepted: false },
    declining' = { phase: "none", start: 0 },
    ghost' = {
      badSign: false, badInvoice: false, badAcceptedSend: false, declined: false, declinedAt: 0, inDecline: Set(),
      sentAt: versionIds.mapBy(_ => 0), linkInDecline: false,
    },
  }

  // Everything else stays as it is.
  action keepOffers = all { offers' = offers, versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent }
  action keepClient = all { review' = review, signed' = signed }
  action keepMoney = all { bills' = bills, pending' = pending, project' = project, projectTerms' = projectTerms }
  action keepFlows = all { clock' = clock, link' = link, sending' = sending, declining' = declining }

  // The owner saves a new draft (the next version), with any terms: any discount on each milestone, either mode. Allowed
  // while a decline's email is in flight: the request is still new or reviewed until the decline's second batch.
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
      keepClient, keepMoney, keepFlows,
      ghost' = { ...ghost, inDecline: if (declineInFlight) ghost.inDecline.union(Set(v)) else ghost.inDecline },
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
      keepClient, keepMoney, keepFlows, ghost' = ghost,
    }
  }

  // Send, the batch, for a draft: the sent offer becomes superseded, the review session is revoked, and the link row is
  // written with a new token and created now. Refused after the client signed (G3), while any other version has an open
  // or paid first deposit (G4) and within 20 seconds of a live link (G5). The model lets one send be in flight at a time
  // (see docs/verification.md, "What it does not cover").
  action sendDraft = {
    nondet v = versionIds.oneOf()
    all {
      sending.phase == "none",
      requestOpen, project == 0, offers.get(v).status == "draft",
      signed.v == 0 or MUTANT == "send-after-sign",
      MUTANT == "no-deposit-guard" or not(liveSlots.exists(k => blocksSend(k, v))),
      not(stillSending),
      offers' = versionIds.mapBy(w =>
        if (w == v) { ...offers.get(w), status: "sent" }
        else if (offers.get(w).status == "sent") { ...offers.get(w), status: "superseded" }
        else offers.get(w)),
      versions' = versions,
      sentTerms' = sentTerms.set(v, offers.get(v).terms),
      wasSent' = wasSent.union(Set(v)),
      review' = { ...review, revoked: true },
      link' = { live: true, created: clock, token: link.token + 1 },
      sending' = { phase: "email", v: v, token: link.token + 1, start: clock, accepted: false },
      clock' = clock, declining' = declining,
      requestOpen' = requestOpen, signed' = signed, keepMoney,
      ghost' = {
        ...ghost,
        inDecline: if (declineInFlight) ghost.inDecline.union(Set(v)) else ghost.inDecline,
        sentAt: ghost.sentAt.set(v, clock),
        linkInDecline: declineInFlight,
      },
    }
  }

  // Send, the batch, for the sent version (a reissue): the link must be revoked (G9), so G5 holds; the offer keeps its
  // status and terms, the link row gets a new token created now, and signing is retired. G3 as for a draft; G4 is a
  // draft's only.
  action reissue = {
    nondet v = versionIds.oneOf()
    all {
      sending.phase == "none",
      requestOpen, project == 0, offers.get(v).status == "sent",
      signed.v == 0 or MUTANT == "send-after-sign",
      link.token != 0, not(link.live),
      link' = { live: true, created: clock, token: link.token + 1 },
      sending' = { phase: "email", v: v, token: link.token + 1, start: clock, accepted: false },
      review' = { ...review, revoked: true },
      keepOffers, clock' = clock, declining' = declining,
      requestOpen' = requestOpen, signed' = signed, keepMoney,
      ghost' = { ...ghost, linkInDecline: declineInFlight },
    }
  }

  // Send, the email: the client email, then the copy when the client's was accepted. Each ends within its 10-second
  // timeout, so a failed client email ends within one tick of the batch and an accepted one, with its copy, within two.
  action sendEmail = {
    nondet accepted = Set(true, false).oneOf()
    all {
      sending.phase == "email",
      clock <= sending.start + (if (accepted) 2 * EMAIL_TICKS else EMAIL_TICKS),
      sending' = { ...sending, phase: "check", accepted: accepted },
      keepOffers, keepClient, keepMoney, requestOpen' = requestOpen,
      clock' = clock, link' = link, declining' = declining, ghost' = ghost,
    }
  }

  // Send, the live-link check after the email: the link row still has this send's token and is not revoked, and the offer
  // is still sent. With the client email accepted and the link not live, the send answers 409; otherwise 200 (also when
  // the email failed and the link closed: F9). The check writes nothing.
  action sendCheck = {
    val linkLive = link.live and link.token == sending.token and offers.get(sending.v).status == "sent"
    val answers200 = not(sending.accepted) or linkLive or MUTANT == "no-live-check"
    all {
      sending.phase == "check",
      sending' = { ...sending, phase: "none" },
      ghost' = { ...ghost, badAcceptedSend: ghost.badAcceptedSend or (answers200 and sending.accepted and not(linkLive)) },
      keepOffers, keepClient, keepMoney, requestOpen' = requestOpen,
      clock' = clock, link' = link, declining' = declining,
    }
  }

  // The owner closes the link, in any request status: G5, and G10 (the link the page showed is still live). Signing is
  // retired.
  action revoke = all {
    link.live, not(stillSending),
    link' = { ...link, live: false },
    review' = { ...review, revoked: true },
    keepOffers, signed' = signed, keepMoney, requestOpen' = requestOpen,
    clock' = clock, sending' = sending, declining' = declining, ghost' = ghost,
  }

  // Decline, the first batch: sent and draft offers are withdrawn, live links revoked, signing retired; the request stays
  // new or reviewed. Refused once resolved, with a project (G2), after the client signed (G3), while a deposit is open (a
  // paid one does not block: depositOfferGuard with decline = true, G4) and within 20 seconds of a live link (G5). The
  // model lets one decline be in flight at a time.
  action declineFirst = all {
    declining.phase == "none",
    requestOpen, project == 0, signed.v == 0,
    not(liveSlots.exists(k => kindOf(k) == "deposit" and bills.get(k).status == "open")),
    not(stillSending),
    offers' = versionIds.mapBy(w => if (draftOrSent(offers.get(w))) { ...offers.get(w), status: "withdrawn" } else offers.get(w)),
    versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent,
    link' = { ...link, live: false },
    declining' = { phase: "email", start: clock },
    review' = { ...review, revoked: true },
    requestOpen' = requestOpen, signed' = signed, keepMoney, clock' = clock, sending' = sending,
    ghost' = { ...ghost, inDecline: Set() },
  }

  // Decline, the email: the client email, then the copy, timed as for send. A failed client email ends the decline (502):
  // the offers stay withdrawn and nothing more is written.
  action declineEmail = {
    nondet accepted = Set(true, false).oneOf()
    all {
      declining.phase == "email",
      clock <= declining.start + (if (accepted) 2 * EMAIL_TICKS else EMAIL_TICKS),
      declining' = { ...declining, phase: if (accepted) "second" else "none" },
      keepOffers, keepClient, keepMoney, requestOpen' = requestOpen,
      clock' = clock, link' = link, sending' = sending, ghost' = ghost,
    }
  }

  // Decline, the second batch: G1 at the write time (nothing in this model touches the request row between the batches;
  // draft, send and revoke never do), G2 and G5 (G6, the audio project, is not modelled). It resolves the request. Today
  // it does not look at the offers or the link (F10); with the fix it also refuses while any offer is draft or sent. A
  // refused batch answers 409 and writes nothing.
  action declineSecond = {
    val noOffers = versionIds.forall(v => not(draftOrSent(offers.get(v))))
    val writes = and {
      project == 0,
      MUTANT == "second-batch-no-sending-guard" or not(stillSending),
      not(F10_FIX) or MUTANT == "today-second-batch" or noOffers,
    }
    all {
      declining.phase == "second",
      declining' = { ...declining, phase: "none" },
      requestOpen' = if (writes) false else requestOpen,
      ghost' = if (writes) { ...ghost, declined: true, declinedAt: clock } else ghost,
      keepOffers, keepClient, keepMoney, clock' = clock, link' = link, sending' = sending,
    }
  }

  // The owner reopens the resolved request (no project yet), so a new offer can be made.
  action reopen = all {
    not(requestOpen), project == 0,
    requestOpen' = true,
    keepOffers, keepClient, keepMoney, keepFlows,
    ghost' = { ...ghost, declined: false },
  }

  // Ten seconds pass. An email in flight ends within its timeout, and the step after it (the live-link check, the second
  // batch) runs at once, so the clock waits for them.
  action tick = all {
    sending.phase != "check", declining.phase != "second",
    sending.phase != "email" or clock + 1 <= sending.start + 2 * EMAIL_TICKS,
    declining.phase != "email" or clock + 1 <= declining.start + 2 * EMAIL_TICKS,
    clock' = clock + 1,
    link' = link, sending' = sending, declining' = declining,
    keepOffers, keepClient, keepMoney, requestOpen' = requestOpen, ghost' = ghost,
  }

  // The client opens review through the live link (getLinkedOffer: link live, offer sent, request open): the agreement
  // text is rendered from the sent offer's terms as they are now.
  action reviewRead = {
    nondet v = versionIds.oneOf()
    all {
      requestOpen, project == 0, signed.v == 0, offers.get(v).status == "sent", link.live,
      review' = { v: v, terms: offers.get(v).terms, revoked: false },
      keepOffers, requestOpen' = requestOpen, signed' = signed, keepMoney, keepFlows, ghost' = ghost,
    }
  }

  // The client signs what they reviewed. The batch: liveSigningGuard (offer sent, link live, request open, no project)
  // and the session guard (not revoked; every link change revokes it), and no earlier client signature.
  action sign = all {
    review.v != 0, signed.v == 0, project == 0,
    MUTANT == "no-sign-guards" or (offers.get(review.v).status == "sent" and not(review.revoked) and link.live and requestOpen),
    signed' = { v: review.v, terms: review.terms },
    ghost' = { ...ghost, badSign: ghost.badSign or offers.get(review.v).status != "sent" },
    review' = review, keepOffers, requestOpen' = requestOpen, keepMoney, keepFlows,
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
    keepOffers, keepClient, requestOpen' = requestOpen, keepFlows, ghost' = ghost,
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
      keepOffers, keepClient, requestOpen' = requestOpen, keepFlows, ghost' = ghost,
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
      project' = project, projectTerms' = projectTerms, keepOffers, keepClient, requestOpen' = requestOpen, keepFlows,
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
      keepOffers, keepClient, requestOpen' = requestOpen, keepFlows, ghost' = ghost,
    }
  }

  action step = any {
    newDraft, editDraft, sendDraft, reissue, sendEmail, sendCheck, revoke, declineFirst, declineEmail, declineSecond,
    reopen, tick, reviewRead, sign, start, invoiceRead, invoiceWrite, settle,
  }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is, so the end
  // of a run is not reported as a deadlock. The random runs use `step`.
  action finished = all {
    keepOffers, keepClient, keepMoney, keepFlows, requestOpen' = requestOpen, ghost' = ghost,
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

  // What a decline that resolved the request leaves behind. With the F10 fix: no draft or sent offer and no live link.
  val nothingLeft = versionIds.forall(v => not(draftOrSent(offers.get(v)))) and not(link.live)
  // Today (F10): the second batch lets through a draft saved during the decline's email, and a sent offer and its live
  // link made during the email at least 20 seconds (WINDOW) before the second batch; nothing else.
  val onlyF10Left = and {
    versionIds.forall(v => offers.get(v).status == "draft" implies ghost.inDecline.contains(v)),
    versionIds.forall(v => offers.get(v).status == "sent" implies
      (ghost.inDecline.contains(v) and ghost.sentAt.get(v) <= ghost.declinedAt - WINDOW)),
    link.live implies (ghost.linkInDecline and link.created <= ghost.declinedAt - WINDOW),
  }

  // 6. A request a decline resolved has no draft or sent offer and no live link (F10_FIX), or, for the code as it is
  //    today, nothing but what F10 lets through (docs/plans/2026-11-offers-conversion.md, sections 5 and 7).
  val declinedHasNoOffer = not(ghost.declined) or (if (F10_FIX) nothingLeft else onlyF10Left)

  // 7. A send that answers 200 with its client email accepted had its link live at the check.
  val acceptedSendLinkLive = not(ghost.badAcceptedSend)

  val allProperties = and {
    invoicedMatchesSigned, sentTermsFrozen, oneVersionInvoiced, installmentsSum, supersededInert, declinedHasNoOffer,
    acceptedSendLinkLive,
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

  // F10 witnesses, for a hand run on `discount` (today's code) with the negated invariant (docs/verification.md): a
  // request resolved by a decline with a draft left, and with a sent offer and its live link left.
  val neverDeclinedWithDraft = not(ghost.declined and versionIds.exists(v => offers.get(v).status == "draft"))
  val neverDeclinedWithLiveOffer = not(ghost.declined and versionIds.exists(v => offers.get(v).status == "sent") and link.live)
}

module discount { import discountOffers(MUTANT = "none", VERSIONS = 2, F10_FIX = false).* }
// The F10 fix (not yet decided): the same code with the decline's second batch refusing while an offer is draft or sent.
module discountF10Fix { import discountOffers(MUTANT = "none", VERSIONS = 2, F10_FIX = true).* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module discountEditSent { import discountOffers(MUTANT = "edit-sent", VERSIONS = 2, F10_FIX = false).* }
module discountLatestTerms { import discountOffers(MUTANT = "latest-terms", VERSIONS = 2, F10_FIX = false).* }
module discountDepositFromUsual { import discountOffers(MUTANT = "deposit-from-usual", VERSIONS = 2, F10_FIX = false).* }
module discountNoDepositGuard { import discountOffers(MUTANT = "no-deposit-guard", VERSIONS = 2, F10_FIX = false).* }
module discountTodayDepositGuard { import discountOffers(MUTANT = "today-deposit-guard", VERSIONS = 2, F10_FIX = false).* }
module discountNoWriteStatusGuard { import discountOffers(MUTANT = "no-write-status-guard", VERSIONS = 2, F10_FIX = false).* }
module discountNoSignGuards { import discountOffers(MUTANT = "no-sign-guards", VERSIONS = 2, F10_FIX = false).* }
module discountSendAfterSign { import discountOffers(MUTANT = "send-after-sign", VERSIONS = 2, F10_FIX = false).* }
module discountStartCopiesNewest { import discountOffers(MUTANT = "start-copies-newest", VERSIONS = 2, F10_FIX = false).* }
module discountStartDropsDiscount { import discountOffers(MUTANT = "start-drops-discount", VERSIONS = 2, F10_FIX = false).* }
module discountSecondBatchNoSendingGuard { import discountOffers(MUTANT = "second-batch-no-sending-guard", VERSIONS = 2, F10_FIX = false).* }
module discountTodaySecondBatch { import discountOffers(MUTANT = "today-second-batch", VERSIONS = 2, F10_FIX = true).* }
module discountNoLiveCheck { import discountOffers(MUTANT = "no-live-check", VERSIONS = 2, F10_FIX = false).* }
