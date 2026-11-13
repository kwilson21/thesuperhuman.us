// Quint model of one invoice receiving Stripe events in any order, with interleaved handlers.
// Code modelled: src/lib/invoice-event-order.ts, applyStripeInvoiceEvent and recoverInvoiceFromWebhook
// (src/lib/audio-payments.ts), applySoftwareInvoiceEvent and recordSoftwareInvoice (src/lib/software-invoices.ts).
// See docs/verification.md for what is and is not covered.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module invoiceEvents {
  // "audio": a delivery reads the row, decides from that read (invoiceEventDecision), and writes a guarded batch.
  //   Ties between non-paid events at the same second: the later arrival wins.
  // "software": a delivery reads the row only to match it and write a guarded batch; the SQL guard alone decides.
  //   Ties: the higher-ranked status wins.
  const DOMAIN: str
  // "none" is the code as it is now. The others reproduce the three real bugs (see the mutant modules below):
  //   "old-rule":    an event older than the stored time is ignored, even a paid one.
  //   "stale-guard": the guard time is chosen from the stale read (far future only if the read time was newer).
  //   "no-id-pin":   the write guard does not pin the Stripe invoice id.
  // Two more keep the other properties honest:
  //   "no-time-guard": the write guard has no time comparison, so a stale event can replace a newer status.
  //   "overwrite-paid": the write guard does not refuse a row that is already paid.
  const MUTANT: str

  // ---- Bounds for the checker -------------------------------------------------------------------------------------
  val MAX_EVENTS = 3      // events Stripe sends for this invoice (fixed by init)
  val MAX_TIME = 3        // event times are 1..3, so ties and both orders occur
  val MAX_DELIVERIES = 4  // handler runs; more than MAX_EVENTS so redeliveries occur
  val FAR_FUTURE = 100    // the guard value LATEST_TIME in code; it is bound in a query and never stored
  val REAL_ID = 1         // the Stripe invoice the creation response links
  val OTHER_ID = 2        // a different Stripe invoice id (a retried creation) for the same row
  val STATUSES = Set("open", "payment_failed", "void", "uncollectible", "paid")

  type Event = { status: str, at: int, inv: int }
  // phase: "idle" (not started), "read" (read done, write pending), "done".
  // outcome: "" until done, then "processed", "unmatched" or "duplicate".
  type Delivery = {
    phase: str, ev: int, outcome: str,
    rStatus: str, rAt: int, rId: int,
  }

  // ---- State ------------------------------------------------------------------------------------------------------
  var status: str            // stored status
  var storedAt: int          // time of the event that set it; 0 means none yet (SQL NULL)
  var storedId: int          // stored Stripe invoice id; 0 means none
  var processed: Set[int]    // event ids recorded in stripe_webhook_events
  var unmatched: Set[int]    // event ids recorded in the unmatched table
  var events: int -> Event   // what Stripe has sent so far (ids 1..)
  var deliveries: int -> Delivery
  // Ghost flags, set by a write step from the row as it really is at write time, never from the stale read.
  var everPaid: bool         // the row has been paid at some point
  var badStaleWrite: bool    // a non-paid event older than the stored time replaced a non-paid status
  var badIdWrite: bool       // a write changed a stored Stripe id, or changed the status for a different id

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

  val tie = if (DOMAIN == "audio") "latest" else "rank"

  // The write guard: the SQL WHERE clause, evaluated against the row as it is when the batch runs.
  pure def writeGuard(
    curStatus: str, curAt: int, curId: int, e: Event, readAt: int, dom: str
  ): bool = {
    val pinOk = if (MUTANT == "no-id-pin") true else (curId == 0 or curId == e.inv)
    val g = guardTime(e.status, e.at, readAt)
    val timeOk =
      if (MUTANT == "no-time-guard") true
      else if (dom == "audio") (curAt == 0 or curAt <= g)
      else (curAt == 0 or curAt < g or (curAt == e.at and rank(e.status) > rank(curStatus)))
    (MUTANT == "overwrite-paid" or curStatus != "paid") and pinOk and timeOk
  }

  // Is the event applicable to the row as read? The match check of both handlers.
  pure def matches(rId: int, e: Event): bool = rId == 0 or rId == e.inv

  // ---- Actions ----------------------------------------------------------------------------------------------------
  // Stripe has already created the events (ids 1..3). Their statuses, times and Stripe invoice ids are chosen freely, so
  // any event can be older, newer or the same second as any other, and any can name the other Stripe invoice. Creating
  // events earlier than they are delivered loses nothing: delivery order is chosen separately.
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
      status' = "open", storedAt' = 0, storedId' = 0,
      processed' = Set(), unmatched' = Set(),
      deliveries' = 1.to(MAX_DELIVERIES).mapBy(_ => {
        phase: "idle", ev: 0, outcome: "", rStatus: "", rAt: 0, rId: 0 }),
      everPaid' = false, badStaleWrite' = false, badIdWrite' = false,
    }
  }

  // The creation response links the real Stripe invoice id (recordSoftwareInvoice: WHERE id IS NULL OR id = ?).
  action link = all {
    storedId == 0,
    storedId' = REAL_ID,
    status' = status, storedAt' = storedAt,
    processed' = processed, unmatched' = unmatched, events' = events, deliveries' = deliveries,
    everPaid' = everPaid, badStaleWrite' = badStaleWrite, badIdWrite' = badIdWrite,
  }

  // A handler run starts for an event (first delivery or a redelivery) and READS the row.
  action read(d: int, e: int): bool = {
    val ev = events.get(e)
    // The handler either finishes at once (no match, duplicate) or leaves a write pending. Software checks the match
    // first, audio the duplicate first; the outcome is the same because a recorded event always matched the stored id,
    // and a stored id never changes.
    val outcome =
      if (not(matches(storedId, ev))) "unmatched" else if (processed.contains(e)) "duplicate" else ""
    all {
      deliveries.get(d).phase == "idle",
      events.keys().contains(e),
      deliveries' = deliveries.set(d, {
        phase: if (outcome == "") "read" else "done", ev: e, outcome: outcome,
        rStatus: status, rAt: storedAt, rId: storedId }),
      unmatched' = if (outcome == "unmatched") unmatched.union(Set(e)) else unmatched,
      status' = status, storedAt' = storedAt, storedId' = storedId,
      processed' = processed, events' = events,
      everPaid' = everPaid, badStaleWrite' = badStaleWrite, badIdWrite' = badIdWrite,
    }
  }

  // The WRITE batch of a started handler, as one atomic step against the row as it is now.
  action write(d: int): bool = {
    val dl = deliveries.get(d)
    val e = dl.ev
    val ev = events.get(e)
    // Audio applies only when the decision made on the stale read says apply; software has no read decision.
    val decided =
      if (DOMAIN == "audio")
        (if (MUTANT == "old-rule") oldDecision(dl.rStatus, dl.rAt, ev.status, ev.at, tie)
         else decision(dl.rStatus, dl.rAt, ev.status, ev.at, tie))
      else true
    val dupNow = processed.contains(e)
    val guardOk = writeGuard(status, storedAt, storedId, ev, dl.rAt, DOMAIN)
    // The batch records the event as processed only if the row still matches the event's Stripe id; otherwise it
    // records it as unmatched. A duplicate that slipped past the read changes nothing (primary key / NOT EXISTS).
    val stillMatches = (MUTANT == "no-id-pin") or matches(storedId, ev)
    val applies = decided and guardOk and not(dupNow)
    val outcome = if (dupNow) "duplicate" else if (stillMatches) "processed" else "unmatched"
    val staleWrite = applies and ev.status != "paid" and status != "paid" and storedAt != 0 and ev.at < storedAt
    val idWrite = applies and storedId != 0 and storedId != ev.inv
    all {
      dl.phase == "read",
      status' = if (applies) ev.status else status,
      storedAt' = if (applies) ev.at else storedAt,
      storedId' = if (applies) ev.inv else storedId,
      processed' = if (outcome == "processed") processed.union(Set(e)) else processed,
      unmatched' =
        if (outcome == "processed") unmatched.exclude(Set(e))
        else if (outcome == "unmatched") unmatched.union(Set(e))
        else unmatched,
      deliveries' = deliveries.set(d, { ...dl, phase: "done", outcome: outcome }),
      everPaid' = (everPaid or (applies and ev.status == "paid")),
      badStaleWrite' = (badStaleWrite or staleWrite),
      badIdWrite' = (badIdWrite or idWrite),
      events' = events,
    }
  }

  action step = any {
    link,
    nondet d = 1.to(MAX_DELIVERIES).oneOf()
    nondet e = 1.to(MAX_EVENTS).oneOf()
    read(d, e),
    nondet d = 1.to(MAX_DELIVERIES).oneOf()
    write(d),
  }

  // ---- Properties -------------------------------------------------------------------------------------------------
  val allDone = deliveries.keys().forall(d => deliveries.get(d).phase != "read")

  // 1. Paid is absorbing: once stored status is paid it never changes (stays paid).
  val paidAbsorbing = everPaid implies status == "paid"

  // 2. Money is not lost: when every started delivery has finished, a processed paid event for the linked invoice
  //    means the stored status is paid.
  val moneyNotLost = allDone implies (
    deliveries.keys().exists(d => {
      val dl = deliveries.get(d)
      dl.phase == "done" and dl.outcome == "processed" and
        events.get(dl.ev).status == "paid" and events.get(dl.ev).inv == storedId
    }) implies status == "paid")

  // 3. A stale non-paid event never replaces a newer non-paid status.
  val noStaleOverwrite = not(badStaleWrite)

  // 4. The stored Stripe invoice id is never overwritten with a different id, and an event for a different id never
  //    changes the status.
  val idNeverOverwritten = not(badIdWrite)

  // 5. Every finished delivery ends in exactly one of processed, unmatched or duplicate; an event is never both
  //    processed and unmatched.
  val oneOutcome =
    and {
      processed.intersect(unmatched) == Set(),
      deliveries.keys().forall(d => {
        val dl = deliveries.get(d)
        dl.phase != "done" or Set("processed", "unmatched", "duplicate").contains(dl.outcome)
      }),
      deliveries.keys().forall(d => {
        val dl = deliveries.get(d)
        dl.phase != "done" or (dl.outcome == "unmatched") == unmatched.contains(dl.ev) or dl.outcome == "duplicate"
      }),
    }

  // 6. The stored time is a real event time, never the far-future guard value.
  val realStoredTime =
    storedAt == 0 or events.keys().exists(e => events.get(e).at == storedAt)

  val allProperties = and {
    paidAbsorbing, moneyNotLost, noStaleOverwrite, idNeverOverwritten, oneOutcome, realStoredTime,
  }
}

