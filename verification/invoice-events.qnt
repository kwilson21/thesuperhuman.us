// Quint model of one invoice row receiving Stripe events in any order, with interleaved handlers.
// Code modelled:
//   audio:    src/pages/api/stripe/webhook.ts, applyStripeInvoiceEvent, recoverInvoiceFromWebhook, recordInvoice,
//             isKnownInvoiceAttempt (src/lib/audio-payments.ts)
//   software: applySoftwareInvoiceEvent, recordSoftwareInvoice (src/lib/software-invoices.ts)
//   both:     invoiceEventDecision and guardTime (src/lib/invoice-event-order.ts)
// See docs/verification.md for what is and is not covered.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module invoiceEvents {
  // "audio":    the row starts not_created. A delivery is several steps: read the row, then either apply (read again, decide
  //             from that read, write a batch) or, when the row shows no matching id, check the attempts table and recover.
  //             Ties between non-paid events at the same second: the later arrival wins.
  // "software": the row starts creating. A delivery reads the row only to match it, then writes a guarded batch; the SQL
  //             guard alone decides. Ties: the higher-ranked status wins.
  const DOMAIN: str
  // "none" is the code as it is now. Every other value changes one thing so a property must fail (the mutants):
  //   "old-rule"              an event older than the stored time is ignored, even a paid one            (PR 251 bug a)
  //   "stale-guard"           the guard time is chosen from the stale read                               (PR 251 bug b)
  //   "no-id-pin"             the write guard does not pin the Stripe invoice id                         (PR 251 bug c; audio: recovery's guarded update)
  //   "pre-fix-link"          an event whose id equals the id just linked is parked as a conflict       (the unlinked-invoice bug)
  //   "no-time-guard"         the write guard has no time comparison
  //   "overwrite-paid"        the write guard does not refuse a paid row
  //   "no-dup-detection"      a recorded event is not recognised again, at read or at write
  //   "recover-no-dup-guard"  audio: the recovery batch's guarded update does not refuse an event already processed (found by the model)
  //   "no-rank"               software: a same-second tie never applies (the rank tie-break is gone)
  //   "rank-ge"               software: a tie applies on equal rank (>= instead of >)
  //   "audio-lt"              audio: the write guard is < instead of <=, so a same-second tie never applies
  //   "never-unmatched"       an event for a different Stripe invoice is not recorded as unmatched
  //   "processed-on-mismatch" an event is recorded processed even though the id no longer matches
  //   "store-guard-time"      the guard time is stored as the event time
  // Three more are equivalent in this model: the property still holds, for a stated reason (docs/verification.md):
  //   "no-decision"           audio: the stale-read decision is ignored (the write guard alone is enough)
  //   "no-read-unmatched"     software: no unmatched check at read (the write batch records it)
  //   (software "no-dup-detection" is the third: a repeat of a software event leaves the row as it was)
  const MUTANT: str
  // Handler runs per check: 4 for the CI run; the manual Apalache check uses fewer so it can finish.
  const DELIVERIES: int

  // ---- Bounds for the checker -------------------------------------------------------------------------------------
  val MAX_EVENTS = 3      // events Stripe sends for this invoice
  val MAX_TIME = 3        // event times are 1..3, so ties and both orders occur
  val MAX_DELIVERIES = DELIVERIES  // handler runs; more than MAX_EVENTS (3) so redeliveries and retries occur
  val FAR_FUTURE = 100    // the guard value LATEST_TIME in code; it is bound in a query and never stored
  val REAL_ID = 1         // the Stripe invoice the creation response links
  val OTHER_ID = 2        // a different Stripe invoice id for the same row
  val STATUSES = Set("open", "payment_failed", "void", "uncollectible", "paid")
  val START = if (DOMAIN == "audio") "not_created" else "creating"

  type Event = { status: str, at: int, inv: int }
  // The stored row. at: 0 means none (SQL NULL). id: 0 means none. rec: the event that linked it by recovery, 0 none.
  type Row = { status: str, at: int, id: int, rec: int }
  // phase: "idle", then (audio) "attempt", "recover-read", "recover-write", "apply-read", "apply-write", or (software)
  // "apply-write", then "done".
  // outcome: "" until done, then "processed", "unmatched", "duplicate", or (audio only) "failed": the write batch
  // rolled back on a duplicate primary key, the webhook answered 500 and Stripe retries (a later delivery).
  type Delivery = { phase: str, ev: int, outcome: str, rStatus: str, rAt: int, rId: int }
  // Ghost flags, set by a write step from the row as it really is at write time, never from the stale read.
  type Ghost = {
    everPaid: bool,         // the row has been paid at some point
    badStale: bool,         // a non-paid event older than the stored time replaced a non-paid status
    badId: bool,            // a write changed a stored Stripe id, or changed the status for a different id
    badTie: bool,           // a same-second tie was resolved against the domain's rule
    badRedelivery: bool,    // an event already recorded as processed changed the row again (a write that leaves it as it was does not count)
  }

  // ---- State ------------------------------------------------------------------------------------------------------
  var row: Row
  var attempts: Set[int]     // Stripe invoice ids in stripe_invoice_attempts (audio)
  var processed: Set[int]    // event ids recorded in stripe_webhook_events
  var unmatched: Set[int]    // event ids recorded in the unmatched table
  var events: int -> Event   // what Stripe has sent (ids 1..3)
  var deliveries: int -> Delivery
  var ghost: Ghost

  // ---- The rule, as pure functions --------------------------------------------------------------------------------
  pure def rank(s: str): int =
    if (s == "paid") 5 else if (s == "void") 4 else if (s == "uncollectible") 3
    else if (s == "payment_failed") 2 else if (s == "open") 1 else 0

  // invoiceEventDecision in src/lib/invoice-event-order.ts. tie is "latest" or "rank".
  pure def decision(stStatus: str, stAt: int, inStatus: str, inAt: int, tie: str): bool =
    if (stStatus == "paid") false
    else if (inStatus == "paid") true
    else if (stAt == 0 or inAt > stAt) true
    else if (inAt < stAt) false
    else if (tie == "latest") true
    else rank(inStatus) > rank(stStatus)

  // The "old-rule" mutant: no paid shortcut, so a paid event older than the stored time is ignored.
  pure def oldDecision(stStatus: str, stAt: int, inStatus: str, inAt: int, tie: str): bool =
    if (stStatus == "paid") false
    else if (stAt == 0 or inAt > stAt) true
    else if (inAt < stAt) false
    else if (tie == "latest") true
    else rank(inStatus) > rank(stStatus)

  // guardTime in code: a paid event is bound later than any stored time. "stale-guard" binds it only if the read was newer.
  pure def guardTime(inStatus: str, inAt: int, readAt: int): int =
    if (MUTANT == "old-rule") inAt
    else if (MUTANT == "stale-guard") (if (inStatus == "paid" and readAt > inAt) FAR_FUTURE else inAt)
    else if (inStatus == "paid") FAR_FUTURE
    else inAt

  // The time written to the row: the event's own time ("store-guard-time" writes the guard value instead).
  pure def storedTime(e: Event, readAt: int): int =
    if (MUTANT == "store-guard-time") guardTime(e.status, e.at, readAt) else e.at

  val tie = if (DOMAIN == "audio") "latest" else "rank"
  val dupDetected = MUTANT != "no-dup-detection"

  // The id pin of the write guard. Audio: invoice_id = ?. Software: stripe_invoice_id IS NULL OR = ?.
  pure def pinOk(cur: Row, e: Event, dom: str): bool =
    if (dom == "audio") cur.id == e.inv else (cur.id == 0 or cur.id == e.inv)

  // The write guard: the SQL WHERE clause, evaluated against the row as it is when the batch runs.
  pure def writeGuard(cur: Row, e: Event, readAt: int, dom: str): bool = {
    val g = guardTime(e.status, e.at, readAt)
    val rankTie =
      if (MUTANT == "no-rank") false
      else if (MUTANT == "rank-ge") rank(e.status) >= rank(cur.status)
      else rank(e.status) > rank(cur.status)
    val timeOk =
      if (MUTANT == "no-time-guard") true
      else if (dom == "audio") (if (MUTANT == "audio-lt") (cur.at == 0 or cur.at < g) else (cur.at == 0 or cur.at <= g))
      else (cur.at == 0 or cur.at < g or (cur.at == e.at and rankTie))
    (MUTANT == "overwrite-paid" or cur.status != "paid") and (MUTANT == "no-id-pin" or pinOk(cur, e, dom)) and timeOk
  }

  // Ghost flags for one write that applied (or did not) to the row `cur`.
  pure def ghostAfter(g: Ghost, cur: Row, e: Event, applies: bool, changes: bool, dupBefore: bool, pinned: bool, dom: str): Ghost = {
    val tieNow = e.status != "paid" and cur.status != "paid" and cur.at != 0 and cur.at == e.at
    val tieExpected = if (dom == "audio") true else rank(e.status) > rank(cur.status)
    {
      everPaid: g.everPaid or (applies and e.status == "paid"),
      badStale: g.badStale or (applies and e.status != "paid" and cur.status != "paid" and cur.at != 0 and e.at < cur.at),
      badId: g.badId or (applies and cur.id != 0 and cur.id != e.inv),
      badTie: g.badTie or (tieNow and pinned and not(dupBefore) and applies != tieExpected),
      badRedelivery: g.badRedelivery or (changes and dupBefore),
    }
  }

  // ---- Actions ----------------------------------------------------------------------------------------------------
  // Stripe has already created the events (ids 1..3). Their statuses, times and Stripe invoice ids are chosen freely, so
  // any event can be older, newer or the same second as any other, and any can name the other Stripe invoice.
  action init = {
    nondet s1 = STATUSES.oneOf()
    nondet t1 = 1.to(MAX_TIME).oneOf()
    nondet i1 = Set(REAL_ID, OTHER_ID).oneOf()
    nondet s2 = STATUSES.oneOf()
    nondet t2 = 1.to(MAX_TIME).oneOf()
    nondet i2 = Set(REAL_ID, OTHER_ID).oneOf()
    nondet s3 = STATUSES.oneOf()
    nondet t3 = 1.to(MAX_TIME).oneOf()
    nondet i3 = Set(REAL_ID, OTHER_ID).oneOf()
    all {
      events' = Map(
        1 -> { status: s1, at: t1, inv: i1 },
        2 -> { status: s2, at: t2, inv: i2 },
        3 -> { status: s3, at: t3, inv: i3 }),
      row' = { status: START, at: 0, id: 0, rec: 0 },
      attempts' = Set(), processed' = Set(), unmatched' = Set(),
      deliveries' = 1.to(MAX_DELIVERIES).mapBy(_ => {
        phase: "idle", ev: 0, outcome: "", rStatus: "", rAt: 0, rId: 0 }),
      ghost' = { everPaid: false, badStale: false, badId: false, badTie: false, badRedelivery: false },
    }
  }

  // The creation response links the real Stripe invoice id.
  //   audio, recordInvoice:       WHERE id IS NULL AND status = 'not_created'; the attempt row is inserted with it
  //   software, recordSoftwareInvoice: WHERE id IS NULL OR id = ?; creating becomes open
  action link = all {
    row.id == 0,
    row' = { ...row, id: REAL_ID, status: if (DOMAIN == "audio") "open" else (if (row.status == "creating") "open" else row.status) },
    attempts' = if (DOMAIN == "audio") attempts.union(Set(REAL_ID)) else attempts,
    processed' = processed, unmatched' = unmatched, events' = events, deliveries' = deliveries, ghost' = ghost,
  }

  // Marks an event unmatched (the "never-unmatched" mutant does not record it and calls the run processed).
  val unmatchedOutcome = if (MUTANT == "never-unmatched") "processed" else "unmatched"

  // ---- Audio -------------------------------------------------------------------------------------------------------
  // webhook.ts: the first read of the row. An id equal to the event's goes to the apply path, anything else to the
  // attempts check.
  action audioStart(d: int, e: int): bool = {
    val ev = events.get(e)
    all {
      DOMAIN == "audio",
      deliveries.get(d).phase == "idle",
      events.keys().contains(e),
      deliveries' = deliveries.set(d, {
        phase: if (row.id == ev.inv) "apply-read" else "attempt", ev: e, outcome: "",
        rStatus: row.status, rAt: row.at, rId: row.id }),
      row' = row, attempts' = attempts, processed' = processed, unmatched' = unmatched, events' = events, ghost' = ghost,
    }
  }

  // webhook.ts: isKnownInvoiceAttempt. A known attempt used to be parked as a conflict whatever the row says. Now the row
  // is read again: an id equal to the event's goes to the apply path, a different id is a conflict.
  action audioAttempt(d: int): bool = {
    val dl = deliveries.get(d)
    val ev = events.get(dl.ev)
    val known = attempts.contains(ev.inv)
    val toApply = known and row.id == ev.inv and MUTANT != "pre-fix-link"
    val parked = known and not(toApply)
    all {
      dl.phase == "attempt",
      deliveries' = deliveries.set(d, { ...dl,
        phase: if (parked) "done" else if (toApply) "apply-read" else "recover-read",
        outcome: if (parked) unmatchedOutcome else "" }),
      unmatched' = if (parked and MUTANT != "never-unmatched") unmatched.union(Set(dl.ev)) else unmatched,
      row' = row, attempts' = attempts, processed' = processed, events' = events, ghost' = ghost,
    }
  }

  // recoverInvoiceFromWebhook, its own read of the row. A stored id (or a paid row) used to park the event; now an id
  // equal to the event's goes to the apply path instead.
  action audioRecoverRead(d: int): bool = {
    val dl = deliveries.get(d)
    val ev = events.get(dl.ev)
    val toApply = row.id == ev.inv and MUTANT != "pre-fix-link"
    val parked = not(toApply) and (row.id != 0 or row.status == "paid")
    all {
      dl.phase == "recover-read",
      deliveries' = deliveries.set(d, { ...dl,
        phase: if (parked) "done" else if (toApply) "apply-read" else "recover-write",
        outcome: if (parked) unmatchedOutcome else "",
        rStatus: row.status, rAt: row.at, rId: row.id }),
      unmatched' = if (parked and MUTANT != "never-unmatched") unmatched.union(Set(dl.ev)) else unmatched,
      row' = row, attempts' = attempts, processed' = processed, events' = events, ghost' = ghost,
    }
  }

  // recoverInvoiceFromWebhook, the batch: link the row if no id is stored and it is not paid (setting its status to the
  // event's), else apply the event through the guarded update on the stored id; then record the attempt and the
  // processed event if the row has the event's id, or record the event as unmatched if it has another.
  action audioRecoverWrite(d: int): bool = {
    val dl = deliveries.get(d)
    val e = dl.ev
    val ev = events.get(e)
    val linkApplies = row.id == 0 and row.status != "paid"
    val row1 = if (linkApplies) { status: ev.status, at: storedTime(ev, dl.rAt), id: ev.inv, rec: e } else row
    val pinned = row.id == ev.inv and row.rec != e
    // The guarded update refuses an event already recorded as processed (the "recover-no-dup-guard" mutant is the code before).
    val seen = processed.contains(e) and dupDetected and MUTANT != "recover-no-dup-guard"
    val guarded = (MUTANT == "no-id-pin" or row1.id == ev.inv) and row1.rec != e and not(seen) and writeGuard(row1, ev, dl.rAt, "audio")
    val row2 = if (guarded) { ...row1, status: ev.status, at: storedTime(ev, dl.rAt) } else row1
    val applies = linkApplies or guarded
    val dupBefore = processed.contains(e)
    val matched = row2.id == ev.inv
    all {
      dl.phase == "recover-write",
      row' = row2,
      attempts' = if (matched) attempts.union(Set(ev.inv)) else attempts,
      processed' = if (matched) processed.union(Set(e)) else processed,
      unmatched' = if (matched) unmatched.exclude(Set(e)) else if (MUTANT == "never-unmatched") unmatched else unmatched.union(Set(e)),
      deliveries' = deliveries.set(d, { ...dl, phase: "done", outcome: if (matched) "processed" else unmatchedOutcome }),
      ghost' = ghostAfter(ghost, row, ev, applies, row2 != row, dupBefore, pinned or linkApplies, "audio"),
      events' = events,
    }
  }

  // applyStripeInvoiceEvent, the reads: the duplicate check, then the row by invoice id; the decision is made on this read.
  action audioApplyRead(d: int): bool = {
    val dl = deliveries.get(d)
    val dup = processed.contains(dl.ev) and dupDetected
    all {
      dl.phase == "apply-read",
      deliveries' = deliveries.set(d, { ...dl,
        phase: if (dup) "done" else "apply-write", outcome: if (dup) "duplicate" else "",
        rStatus: row.status, rAt: row.at, rId: row.id }),
      row' = row, attempts' = attempts, processed' = processed, unmatched' = unmatched, events' = events, ghost' = ghost,
    }
  }

  // ---- Software ---------------------------------------------------------------------------------------------------
  // applySoftwareInvoiceEvent, the read: match the row (a stored id must equal the event's; with no id the row must be
  // creating), then the duplicate check.
  action softwareStart(d: int, e: int): bool = {
    val ev = events.get(e)
    val matches =
      if (MUTANT == "no-read-unmatched") true
      else if (row.id == 0) row.status == "creating" else row.id == ev.inv
    val dup = processed.contains(e) and dupDetected
    val finished = not(matches) or dup
    all {
      DOMAIN == "software",
      deliveries.get(d).phase == "idle",
      events.keys().contains(e),
      deliveries' = deliveries.set(d, {
        phase: if (finished) "done" else "apply-write", ev: e,
        outcome: if (not(matches)) unmatchedOutcome else if (dup) "duplicate" else "",
        rStatus: row.status, rAt: row.at, rId: row.id }),
      unmatched' = if (not(matches) and MUTANT != "never-unmatched") unmatched.union(Set(e)) else unmatched,
      row' = row, attempts' = attempts, processed' = processed, events' = events, ghost' = ghost,
    }
  }

  // ---- The write batch of both domains ----------------------------------------------------------------------------
  // One atomic step against the row as it is now.
  //   audio:    a duplicate primary key rolls the whole batch back and the webhook answers 500: outcome "failed"
  //   software: INSERT OR IGNORE and NOT EXISTS leave the row alone and the run returns processed
  action applyWrite(d: int): bool = {
    val dl = deliveries.get(d)
    val e = dl.ev
    val ev = events.get(e)
    // Audio applies only when the decision made on the stale read says apply; software has no read decision.
    val decided =
      if (DOMAIN == "audio" and MUTANT != "no-decision")
        (if (MUTANT == "old-rule") oldDecision(dl.rStatus, dl.rAt, ev.status, ev.at, tie)
         else decision(dl.rStatus, dl.rAt, ev.status, ev.at, tie))
      else true
    val dupNow = processed.contains(e) and dupDetected
    val guardOk = writeGuard(row, ev, dl.rAt, DOMAIN)
    // Software records the event as processed only if the row still matches its Stripe id, else as unmatched.
    // Audio's processed insert is unconditional (the apply path is only entered for the row's own id).
    val stillMatches = DOMAIN == "audio" or MUTANT == "processed-on-mismatch" or pinOk(row, ev, "software")
    val applies = decided and guardOk and not(dupNow)
    val failed = dupNow and DOMAIN == "audio"
    val outcome =
      if (failed) "failed" else if (dupNow) "processed" else if (stillMatches) "processed" else unmatchedOutcome
    val recordProcessed = not(dupNow) and stillMatches
    val recordUnmatched = not(dupNow) and not(stillMatches) and MUTANT != "never-unmatched"
    all {
      dl.phase == "apply-write",
      row' = if (applies) { status: ev.status, at: storedTime(ev, dl.rAt),
                            id: if (DOMAIN == "software") ev.inv else row.id, rec: row.rec } else row,
      processed' = if (recordProcessed) processed.union(Set(e)) else processed,
      unmatched' =
        if (recordProcessed and MUTANT != "processed-on-mismatch") unmatched.exclude(Set(e))
        else if (recordUnmatched) unmatched.union(Set(e))
        else unmatched,
      deliveries' = deliveries.set(d, { ...dl, phase: "done", outcome: outcome }),
      ghost' = ghostAfter(ghost, row, ev, applies, applies and (ev.status != row.status or storedTime(ev, dl.rAt) != row.at or (DOMAIN == "software" and ev.inv != row.id)), processed.contains(e), pinOk(row, ev, DOMAIN), DOMAIN),
      attempts' = attempts, events' = events,
    }
  }

  action step = any {
    link,
    nondet d = 1.to(MAX_DELIVERIES).oneOf()
    nondet e = 1.to(MAX_EVENTS).oneOf()
    any { audioStart(d, e), softwareStart(d, e) },
    nondet d = 1.to(MAX_DELIVERIES).oneOf()
    any { audioAttempt(d), audioRecoverRead(d), audioRecoverWrite(d), audioApplyRead(d), applyWrite(d) },
  }

  // For the Apalache check only (`--step stepOrEnd`): once every handler slot is used up and finished nothing more can
  // happen, and the model stays where it is, so the checker does not report the end of a run as a deadlock. The random
  // runs use `step` and simply stop there.
  action finished = all {
    deliveries.keys().forall(d => deliveries.get(d).phase == "done"),
    row' = row, attempts' = attempts, processed' = processed, unmatched' = unmatched, events' = events,
    deliveries' = deliveries, ghost' = ghost,
  }

  action stepOrEnd = any { step, finished }

  // ---- Properties -------------------------------------------------------------------------------------------------
  val allDone = deliveries.keys().forall(d => deliveries.get(d).phase == "idle" or deliveries.get(d).phase == "done")

  // 1. Paid is absorbing: once the stored status is paid it never changes (stays paid).
  val paidAbsorbing = ghost.everPaid implies row.status == "paid"

  // 2. Money is not lost: when every started delivery has finished, a delivered paid event for the linked Stripe
  //    invoice always ends paid, and its delivery does not end unmatched.
  val moneyNotLost = allDone implies deliveries.keys().forall(d => {
    val dl = deliveries.get(d)
    (dl.phase == "done" and events.get(dl.ev).status == "paid" and events.get(dl.ev).inv == row.id)
      implies (row.status == "paid" and dl.outcome != "unmatched")
  })

  // 3. A stale non-paid event never replaces a newer non-paid status.
  val noStaleOverwrite = not(ghost.badStale)

  // 4. The stored Stripe invoice id is never overwritten with a different id, and an event for a different id never
  //    changes the status.
  val idNeverOverwritten = not(ghost.badId)

  // 5. Every finished delivery ends in exactly one of processed, unmatched, duplicate or (audio) failed-and-retried; an
  //    event is never both processed and unmatched; the outcome agrees with what was recorded.
  val oneOutcome = and {
    processed.intersect(unmatched) == Set(),
    deliveries.keys().forall(d => {
      val dl = deliveries.get(d)
      dl.phase != "done" or (
        if (dl.outcome == "unmatched") unmatched.contains(dl.ev)
        else Set("processed", "duplicate", "failed").contains(dl.outcome) and processed.contains(dl.ev))
    }),
  }

  // 6. The stored time is a real event time, never the far-future guard value.
  val realStoredTime = row.at == 0 or events.keys().exists(e => events.get(e).at == row.at)

  // 7. A same-second tie between two non-paid events resolves by the domain's rule (audio: the later arrival applies;
  //    software: the higher rank applies).
  val tieRule = not(ghost.badTie)

  // 8. A redelivered event never changes the row after it was processed.
  val redeliveryInert = not(ghost.badRedelivery)

  // 9. An event for a different Stripe invoice than the stored one ends unmatched and never processed.
  val differentIdUnmatched = row.id == 0 or events.keys().forall(e => {
    val finished = deliveries.keys().exists(d => deliveries.get(d).phase == "done" and deliveries.get(d).ev == e)
    (finished and events.get(e).inv != row.id) implies (unmatched.contains(e) and not(processed.contains(e)))
  })

  val allProperties = and {
    paidAbsorbing, moneyNotLost, noStaleOverwrite, idNeverOverwritten, oneOutcome, realStoredTime,
    tieRule, redeliveryInert, differentIdUnmatched,
  }
}

