// Quint model of one software request whose offer carries a discount: versions drafted, edited, sent, superseded and
// withdrawn by the owner while the client reviews and signs, and invoices reserved and written before and after a
// revision. Written before the code, from the design in docs/plans/2026-11-discount-flow.md ("The model"). Extended before
// the offers conversion (docs/plans/2026-11-offers-conversion.md, section 7) with the offer link, the 20-second sending
// window, the emails and a clock, so that send and decline are the steps the route takes, not one step each. Extended
// again before the signing conversion (docs/plans/2026-11-signing-conversion.md, section 7) with the emailed signing link
// and the session its redeem makes, the signing setting, review and sign each as a read and a batch, the owner's
// countersign and abandon, and a project that needs an executed agreement. The guards A1 to A12 are named as in section 1
// of that design.
// Code modelled (as it is today; the discount adds data to the terms, not new moves; lines at `585619c1`):
//   draft:                     src/pages/api/owner/requests/[id]/software.ts (UPDATE ... WHERE status='draft')
//   send:                      the same route, three steps: the batch (G3 the signing guard, G4 depositOfferGuard, G5
//                              offerSendingGuard, G8 the offer as read, G9 a reissue needs the link revoked; the link
//                              upsert, the retirement), the client email then its copy, then the live-link check
//   decline:                   the same route, three steps: the first batch (G2, G3, G4, G5; offers withdrawn, links
//                              revoked, the retirement), the client email then its copy, then the read of a draft or
//                              sent offer of the request and the second batch (G1 at the write time, G2, G5, no draft or
//                              sent offer: F10's fix; the request resolved). G1 holds trivially here and G6 (an audio
//                              project) is not modelled; see declineSecond
//   revoke:                    the same route (G5, G10 the link is still live; the retirement)
//   the retirement:            retireSigning in src/server/offers-store.ts:235-261 (the send's, reissue's, revoke's and
//                              decline's batches, 931, 525, 462): the request's agreements in review abandoned, its
//                              signing sessions revoked, its signing links used, its drafts deleted
//   the sending window:        offerSendingGuard and offerIsSending in src/lib/software-offers.ts (created_at > now - 20 s)
//   the emails:                sendAudioMessage in src/lib/audio-resend.ts (AbortSignal.timeout(10_000) on each)
//   reopen:                    src/lib/owner-requests.ts (resolved to new, no project)
//   the signing setting:       src/pages/api/owner/agreements.ts:149-162 (one update; nothing retired)
//   the signing link:          POST /api/offer/[token]/link, issueAgreementLink in src/lib/agreement-access.ts:112-315:
//                              the reads (the setting, getLinkedOffer, `at`), then the link batch (A4 the 30-second
//                              guard, A1 liveSigningGuard, 317-327; the link inserted)
//   the redeem:                the verify page's POST, completeAgreementLink (329-441): the link read by its key, then
//                              the batch (A1, A5 the link still unused; the link used, the session inserted)
//   review:                    POST /api/offer/[token]/review (review.ts:53-107): the reads (getLinkedOffer, the session
//                              through agreementSession, access.ts:73-109, the setting; the draft batch with A1 A2 A3,
//                              src/lib/agreement-draft.ts:53-81; reviewAgreements' reads, software-agreements.ts:161-305),
//                              then the review batch (307-371: A1, A2 sessionGuard, A3; the text rendered from the
//                              offer's terms as read)
//   sign:                      POST /api/offer/[token]/sign (sign.ts): the same reads and signAgreements' reads
//                              (software-agreements.ts:405-458), then the sign batch (460-542: A1, A2, A9 each document
//                              still in review under this session)
//   countersign:               POST /api/owner/requests/[id]/agreement, countersign (agreement.ts:60-82;
//                              countersignAgreements, software-agreements.ts:644-733): the reads, then the batch (A10, A11)
//   abandon:                   the same route, abandon (agreement.ts:119-194): the reads (the client_signed documents and
//                              the first deposit, A12 read first), then the batch (A12, A11; the documents abandoned, the
//                              offer superseded, the offer link revoked, the offer's sessions revoked and links used)
//   invoice reserve, write:    reserveSoftwareInvoice in src/lib/software-invoices.ts (amount from the terms read first,
//                              then a guarded batch)
//   start:                     src/pages/api/owner/requests/[id]/project.ts (a website start needs the offer's agreement
//                              executed, executedOfferAgreement, 139-153; copies the sent offer's terms; it retires
//                              signing only for an outside signature, 270-279, which is not modelled)
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
  //   "no-sign-guards"         neither the sign's read nor its batch checks that the offer is still sent or that the
  //                            review and its session survived a resend (A1, A2 and A9's status and session gone, and
  //                            the read's own checks of the offer and the session), so the client signs the review it
  //                            holds whatever happened since, as the one-step sign without its guard did
  //   "sign-guards-at-read"    the sign's guards (A1, A2, A9) are judged at the read only, not in the batch
  //   "send-after-sign"        a new version can be sent after the client signed (the signing guard of send gone)
  //   "start-copies-newest"    the project copies the newest version's terms instead of the signed offer's
  //   "start-drops-discount"   the project copies the signed offer's terms without the discount fields
  //   "second-batch-no-sending-guard"
  //                            the decline's second batch has no G5. An equivalent mutant: a live link always has a sent
  //                            offer, which the second batch refuses since F10's fix, so G5 there refuses nothing more
  //   "today-second-batch"     the decline's second batch as it was before F10's fix, which did not look at the offers, so
  //                            a draft saved, or saved and sent, during the decline's email was left on the resolved request
  //                            (F10: found by reading, reproduced by this model, fixed in the code)
  //   "no-live-check"          the send answers 200 without the live-link check after the email
  //   "accepted-only-check"    the live-link check as it was before F9's fix, which counted only for an accepted
  //                            email. An equivalent mutant: the model never closes a link during a failed email (see
  //                            sendCheck)
  //   "first-batch-keeps-link" the decline's first batch withdraws the offers but leaves a live link as it is
  //   "review-no-guards"       the review batch without A1 and A2 (A3 kept)
  //   "redeem-no-live-guard"   the redeem batch without A1 (A5 kept)
  //   "countersign-no-guards"  the countersign batch without A10 and A11
  //   "abandon-no-status-guard"
  //                            the abandon batch without A11 (A12 kept)
  //   "abandon-deposit-at-read"
  //                            the abandon's deposit condition judged at the read only, not in the batch (A12 gone from it)
  //   "review-no-signed-guard" the review batch without A3, so a review read before the client signed replaces the signed
  //                            agreement with a new review. In code the one-live-SOW index (0023:13) also refuses that
  //                            batch's insert of a new SOW while a client_signed or executed one exists, so dropping A3
  //                            alone is equivalent there; the model's condition stands for both (see reviewBatch)
  const MUTANT: str
  // Offer versions the owner can create. Two are enough for every path the properties need (a revision, a decline then
  // a new offer) and keep the random runs fast; the manual Apalache check uses the same module.
  const VERSIONS: int

  // ---- Bounds for the checker -------------------------------------------------------------------------------------
  // Two milestones with odd usual fees, in units where 1 is the smallest fee a client may pay ($1 in code). A discount
  // leaves at least 1, as in code (feeCents at least 100).
  val USUAL_0 = 5
  val USUAL_1 = 4
  // The clock ticks in 10-second steps. Each email (the client's, then the copy) ends within its 10-second timeout, so
  // within one tick of its start; a client email accepted just under its timeout, then a copy that times out, end within
  // two. The sending window G5 is 20 seconds, two ticks, and compares strictly (created_at > now - 20 s), so a link made
  // two ticks ago no longer blocks. The coarse clock lets a step that follows another by milliseconds in code share its
  // tick (docs/verification.md, "The clock").
  val EMAIL_TICKS = 1
  val WINDOW = 2
  // A4, the signing link's 30 seconds: three ticks, compared strictly (issued_at > at - 30 s).
  val LINK_WINDOW = 3
  // Emailed signing links (each with the session its redeem may make) the model can issue. Two are enough for a link
  // that a resend retires and one for the new version, and for a second link of one version issued before a project
  // starts (see noSessionForDeadOffer). A link lives an hour and a session two hours, past any run, so neither expires here.
  val LINK_IDS = 1.to(2)

  // d0 and d1: the discount on each milestone. std: the standard payment mode (deposit then balance), else invoice terms.
  type Terms = { d0: int, d1: int, std: bool }
  // status: "none" (not created), "draft", "sent", "superseded", "withdrawn".
  type Offer = { status: str, terms: Terms }
  // One invoice slot (version, milestone, kind), as software_invoices rows for it: status "none" (no row), "open",
  // "paid", "void". A void slot can be invoiced again (Replace invoice), so at most one row of a slot is live.
  type Bill = { status: str, amount: int }
  // A pending invoice reservation: the read was made, the batch has not run. reqAt: the request's updated_at it read.
  type Pending = { active: bool, slot: int, amount: int, reqAt: int }
  // The offer's agreement documents (software_agreements rows of one offer version; the MSA and the SOW as one). v 0: none.
  // terms: the terms the text was rendered from at the review. status: "review", "client_signed", "executed" or
  // "abandoned" (abandoned by the retirement from review, or by the owner from client_signed). session: the review session
  // (review_session_hash), the key of the link whose redeem made it. executed: executed_at is set.
  type Agreement = { v: int, terms: Terms, status: str, session: int, executed: bool }
  // An emailed signing link (software_agreement_links, purpose agreement) and the session its redeem made
  // (software_agreement_sessions; one link makes at most one, since the redeem uses it). v 0: no link. token: the offer link
  // it was issued under (link_hash, the software_offer_links token_hash). at: issued_at, in ticks. used: used_at is set.
  // session: its redeem made a session. revoked: that session's revoked_at is set.
  type Access = { v: int, token: int, at: int, used: bool, session: bool, revoked: bool }
  // A visitor's or the owner's request between its read and its batch. active: the read was made and the batch has not
  // run. k: the link (a redeem) or the session (a review, a sign) it read; v: the offer version it read; token: the offer
  // link it read (a link request); at: its `at` (a link request); terms: the offer's terms it read (a review).
  type Op = { active: bool, k: int, v: int, token: int, at: int, terms: Terms }
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
    badSend: bool,         // a send answered 200 while its link was not live at the check
    declined: bool,        // a decline's second batch resolved the request, and it was not reopened since
    badSession: bool,      // a redeem batch made a session while its offer was not signable
    badCountersign: bool,  // a countersign batch wrote while its agreement was not client_signed, its offer not sent,
                           // the request not open or signing off
  }

  // ---- State ------------------------------------------------------------------------------------------------------
  var offers: int -> Offer
  var versions: int            // versions created so far (the newest version)
  var sentTerms: int -> Terms  // the terms each version had when it was sent (ghost)
  var wasSent: Set[int]
  var requestOpen: bool        // false once declined (resolved); reopen makes it true again
  // owner_requests.updated_at as a counter: the decline's two batches and reopen write it. Draft, send and revoke never
  // do; the project start does only from status new (project.ts), which this model leaves out (see declineSecond).
  var requestVersion: int
  var agreement: Agreement
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
  var signingOn: bool          // software_signing_settings.software_signing_enabled
  var access: int -> Access    // the emailed signing links and their sessions, by key (LINK_IDS)
  // The versions whose client-signed agreement the owner abandoned (their rows stay, status abandoned).
  var abandonedVersions: Set[int]
  // The versions with a client signature (software_agreement_signatures, party client): a raise-only trigger keeps the
  // rows as they are, and nothing in a run deletes them.
  var clientSignatures: Set[int]
  // One of each request in flight at a time: a link request, a redeem, a review, a sign, a countersign, an abandon.
  var issuing: Op
  var redeeming: Op
  var reviewing: Op
  var signingReq: Op
  var countersigning: Op
  var abandoning: Op
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
  val sentVersions = versionIds.filter(v => offers.get(v).status == "sent")
  val noOp = { active: false, k: 0, v: 0, token: 0, at: 0, terms: noTerms }
  val noAccess = { v: 0, token: 0, at: 0, used: false, session: false, revoked: false }

  // The client's signature, as the properties name it: the agreement while it is client_signed or executed (G3's statuses).
  pure def isSigned(status: str): bool = status == "client_signed" or status == "executed"
  val signed =
    if (isSigned(agreement.status)) { v: agreement.v, terms: agreement.terms } else { v: 0, terms: noTerms }

  // The deposit guard of send (depositOfferGuard): no open or paid first deposit on another version. The code counts
  // every other version; the guard before decision 9 ("today-deposit-guard") counted only the sent one.
  def blocksSend(k: int, sendingV: int): bool =
    mOf(k) == 0 and kindOf(k) == "deposit" and vOf(k) != sendingV and
      (MUTANT != "today-deposit-guard" or offers.get(vOf(k)).status == "sent")

  // A12 (agreement.ts:34-35): a first deposit of the offer counts, open or paid (refunds are not modelled).
  def depositCounts(v: int): bool = live(bills.get(slotOf(v, 0, "deposit")))

  // G5, the sending window (offerSendingGuard in a batch, offerIsSending in a read): a live link made less than 20
  // seconds ago. Send, decline (both batches) and revoke refuse while it holds.
  val stillSending = link.live and clock - link.created < WINDOW

  // A1, liveSigningGuard (agreement-access.ts:317-327), for offer version v and the offer link `token` a signing link or
  // session names: the offer is sent, the request's link is that one and live, the request is open, the offer has no
  // project and signing is on. (The recipient is the same in every version here.)
  def liveSigning(v: int, token: int): bool = and {
    offers.get(v).status == "sent", link.live, link.token == token, requestOpen, project != v, signingOn,
  }

  // The retirement (retireSigning): the request's agreement in review abandoned, every signing link used and every
  // session revoked. Abandon runs the same for its own offer's links and sessions (agreement.ts:181-190).
  pure def retireAgreement(a: Agreement): Agreement = if (a.status == "review") { ...a, status: "abandoned" } else a
  pure def retireAccess(x: Access): Access = if (x.v == 0) x else { ...x, used: true, revoked: x.revoked or x.session }
  val retiredAccess = LINK_IDS.mapBy(k => retireAccess(access.get(k)))

  // A session that can be used: made and not revoked (and unexpired: two hours, past any run).
  val liveSessions = LINK_IDS.filter(k => access.get(k).session and not(access.get(k).revoked))
  // A request in flight between its read and its batch, or a link issued and not yet redeemed: the times the signing
  // switch can change what a batch decides (see switchSigning).
  val signingInFlight = or {
    issuing.active, redeeming.active, reviewing.active, signingReq.active, countersigning.active,
    LINK_IDS.exists(k => access.get(k).v != 0 and not(access.get(k).used)),
  }

  // ---- Actions ----------------------------------------------------------------------------------------------------
  action init = all {
    offers' = versionIds.mapBy(_ => { status: "none", terms: noTerms }),
    versions' = 0,
    sentTerms' = versionIds.mapBy(_ => noTerms),
    wasSent' = Set(),
    requestOpen' = true,
    requestVersion' = 0,
    agreement' = { v: 0, terms: noTerms, status: "none", session: 0, executed: false },
    project' = 0,
    projectTerms' = noTerms,
    bills' = slots.mapBy(_ => { status: "none", amount: 0 }),
    pending' = { active: false, slot: 0, amount: 0, reqAt: 0 },
    clock' = 0,
    link' = { live: false, created: 0, token: 0 },
    sending' = { phase: "none", v: 0, token: 0, start: 0, accepted: false },
    declining' = { phase: "none", start: 0 },
    // The owner turned website signing on before the run (the migration stores it off); switchSigning turns it off and on.
    signingOn' = true,
    access' = LINK_IDS.mapBy(_ => noAccess),
    abandonedVersions' = Set(),
    clientSignatures' = Set(),
    issuing' = noOp, redeeming' = noOp, reviewing' = noOp, signingReq' = noOp, countersigning' = noOp, abandoning' = noOp,
    ghost' = { badSign: false, badInvoice: false, badSend: false, declined: false, badSession: false, badCountersign: false },
  }

  // Everything else stays as it is.
  action keepOffers = all { offers' = offers, versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent }
  action keepClient = all {
    agreement' = agreement, access' = access, abandonedVersions' = abandonedVersions, clientSignatures' = clientSignatures,
  }
  action keepMoney = all { bills' = bills, pending' = pending, project' = project, projectTerms' = projectTerms }
  action keepFlows = all { clock' = clock, link' = link, sending' = sending, declining' = declining }
  action keepRequest = all { requestOpen' = requestOpen, requestVersion' = requestVersion }
  action keepSigning = all {
    signingOn' = signingOn, issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
    countersigning' = countersigning, abandoning' = abandoning,
  }

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
      sentTerms' = sentTerms, wasSent' = wasSent, keepRequest,
      keepClient, keepMoney, keepFlows, keepSigning, ghost' = ghost,
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
      versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent, keepRequest,
      keepClient, keepMoney, keepFlows, keepSigning, ghost' = ghost,
    }
  }

  // Send, the batch, for a draft: the sent offer becomes superseded, signing is retired (the review abandoned, the sessions
  // revoked, the signing links used), and the link row is written with a new token and created now. Refused after the
  // client signed (G3), while any other version has an open or paid first deposit (G4) and within 20 seconds of a live link
  // (G5). The model lets one send be in flight at a time (see docs/verification.md, "What it does not cover").
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
      agreement' = retireAgreement(agreement), access' = retiredAccess, abandonedVersions' = abandonedVersions,
      clientSignatures' = clientSignatures,
      link' = { live: true, created: clock, token: link.token + 1 },
      sending' = { phase: "email", v: v, token: link.token + 1, start: clock, accepted: false },
      clock' = clock, declining' = declining,
      keepRequest, keepMoney, keepSigning, ghost' = ghost,
    }
  }

  // Send, the batch, for the sent version (a reissue): the link must be revoked (G9), so G5 holds; the offer keeps its
  // status and terms, the link row gets a new token created now, and signing is retired. G3 as for a draft; G4 is a
  // draft's only. The route sends the open draft when there is one (`draft ?? sent`), and a command for the sent version
  // then answers NoOfferToSend, so a reissue needs no open draft.
  action reissue = {
    nondet v = versionIds.oneOf()
    all {
      sending.phase == "none",
      requestOpen, project == 0, offers.get(v).status == "sent", not(hasDraft),
      signed.v == 0 or MUTANT == "send-after-sign",
      link.token != 0, not(link.live),
      link' = { live: true, created: clock, token: link.token + 1 },
      sending' = { phase: "email", v: v, token: link.token + 1, start: clock, accepted: false },
      agreement' = retireAgreement(agreement), access' = retiredAccess, abandonedVersions' = abandonedVersions,
      clientSignatures' = clientSignatures,
      keepOffers, clock' = clock, declining' = declining,
      keepRequest, keepMoney, keepSigning, ghost' = ghost,
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
      keepOffers, keepClient, keepMoney, keepRequest, keepSigning,
      clock' = clock, link' = link, declining' = declining, ghost' = ghost,
    }
  }

  // Send, the live-link check after the email: the link row still has this send's token and is not revoked, and the offer
  // is still sent. With the link not live the send answers 409, whatever became of the client email (F9, fixed in #314);
  // otherwise 200. The check writes nothing. "accepted-only-check" is the check as it was before F9's fix, which counted
  // only for an accepted email.
  action sendCheck = {
    val linkLive = link.live and link.token == sending.token and offers.get(sending.v).status == "sent"
    val answers200 = linkLive or MUTANT == "no-live-check" or (MUTANT == "accepted-only-check" and not(sending.accepted))
    all {
      sending.phase == "check",
      sending' = { ...sending, phase: "none" },
      ghost' = { ...ghost, badSend: ghost.badSend or (answers200 and not(linkLive)) },
      keepOffers, keepClient, keepMoney, keepRequest, keepSigning,
      clock' = clock, link' = link, declining' = declining,
    }
  }

  // The owner closes the link, in any request status: G5, and G10 (the link the page showed is still live). Signing is
  // retired.
  action revoke = all {
    link.live, not(stillSending),
    link' = { ...link, live: false },
    agreement' = retireAgreement(agreement), access' = retiredAccess, abandonedVersions' = abandonedVersions,
      clientSignatures' = clientSignatures,
    keepOffers, keepMoney, keepRequest, keepSigning,
    clock' = clock, sending' = sending, declining' = declining, ghost' = ghost,
  }

  // Decline, the first batch: sent and draft offers are withdrawn, live links revoked, signing retired; the request stays
  // new or reviewed. Refused once resolved, with a project (G2), after the client signed (G3), while a deposit is open (a
  // paid one does not block: depositOfferGuard with decline = true, G4) and within 20 seconds of a live link (G5). The
  // model lets one decline be in flight at a time. It writes the request's updated_at.
  action declineFirst = all {
    declining.phase == "none",
    requestOpen, project == 0, signed.v == 0,
    not(liveSlots.exists(k => kindOf(k) == "deposit" and bills.get(k).status == "open")),
    not(stillSending),
    offers' = versionIds.mapBy(w => if (draftOrSent(offers.get(w))) { ...offers.get(w), status: "withdrawn" } else offers.get(w)),
    versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent,
    link' = if (MUTANT == "first-batch-keeps-link") link else { ...link, live: false },
    declining' = { phase: "email", start: clock },
    agreement' = retireAgreement(agreement), access' = retiredAccess, abandonedVersions' = abandonedVersions,
      clientSignatures' = clientSignatures,
    requestOpen' = requestOpen, requestVersion' = requestVersion + 1, keepMoney, clock' = clock,
    sending' = sending, keepSigning, ghost' = ghost,
  }

  // Decline, the email: the client email, then the copy, timed as for send. A failed client email ends the decline (502):
  // the offers stay withdrawn and nothing more is written.
  action declineEmail = {
    nondet accepted = Set(true, false).oneOf()
    all {
      declining.phase == "email",
      clock <= declining.start + (if (accepted) 2 * EMAIL_TICKS else EMAIL_TICKS),
      declining' = { ...declining, phase: if (accepted) "second" else "none" },
      keepOffers, keepClient, keepMoney, keepRequest, keepSigning,
      clock' = clock, link' = link, sending' = sending, ghost' = ghost,
    }
  }

  // Decline, the second batch: G1 at the write time, G2, G5 and, since F10's fix, no offer of the request draft or sent
  // (G6, the audio project, is not modelled). The draft and send batches never write updated_at, so G1 does not see an
  // offer saved during the email; the fix's own condition does (read after the email, then re-checked by a guard in the
  // batch: one step here, since nothing in the model writes between the two). G1 holds here: between the batches only
  // reopen could write updated_at, and it needs the request resolved. In code a project start from status new writes it
  // too (project.ts), and G2 refuses the batch after a start anyway; question and fit write it and are not modelled. It
  // resolves the request. A refused batch answers 409 and writes nothing.
  action declineSecond = {
    val noOffers = versionIds.forall(v => not(draftOrSent(offers.get(v))))
    val writes = and {
      project == 0,
      MUTANT == "second-batch-no-sending-guard" or not(stillSending),
      MUTANT == "today-second-batch" or noOffers,
    }
    all {
      declining.phase == "second",
      declining' = { ...declining, phase: "none" },
      requestOpen' = if (writes) false else requestOpen,
      requestVersion' = if (writes) requestVersion + 1 else requestVersion,
      ghost' = if (writes) { ...ghost, declined: true } else ghost,
      keepOffers, keepClient, keepMoney, keepSigning, clock' = clock, link' = link, sending' = sending,
    }
  }

  // The owner reopens the resolved request (no project yet), so a new offer can be made.
  action reopen = all {
    not(requestOpen), project == 0,
    requestOpen' = true,
    requestVersion' = requestVersion + 1,
    keepOffers, keepClient, keepMoney, keepFlows, keepSigning,
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
    keepOffers, keepClient, keepMoney, keepRequest, keepSigning, ghost' = ghost,
  }

  // The owner switches website signing off or on: one update (owner/agreements.ts:149-162) that retires nothing, so a
  // link issued, a session made or a review saved while it was on stays as it is. Turning it off is offered only while a
  // signing request is between its read and its batch or a signing link is unredeemed, where it can change what a batch
  // decides; at any other moment it only makes the signing reads refuse, which a run gets by not taking them (the same
  // bias as the audio models' closing steps).
  action switchSigning = all {
    not(signingOn) or signingInFlight,
    signingOn' = not(signingOn),
    issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
    countersigning' = countersigning, abandoning' = abandoning,
    keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
  }

  // The signing link, the reads (agreement-access.ts:135-206): signing on, the offer the link opens (getLinkedOffer: the
  // link live, the offer sent, the request open), and `at`; the allowances and Turnstile are not modelled. A free key for
  // the link is part of the bound, not of the code.
  action linkRead = {
    nondet v = sentVersions.oneOf()
    all {
      not(issuing.active), signingOn, link.live, requestOpen,
      LINK_IDS.exists(k => access.get(k).v == 0),
      issuing' = { ...noOp, active: true, v: v, token: link.token, at: clock },
      redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The link batch (207-242): A4 (no signing link of the recipient and the offer issued in the 30 seconds before `at`) and
  // A1 (for the offer and the offer link read); the link inserted, issued at `at`. A refused batch answers 429 and writes
  // nothing. The email and what follows it (a refused email deletes the link, an accepted one consumes the older ones, A6)
  // are not modelled: here the visitor holds the link as soon as it is stored.
  action linkBatch = {
    val x = issuing
    val a4 = LINK_IDS.forall(j => access.get(j).v != x.v or access.get(j).at <= x.at - LINK_WINDOW)
    val writes = a4 and liveSigning(x.v, x.token)
    // The lowest free key: the read found one, and only this request issues links.
    val k = LINK_IDS.filter(j => access.get(j).v == 0).fold(0, (m, j) => if (m == 0 or j < m) j else m)
    all {
      issuing.active,
      issuing' = noOp,
      access' = if (writes) access.set(k, { ...noAccess, v: x.v, token: x.token, at: x.at }) else access,
      agreement' = agreement, abandonedVersions' = abandonedVersions, clientSignatures' = clientSignatures,
      redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The redeem, the read (349-362): the link by its key, unused (and unexpired).
  action redeemRead = {
    nondet k = LINK_IDS.filter(j => access.get(j).v != 0 and not(access.get(j).used)).oneOf()
    all {
      not(redeeming.active),
      redeeming' = { ...noOp, active: true, k: k },
      issuing' = issuing, reviewing' = reviewing, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The redeem batch (387-425): A1 for the link's offer and offer link ("redeem-no-live-guard" drops it) and A5 (the link
  // still unused); the link used and the session inserted. A refused batch answers 401 (the expired page) and writes
  // nothing.
  action redeemBatch = {
    val k = redeeming.k
    val x = access.get(k)
    val signable = liveSigning(x.v, x.token)
    val writes = (signable or MUTANT == "redeem-no-live-guard") and not(x.used)
    all {
      redeeming.active,
      redeeming' = noOp,
      access' = if (writes) access.set(k, { ...x, used: true, session: true }) else access,
      ghost' = { ...ghost, badSession: ghost.badSession or (writes and not(signable)) },
      agreement' = agreement, abandonedVersions' = abandonedVersions, clientSignatures' = clientSignatures,
      issuing' = issuing, reviewing' = reviewing, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepMoney, keepFlows, keepRequest,
    }
  }

  // The checks every signing read of the visitor makes (review.ts:65-78, sign.ts:43-56): getLinkedOffer through the
  // session's offer link, agreementSession (the session unrevoked, its offer still sent through the live link it names,
  // the request open), and signing on.
  def sessionOpens(k: int): bool = {
    val x = access.get(k)
    and { x.session, not(x.revoked), offers.get(x.v).status == "sent", link.live, link.token == x.token, requestOpen, signingOn }
  }

  // Review, the reads: the session's checks, then the draft batch (A1 A2 A3; the draft is not modelled, and a project is
  // refused there by A1) and reviewAgreements' reads (no agreement of the offer client_signed or executed). The text is
  // rendered from the offer's terms as read here.
  action reviewRead = {
    nondet k = liveSessions.oneOf()
    val x = access.get(k)
    all {
      not(reviewing.active),
      sessionOpens(k), project != x.v,
      not(agreement.v == x.v and isSigned(agreement.status)),
      reviewing' = { ...noOp, active: true, k: k, v: x.v, terms: offers.get(x.v).terms },
      issuing' = issuing, redeeming' = redeeming, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The review batch: A1 and A2 ("review-no-guards" drops both) and A3 (software-agreements.ts:310-314: no agreement of the
  // offer client_signed or executed; "review-no-signed-guard" drops it); the offer's review rows replaced by the new ones,
  // rendered at the read, under this session. A refused batch answers 409 and writes nothing. A3's condition is also what
  // the one-live-SOW index (migrations/music/0023_software_signing.sql:13) gives this batch: its delete removes only rows
  // in review, so its insert of a new SOW fails while a client_signed or executed SOW of the offer exists. The model holds
  // the two as one condition.
  action reviewBatch = {
    val r = reviewing
    val x = access.get(r.k)
    val a3 = not(agreement.v == r.v and isSigned(agreement.status))
    val writes = (a3 or MUTANT == "review-no-signed-guard") and
      (MUTANT == "review-no-guards" or (liveSigning(r.v, x.token) and not(x.revoked)))
    all {
      reviewing.active,
      reviewing' = noOp,
      agreement' = if (writes) { v: r.v, terms: r.terms, status: "review", session: r.k, executed: false } else agreement,
      access' = access, abandonedVersions' = abandonedVersions, clientSignatures' = clientSignatures,
      issuing' = issuing, redeeming' = redeeming, signingReq' = signingReq, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // Sign, the reads: the session's checks and signAgreements' reads (software-agreements.ts:405-429): the offer's
  // agreements that are not executed are the documents named, still in review (documents all client_signed answer the
  // saved receipt and write nothing). The read compares the documents, not the session that reviewed them: only the
  // batch's A9 does that, so the model's read does not either. "sign-guards-at-read" judges the batch's guards here instead
  // (A1, whose project condition the reads lack, A2 and A9). "no-sign-guards" checks none of it: the session signs the
  // offer's documents it holds, unless they are signed already.
  action signRead = {
    nondet k = LINK_IDS.filter(j => access.get(j).session).oneOf()
    val x = access.get(k)
    val reads = sessionOpens(k) and agreement.v == x.v and agreement.status == "review"
    all {
      not(signingReq.active),
      if (MUTANT == "no-sign-guards") (agreement.v == x.v and not(isSigned(agreement.status)))
      else reads and (MUTANT != "sign-guards-at-read" or (liveSigning(x.v, x.token) and agreement.session == k)),
      signingReq' = { ...noOp, active: true, k: k, v: x.v },
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The sign batch: A1, A2 and A9 (each document still in review under this review session; A7, the draft, and A8, a
  // reused MSA, are not modelled); the documents client_signed. A refused batch answers 409 and writes nothing. The two
  // mutants drop the three guards; the documents are updated by id, so they change only if they are this version's.
  action signBatch = {
    val s = signingReq
    val x = access.get(s.k)
    val guards = and {
      liveSigning(s.v, x.token), not(x.revoked),
      agreement.v == s.v, agreement.status == "review", agreement.session == s.k,
    }
    val writes = guards or ((MUTANT == "no-sign-guards" or MUTANT == "sign-guards-at-read") and agreement.v == s.v)
    all {
      signingReq.active,
      signingReq' = noOp,
      agreement' = if (writes) { ...agreement, status: "client_signed" } else agreement,
      clientSignatures' = if (writes) clientSignatures.union(Set(agreement.v)) else clientSignatures,
      ghost' = { ...ghost, badSign: ghost.badSign or (writes and offers.get(s.v).status != "sent") },
      access' = access, abandonedVersions' = abandonedVersions,
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, countersigning' = countersigning,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepMoney, keepFlows, keepRequest,
    }
  }

  // Countersign, the reads (agreement.ts:60-74; software-agreements.ts:652-662): the request's sent offer, signing on, and
  // the offer's client_signed documents, which are the ones the owner names.
  action countersignRead = {
    nondet v = sentVersions.oneOf()
    all {
      not(countersigning.active), signingOn, agreement.v == v, agreement.status == "client_signed",
      countersigning' = { ...noOp, active: true, v: v },
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The countersign batch (673-730): A10 (the offer sent, the request open, signing on) and A11 (each document still
  // client_signed with the hash read) ("countersign-no-guards" drops both; A8, a reused MSA, is not modelled); the documents
  // executed. The signatures, the packet rows and the two copies it inserts are not modelled here (the copies are the
  // `copy` kind of audio-project-notices.qnt). A refused batch answers 409 and writes nothing.
  action countersignBatch = {
    val v = countersigning.v
    val a10 = offers.get(v).status == "sent" and requestOpen and signingOn
    val a11 = agreement.v == v and agreement.status == "client_signed"
    val writes = (a10 and a11) or (MUTANT == "countersign-no-guards" and agreement.v == v)
    all {
      countersigning.active,
      countersigning' = noOp,
      agreement' = if (writes) { ...agreement, status: "executed", executed: true } else agreement,
      ghost' = { ...ghost, badCountersign: ghost.badCountersign or (writes and not(a10 and a11)) },
      access' = access, abandonedVersions' = abandonedVersions, clientSignatures' = clientSignatures,
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
      abandoning' = abandoning, signingOn' = signingOn,
      keepOffers, keepMoney, keepFlows, keepRequest,
    }
  }

  // Abandon, the reads (agreement.ts:120-138): the request's sent offer, the offer's client_signed documents, which are
  // the ones the owner names, and its first deposit (A12's condition, read first: none counts).
  action abandonRead = {
    nondet v = sentVersions.oneOf()
    all {
      not(abandoning.active), agreement.v == v, agreement.status == "client_signed", not(depositCounts(v)),
      abandoning' = { ...noOp, active: true, v: v },
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
      countersigning' = countersigning, signingOn' = signingOn,
      keepOffers, keepClient, keepMoney, keepFlows, keepRequest, ghost' = ghost,
    }
  }

  // The abandon batch (139-194): A12 ("abandon-deposit-at-read" drops it) and A11, each document still client_signed, of
  // this request and offer ("abandon-no-status-guard" drops it); the documents abandoned, the offer superseded while it is
  // sent, the offer link revoked, the offer's sessions revoked and its signing links used (its drafts deleted and the
  // obsolete notices failed are not modelled here). A refused batch answers 409 and writes nothing.
  action abandonBatch = {
    val v = abandoning.v
    val a12 = not(depositCounts(v))
    val a11 = agreement.v == v and agreement.status == "client_signed"
    val writes = (a12 or MUTANT == "abandon-deposit-at-read") and (a11 or MUTANT == "abandon-no-status-guard")
    all {
      abandoning.active,
      abandoning' = noOp,
      agreement' = if (writes and agreement.v == v) { ...agreement, status: "abandoned" } else agreement,
      abandonedVersions' = if (writes) abandonedVersions.union(Set(v)) else abandonedVersions,
      clientSignatures' = clientSignatures,
      offers' =
        if (writes and offers.get(v).status == "sent") offers.set(v, { ...offers.get(v), status: "superseded" }) else offers,
      versions' = versions, sentTerms' = sentTerms, wasSent' = wasSent,
      link' = if (writes) { ...link, live: false } else link,
      access' =
        if (writes) LINK_IDS.mapBy(k => if (access.get(k).v == v) retireAccess(access.get(k)) else access.get(k)) else access,
      issuing' = issuing, redeeming' = redeeming, reviewing' = reviewing, signingReq' = signingReq,
      countersigning' = countersigning, signingOn' = signingOn,
      clock' = clock, sending' = sending, declining' = declining,
      keepMoney, keepRequest, ghost' = ghost,
    }
  }

  // The owner starts the project from a website signing: the offer's agreement executed (executedOfferAgreement; its
  // packet and the two delivered copies are not modelled), the offer sent, the request open, and on standard terms the
  // first deposit paid. The project copies the offer's terms. A website start retires no link and no session
  // (project.ts:270-279 retires only for an outside signature), so a link issued before it stays unused and a session
  // open, and only A1 refuses them afterwards.
  action start = all {
    agreement.status == "executed", project == 0, requestOpen, offers.get(agreement.v).status == "sent",
    not(offers.get(agreement.v).terms.std) or bills.get(slotOf(agreement.v, 0, "deposit")).status == "paid",
    project' = agreement.v,
    // INSERT INTO software_projects ... SELECT ... terms_json FROM software_offers WHERE id = the signed offer.
    projectTerms' =
      if (MUTANT == "start-copies-newest") offers.get(versions).terms
      else if (MUTANT == "start-drops-discount") { ...offers.get(agreement.v).terms, d0: 0, d1: 0 }
      else offers.get(agreement.v).terms,
    bills' = bills, pending' = pending,
    keepOffers, keepClient, keepRequest, keepFlows, keepSigning, ghost' = ghost,
  }

  // reserveSoftwareInvoice, the reads: the request open (not resolved or withdrawn) with the updated_at it has now, the
  // offer (sent, or the project's), the slot (before the project only the first deposit), no live invoice in the slot;
  // the amount comes from the offer's terms_json as read now, also after the project started (the code reads
  // software_offers, not the project's copy).
  action invoiceRead = {
    nondet k = slots.oneOf()
    val t = offers.get(vOf(k)).terms
    val amountTerms = if (MUTANT == "latest-terms" and versions > 0) offers.get(versions).terms else t
    all {
      not(pending.active),
      requestOpen,
      if (project != 0) vOf(k) == project else offers.get(vOf(k)).status == "sent",
      inPlan(t, kindOf(k)),
      project != 0 or (mOf(k) == 0 and kindOf(k) == "deposit"),
      not(live(bills.get(k))),
      pending' = { active: true, slot: k, amount: installment(amountTerms, mOf(k), kindOf(k)), reqAt: requestVersion },
      bills' = bills, project' = project, projectTerms' = projectTerms,
      keepOffers, keepClient, keepRequest, keepFlows, keepSigning, ghost' = ghost,
    }
  }

  // reserveSoftwareInvoice, the batch: the request's updated_at is the one read, the offer is still sent and there is no
  // project (or the project is this offer's), and the slot is still free; then the invoice row is inserted with the
  // amount computed at the read.
  action invoiceWrite = {
    val k = pending.slot
    val offerOk = if (project != 0) vOf(k) == project else offers.get(vOf(k)).status == "sent"
    val writes = (offerOk or MUTANT == "no-write-status-guard") and requestVersion == pending.reqAt and not(live(bills.get(k)))
    all {
      pending.active,
      pending' = { ...pending, active: false },
      bills' = if (writes) bills.set(k, { status: "open", amount: pending.amount }) else bills,
      ghost' = { ...ghost, badInvoice: ghost.badInvoice or (writes and not(offerOk)) },
      project' = project, projectTerms' = projectTerms, keepOffers, keepClient, keepRequest, keepFlows, keepSigning,
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
      keepOffers, keepClient, keepRequest, keepFlows, keepSigning, ghost' = ghost,
    }
  }

  action step = any {
    newDraft, editDraft, sendDraft, reissue, sendEmail, sendCheck, revoke, declineFirst, declineEmail, declineSecond,
    reopen, tick, switchSigning, linkRead, linkBatch, redeemRead, redeemBatch, reviewRead, reviewBatch, signRead,
    signBatch, countersignRead, countersignBatch, abandonRead, abandonBatch, start, invoiceRead, invoiceWrite, settle,
  }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is, so the end
  // of a run is not reported as a deadlock. The random runs use `step`.
  action finished = all {
    keepOffers, keepClient, keepMoney, keepFlows, keepRequest, keepSigning, ghost' = ghost,
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
  //    was not sent at that moment, and a signed offer stays the sent one (an abandoned signing is no longer signed).
  val supersededInert = and {
    not(ghost.badSign), not(ghost.badInvoice),
    signed.v == 0 or offers.get(signed.v).status == "sent",
  }

  // 6. A request a decline resolved has no draft or sent offer and no live link (docs/plans/2026-11-offers-conversion.md,
  //    sections 5 and 7: F10, fixed).
  val declinedHasNoOffer =
    not(ghost.declined) or (versionIds.forall(v => not(draftOrSent(offers.get(v)))) and not(link.live))

  // 7. A send that answers 200 had its link live at the check, whatever became of its client email (F9).
  val sendLinkLive = not(ghost.badSend)

  // 8. A review that is not abandoned was rendered from the version that is sent now: a send, a reissue, a revoke or a
  //    decline abandons the review it overtakes, and the review batch re-checks its offer and its session (a resend during
  //    a review leaves no review of the old version).
  val reviewOfSentOffer =
    agreement.status != "review" or
      (offers.get(agreement.v).status == "sent" and agreement.terms == offers.get(agreement.v).terms)

  // 9. No session is made while its offer is not signable: not sent, its offer link revoked or replaced, the request
  //    closed, a project, or signing off.
  val noSessionForDeadOffer = not(ghost.badSession)

  // 10. An executed agreement is never abandoned, and its offer stays sent until the project starts.
  val executedStays =
    not(agreement.executed) or
      (agreement.status == "executed" and (project != 0 or offers.get(agreement.v).status == "sent"))

  // 11. Countersign executes only a client_signed agreement of the sent offer, with the request open and signing on.
  val executedOnlyWhenSigned = not(ghost.badCountersign)

  // 12. An abandoned signing's version has no open or paid first deposit.
  val abandonedHasNoDeposit = abandonedVersions.forall(v => not(depositCounts(v)))

  // 13. Once a version's documents are client_signed they never return to review: they move only to executed or abandoned.
  //    A review read before the signature cannot replace the signed documents with a new review (A3 in the review batch).
  val signedStaysSigned = agreement.status != "review" or not(clientSignatures.contains(agreement.v))

  val allProperties = and {
    invoicedMatchesSigned, sentTermsFrozen, oneVersionInvoiced, installmentsSum, supersededInert, declinedHasNoOffer,
    sendLinkLive, reviewOfSentOffer, noSessionForDeadOffer, executedStays, executedOnlyWhenSigned, abandonedHasNoDeposit,
    signedStaysSigned,
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

  // F10 witnesses, for a hand run with the negated invariant on `discountTodaySecondBatch` (the second batch before the
  // fix), where they are violated, and on `discount`, where they hold (docs/verification.md): a request resolved by a
  // decline with a draft left, and with a sent offer and its live link left.
  val neverDeclinedWithDraft = not(ghost.declined and versionIds.exists(v => offers.get(v).status == "draft"))
  val neverDeclinedWithLiveOffer = not(ghost.declined and versionIds.exists(v => offers.get(v).status == "sent") and link.live)

  // Signing witnesses, for a hand run with the negated invariant on `discount`: an agreement executed; a signing the
  // owner abandoned, then another version signed; a session made and then left open by a website start.
  val neverExecuted = not(agreement.executed)
  val neverSignedAfterAbandon = not(abandonedVersions.size() > 0 and isSigned(agreement.status))
  val neverSessionAfterStart = not(project != 0 and liveSessions.exists(k => access.get(k).v == project))
}

module discount { import discountOffers(MUTANT = "none", VERSIONS = 2).* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs, except the
// equivalent mutants there (discountSecondBatchNoSendingGuard and discountAcceptedOnlyCheck), which must keep every
// property.
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
module discountSecondBatchNoSendingGuard { import discountOffers(MUTANT = "second-batch-no-sending-guard", VERSIONS = 2).* }
module discountTodaySecondBatch { import discountOffers(MUTANT = "today-second-batch", VERSIONS = 2).* }
module discountNoLiveCheck { import discountOffers(MUTANT = "no-live-check", VERSIONS = 2).* }
module discountAcceptedOnlyCheck { import discountOffers(MUTANT = "accepted-only-check", VERSIONS = 2).* }
module discountFirstBatchKeepsLink { import discountOffers(MUTANT = "first-batch-keeps-link", VERSIONS = 2).* }
module discountReviewNoGuards { import discountOffers(MUTANT = "review-no-guards", VERSIONS = 2).* }
module discountSignGuardsAtRead { import discountOffers(MUTANT = "sign-guards-at-read", VERSIONS = 2).* }
module discountRedeemNoLiveGuard { import discountOffers(MUTANT = "redeem-no-live-guard", VERSIONS = 2).* }
module discountAbandonNoStatusGuard { import discountOffers(MUTANT = "abandon-no-status-guard", VERSIONS = 2).* }
module discountCountersignNoGuards { import discountOffers(MUTANT = "countersign-no-guards", VERSIONS = 2).* }
module discountAbandonDepositAtRead { import discountOffers(MUTANT = "abandon-deposit-at-read", VERSIONS = 2).* }
module discountReviewNoSignedGuard { import discountOffers(MUTANT = "review-no-signed-guard", VERSIONS = 2).* }