module audio { import invoiceEvents(DOMAIN = "audio", MUTANT = "none").* }
module software { import invoiceEvents(DOMAIN = "software", MUTANT = "none").* }

// Mutants: the three real bugs, kept so CI can prove the properties catch them. Each must produce a counterexample.
module audioOldRule { import invoiceEvents(DOMAIN = "audio", MUTANT = "old-rule").* }
module softwareOldRule { import invoiceEvents(DOMAIN = "software", MUTANT = "old-rule").* }
module audioStaleGuard { import invoiceEvents(DOMAIN = "audio", MUTANT = "stale-guard").* }
module softwareStaleGuard { import invoiceEvents(DOMAIN = "software", MUTANT = "stale-guard").* }
module audioNoIdPin { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-id-pin").* }
module softwareNoIdPin { import invoiceEvents(DOMAIN = "software", MUTANT = "no-id-pin").* }
module audioNoTimeGuard { import invoiceEvents(DOMAIN = "audio", MUTANT = "no-time-guard").* }
module softwareNoTimeGuard { import invoiceEvents(DOMAIN = "software", MUTANT = "no-time-guard").* }
module audioOverwritePaid { import invoiceEvents(DOMAIN = "audio", MUTANT = "overwrite-paid").* }
module softwareOverwritePaid { import invoiceEvents(DOMAIN = "software", MUTANT = "overwrite-paid").* }