module audio { import invoiceEvents(DOMAIN = "audio", MUTANT = "none", DELIVERIES = 4).* }
module software { import invoiceEvents(DOMAIN = "software", MUTANT = "none", DELIVERIES = 4).* }

// Mutants. Each must produce a counterexample to the property named in scripts/verify-quint.mjs.
module audioOldRule { import invoiceEvents(DOMAIN = "audio", MUTANT = "old-rule", DELIVERIES = 4).* }
module softwareOldRule { import invoiceEvents(DOMAIN = "software", MUTANT = "old-rule", DELIVERIES = 4).* }
module audioStaleGuard { import invoiceEvents(DOMAIN = "audio", MUTANT = "stale-guard", DELIVERIES = 4).* }
module softwareStaleGuard { import invoiceEvents(DOMAIN = "software", MUTANT = "stale-guard", DELIVERIES = 4).* }
module softwareNoIdPin { import invoiceEvents(DOMAIN = "software", MUTANT = "no-id-pin", DELIVERIES = 4).* }
module audioPreFixLink { import invoiceEvents(DOMAIN = "audio", MUTANT = "pre-fix-link", DELIVERIES = 4).* }
module audioRecoverNoDupGuard { import invoiceEvents(DOMAIN = "audio", MUTANT = "recover-no-dup-guard", DELIVERIES = 4).* }
module audioNoTimeGuard { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-time-guard", DELIVERIES = 4).* }
module softwareNoTimeGuard { import invoiceEvents(DOMAIN = "software", MUTANT = "no-time-guard", DELIVERIES = 4).* }
module audioOverwritePaid { import invoiceEvents(DOMAIN = "audio", MUTANT = "overwrite-paid", DELIVERIES = 4).* }
module softwareOverwritePaid { import invoiceEvents(DOMAIN = "software", MUTANT = "overwrite-paid", DELIVERIES = 4).* }
module audioNoDupDetection { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-dup-detection", DELIVERIES = 4).* }
module softwareNoDupDetection { import invoiceEvents(DOMAIN = "software", MUTANT = "no-dup-detection", DELIVERIES = 4).* }
module softwareNoRank { import invoiceEvents(DOMAIN = "software", MUTANT = "no-rank", DELIVERIES = 4).* }
module softwareRankGe { import invoiceEvents(DOMAIN = "software", MUTANT = "rank-ge", DELIVERIES = 4).* }
module audioAudioLt { import invoiceEvents(DOMAIN = "audio", MUTANT = "audio-lt", DELIVERIES = 4).* }
module audioNeverUnmatched { import invoiceEvents(DOMAIN = "audio", MUTANT = "never-unmatched", DELIVERIES = 4).* }
module softwareNeverUnmatched { import invoiceEvents(DOMAIN = "software", MUTANT = "never-unmatched", DELIVERIES = 4).* }
module softwareProcessedOnMismatch { import invoiceEvents(DOMAIN = "software", MUTANT = "processed-on-mismatch", DELIVERIES = 4).* }
module audioStoreGuardTime { import invoiceEvents(DOMAIN = "audio", MUTANT = "store-guard-time", DELIVERIES = 4).* }
module softwareStoreGuardTime { import invoiceEvents(DOMAIN = "software", MUTANT = "store-guard-time", DELIVERIES = 4).* }

// Equivalent mutants: allProperties must still hold (the reason is in docs/verification.md).
module audioNoDecision { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-decision", DELIVERIES = 4).* }
module audioNoIdPin { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-id-pin", DELIVERIES = 4).* }
module softwareNoReadUnmatched { import invoiceEvents(DOMAIN = "software", MUTANT = "no-read-unmatched", DELIVERIES = 4).* }

// For `pnpm run verify:quint:exhaustive` (Apalache, by hand): fewer handler runs so every order up to the bound can be searched.
module audioExhaustive { import invoiceEvents(DOMAIN = "audio", MUTANT = "none", DELIVERIES = 3).* }
module softwareExhaustive { import invoiceEvents(DOMAIN = "software", MUTANT = "none", DELIVERIES = 3).* }
