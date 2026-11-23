// Quint model of one email notice of an audio project: the studio invitation (audio_projects.invitation_status) and an update
// notice (audio_project_updates.notification_status) go through the same four states and the same three statements, but the
// statements do not have the same conditions, so the model takes the kind of notice as a parameter. Written for the design
// of the audio projects conversion (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (src/lib/audio-project-invitations.ts and the notice functions of src/lib/audio-project-updates.ts; after the
// conversion a read, a rule and a compare-and-set write for each of the three):
//   queue:   the owner's retry reads the status and whether the project is open and the request not withdrawn, and moves a
//            failed or pending notice (or one stuck in `sending` that the owner confirms was not sent) back to pending; both
//            kinds need an open project
//   claim:   a delivery moves pending to sending. The invitation's claim also needs the project open (and the request a
//            service, not withdrawn, with an email); the update notice's claim needs only the status, so a closed project's
//            update notice is claimed, finds no recipient and ends `failed` (today's outcome, kept)
//   send:    the recipient is read (a closed project has none), the email is sent (it can be refused, uncertain, or sent), and
//            the outcome is written while the status is still `sending`; the invitation's write also needs the project open
//            (an email sent just after a revoke leaves it at `sending`), the update notice's does not; an uncertain outcome
//            writes nothing
// Extended for the signing conversion (docs/plans/2026-11-signing-conversion.md, section 7) with two kinds of the agreements
// area, whose rows have the same four states (software_agreement_deliveries.status, software_agreement_notifications.status).
// `open` stands for the condition each kind's claim compares. Code modelled (src/lib/agreement-artifacts.ts, at `585619c1`):
//   copy:    a signed copy (deliverAgreementCopies, 357-447). Its row is inserted by the countersign batch that executes the
//            agreement (src/lib/software-agreements.ts:717-729), and no statement moves an executed agreement to another
//            status, so of the claim's conditions only the archive can change: retention closes it
//            (src/lib/agreement-retention.ts:336-339), and its `eligible` (37-46) refuses while a copy of the agreement is
//            `sending`. The claim (A18, 394-399) needs the copy pending, the agreement executed and its archive open, and
//            returns the address, so no recipient read follows; the outcome is written by attempt while `sending`, with no other
//            condition (417-445)
//   signing: a signing notice, the client's receipt or the owner's countersign notice (deliverAgreementNotifications, 470-523),
//            inserted by the sign batch (software-agreements.ts:529-541). The claim (A19, 485-489) needs it pending and current
//            (`currentSigningNotification`, 467-468: the agreement client_signed, its archive open, no project of the request)
//            and returns the address; the outcome by attempt while `sending` (510-521). The agreement leaves client_signed by
//            a countersign or an abandon, and the same batch fails a notice that is `sending` (A21, OBSOLETE,
//            closeObsoleteAgreementNotifications, software-agreements.ts:615-642, run at 703 and in
//            src/pages/api/owner/requests/[id]/agreement.ts:163-169): a notice whose email is in flight then ends `failed`
//            whether or not the email went out, by design (the comment at 615). While the agreement is client_signed its
//            archive is open (retention closes only an executed or abandoned one) and the request has no project (a website
//            start needs the agreement executed and an outside one refuses a client_signed agreement of the offer,
//            src/pages/api/owner/requests/[id]/project.ts:124-153, 233-237), so `open` is "client_signed" for this kind
//   reset:   both are reset by the owner's retry-copy (agreement.ts:211-231), A20: from `failed`, or from `sending` when the
//            owner confirms and the attempt is at least a minute old; never from `pending` (the audio queue also moves a pending
//            notice), the attempt is kept, and a signing notice must also be current. Today one statement; after the
//            conversion a read, a rule and a compare-and-set, the shape of the audio retry, which is what the model checks
// The 60 second cutoff of the retry's write (`attempted_at<=now-60s`, with the owner's confirmation) is stood in for by the attempt
// the retry read: any later attempt is newer than the cutoff, so the write refuses it.
// The properties read the stored state and the world (the emails that really went out) and never a flag set from a guard. The
// clock stamps the attempt and the close, as `invitation_attempted_at` and `revoked_at` do (for the agreements' kinds,
// `attempted_at` and the moment the archive closed or the agreement left client_signed).
// What is left out, on purpose: the 60 second staleness test itself (the model lets the owner confirm only a notice that is
// stuck, and only truthfully: the email did not go out), the mail text, the recipient's address, and the retry's open
// condition, which has no stored effect beyond its own answer (409): the delivery that follows a retry on a closed project
// sends nothing (the invitation's claim refuses, the update's recipient read is empty), which the properties below cover. For
// the agreements' kinds also the attempt condition of the outcome write (`attempt_id=?`): with the owner's confirmation
// truthful, no delivery is still working when a `sending` row is reset, and a `failed` row with a delivery still working is
// one that OBSOLETE failed, which is never reset, so that condition never refuses here; and Resend's idempotency key
// (artifacts.ts:405, 495), a second protection outside the model.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module audioProjectNotices {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "claim-no-status"   the claim does not compare the status, so two deliveries that read `pending` both claim it
  //   "claim-no-open"     the invitation's claim does not compare that the project is still open
  //   "claim-no-state"    the claim of a copy or a signing notice does not compare its agreement's state (A18's executed and
  //                       open archive, A19's `currentSigningNotification`)
  //   "queue-any-status"  the rule and the write admit a notice that was sent
  //   "queue-no-cas"      the retry's write compares neither the status nor the attempt it read, so a delivery that claimed the notice
  //                       between the retry's read and its write is overwritten and a second email can go out
  //   "queue-status-only" the retry's write does not compare the attempt: with two retries at once, both read the notice stuck in
  //                       `sending`, one requeues it, a later delivery claims it again (still in flight, or left `sending` by an
  //                       uncertain answer), and the other retry's write requeues over that claim, so a second email can go out
  //   "uncertain-sent"    an uncertain outcome is written as sent
  //   "uncertain-failed"  an uncertain outcome is written as failed
  //   "lookup-no-open"    the recipient read does not filter on the project's access, so a closed project has a recipient (the
  //                       update notice's claim has no access condition, so this read is what keeps it from mailing)
  const MUTANT: str
  // "invitation", "update", "copy" or "signing": whose conditions the claim, the outcome write, the retry and the close have
  // (see the header).
  const KIND: str

  type Snap = { status: str, open: bool, attempt: int }
  // One delivery: phase "none", "read" (about to read), "claim" (about to claim), "lookup" (claimed, about to read the
  // recipient), "send" (about to send), "finish" (the outcome is known), "done" or "refused"; and what the send answered.
  type Run = { phase: str, snap: Snap, outcome: str }

  var status: str          // "pending", "sending", "sent" or "failed"
  // The condition the claim compares: for the invitation and an update notice, the project's access is open and the request is
  // not withdrawn; for a copy, the agreement is executed and its archive open; for a signing notice, the agreement is
  // client_signed (with its archive open and no project, which hold while it is).
  var open: bool
  var epoch: int           // how many times the owner queued the notice again
  var mailed: int -> int   // the world: the emails that really went out for each epoch (delivered, even if the answer was uncertain)
  var clock: int           // a logical clock that stamps the attempt and the close
  var attempt: int         // the stored attempt time (0 for none, as `invitation_attempted_at` NULL); an audio queue clears it
  var closedAt: int        // the stored close time (0 while open, as `revoked_at` NULL)
  var runs: int -> Run

  val RUNS = 1.to(3)
  // Keys 4 and 5 of `runs` are two owner retries (two tabs): phase "none", "write" (read, about to write) or "done"; its snap is what it read.
  val RETRIES = Set(4, 5)
  val KEYS = 1.to(5)
  val EPOCHS = 0.to(2)
  val noSnap = { status: "pending", open: true, attempt: 0 }
  // The two kinds of the agreements area: their reset is A20, and their address comes back with the claim.
  val agreementKind = KIND == "copy" or KIND == "signing"

  val inFlight = RUNS.exists(r => {
    val p = runs.get(r).phase
    p == "claim" or p == "lookup" or p == "send" or p == "finish"
  })

  def alive(p: str): bool = p == "claim" or p == "lookup" or p == "send" or p == "finish"

  // The claim's rule, from what the read saw: every kind but the update notice also needs `open`.
  def mayClaim(s: Snap): bool = s.status == "pending" and (KIND == "update" or s.open)

  // The starting points: a new notice, and one stuck in `sending` after a delivery whose answer was uncertain (the email did not go
  // out). A mutant whose race needs the stuck notice begins from it alone, which narrows where the search begins and not what the
  // properties say; the run that must pass takes both.
  val starts = if (MUTANT == "queue-status-only") Set("stuck") else Set("new", "stuck")

  action init = {
    nondet start = starts.oneOf()
    all {
      status' = if (start == "stuck") "sending" else "pending",
      open' = true,
      epoch' = 0,
      mailed' = EPOCHS.mapBy(e => 0),
      clock' = if (start == "stuck") 1 else 0, attempt' = if (start == "stuck") 1 else 0, closedAt' = 0,
      runs' = KEYS.mapBy(r => { phase: "none", snap: noSnap, outcome: "none" }),
    }
  }

  // A delivery begins: it reads the status and whether the project is open, and the rule decides.
  action begin = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    val snap = { status: status, open: open, attempt: attempt }
    all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { phase: if (mayClaim(snap)) "claim" else "refused", snap: snap, outcome: "none" }),
    }
  }

  // The claim: pending becomes sending while the status (and, for every kind but the update notice, `open`) is what the read saw.
  action claim = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "claim").oneOf()
    val h = runs.get(r)
    val stateOk =
      KIND == "update" or open or (KIND == "invitation" and MUTANT == "claim-no-open") or
      (agreementKind and MUTANT == "claim-no-state")
    val ok = (MUTANT == "claim-no-status" or status == "pending") and stateOk
    if (ok) all {
      status' = "sending", open' = open, epoch' = epoch, mailed' = mailed,
      clock' = clock + 1, attempt' = clock + 1, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "lookup" }),
    }
    else all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "refused" }),
    }
  }

  // The recipient is read; a closed project has none, and the notice is marked failed without an email. A copy and a signing
  // notice have their address from the claim (`RETURNING email`), so they go on to send.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "lookup").oneOf()
    val h = runs.get(r)
    all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r,
        if (agreementKind or open or MUTANT == "lookup-no-open") { ...h, phase: "send" } else { ...h, phase: "finish", outcome: "refused" }),
    }
  }

  // The email: refused, delivered, or an answer nobody can trust (it may or may not have been delivered).
  action send = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "send").oneOf()
    nondet outcome = Set("sent", "refused", "uncertainDelivered", "uncertainLost").oneOf()
    val h = runs.get(r)
    val goes = outcome == "sent" or outcome == "uncertainDelivered"
    all {
      status' = status, open' = open, epoch' = epoch,
      mailed' = if (goes) mailed.set(epoch, mailed.get(epoch) + 1) else mailed,
      clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "finish", outcome: if (outcome == "sent" or outcome == "refused") outcome else "uncertain" }),
    }
  }

  // The outcome is written only while the status is still `sending` (and, for the invitation, the project still open); an
  // uncertain outcome writes nothing.
  action finish = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "finish").oneOf()
    val h = runs.get(r)
    val writes = and {
      status == "sending",
      KIND != "invitation" or open,
      h.outcome != "uncertain" or MUTANT == "uncertain-sent" or MUTANT == "uncertain-failed",
    }
    val written =
      if (h.outcome == "sent" or (h.outcome == "uncertain" and MUTANT == "uncertain-sent")) "sent" else "failed"
    all {
      status' = if (writes) written else status,
      open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // The owner's retry is two steps, as the code is: a read and the rule, then a write. A failed notice, or one stuck in `sending`
  // that the owner confirms was not sent (truthfully: no email went out and no delivery is still working), goes back to pending;
  // the audio queue also takes a pending one, A20 does not. The write is today's condition: the notice is `failed` (or, for the
  // audio kinds, `pending`) whatever the read saw, or it is `sending`, the retry read it as `sending` (the owner confirmed it)
  // and its stored attempt is not newer than the cutoff (here the attempt the read saw stands in for the cutoff `now - 60 s`);
  // and, for every kind but the copy, `open`. Two retries can be in flight (two tabs), each in its own key of `runs`.
  action queueRead = {
    nondet r = RETRIES.filter(i => runs.get(i).phase == "none").oneOf()
    val confirmedNotSent = status == "sending" and mailed.get(epoch) == 0 and not(RUNS.exists(i => alive(runs.get(i).phase)))
    val movable =
      status == "failed" or (not(agreementKind) and status == "pending") or confirmedNotSent or
      (MUTANT == "queue-any-status" and status == "sent")
    all {
      movable,
      epoch < 2,
      KIND == "copy" or open,
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { phase: "write", snap: { status: status, open: open, attempt: attempt }, outcome: "none" }),
    }
  }

  action queueWrite = {
    nondet r = RETRIES.filter(i => runs.get(i).phase == "write").oneOf()
    val h = runs.get(r)
    // Today's condition: `status IN ('pending','failed')` (A20: `status='failed'`), or `sending` when the owner confirmed it (the
    // retry read it as `sending`) and its attempt is not newer than the cutoff (`attempted_at<=?`; the attempt the read saw stands
    // in for the cutoff). The mutants drop the attempt, admit a notice that was sent, or drop every condition.
    val holds =
      MUTANT == "queue-no-cas" or status == "failed" or (not(agreementKind) and status == "pending") or
      (MUTANT == "queue-any-status" and status == "sent") or
      (h.snap.status == "sending" and status == "sending" and (MUTANT == "queue-status-only" or attempt <= h.snap.attempt))
    if (holds and (KIND == "copy" or open)) all {
      status' = "pending", open' = open, epoch' = epoch + 1, mailed' = mailed,
      clock' = clock, attempt' = if (agreementKind) attempt else 0, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "done" }),
    } else all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // While a delivery is between its steps: the owner closes the project's access, or the request is withdrawn (the audio kinds);
  // retention closes the agreement's archive, never while the copy is `sending` (a copy); the owner countersigns or abandons
  // the agreement, and the same batch fails the notice if it is `sending` (a signing notice, A21).
  action closes = all {
    open,
    inFlight,
    KIND != "copy" or status != "sending",
    status' = if (KIND == "signing" and status == "sending") "failed" else status,
    open' = false, epoch' = epoch, mailed' = mailed,
    clock' = clock + 1, attempt' = attempt, closedAt' = clock + 1,
    runs' = runs,
  }

  action step = any { begin, claim, lookup, send, finish, queueRead, queueWrite, closes }

  // ---- Properties (each reads the stored state and the world) ------------------------------------------------------
  // 1. However the owner queues the notice, at most one email goes out in all: two deliveries never both claim it, and a notice
  // that was sent is never queued again.
  val oneEmailInTotal = EPOCHS.fold(0, (total, e) => total + mailed.get(e)) <= 1

  // 2. The invitation is never claimed once the project is closed: no stored attempt is later than the close. (The update
  // notice's claim has no access condition, so the property is about the invitation.)
  val claimOnlyWhileOpen = KIND != "invitation" or closedAt == 0 or attempt == 0 or attempt < closedAt

  // 2b. The update notice is claimed after the close (its claim has no access condition), and no email goes out for it: its
  // recipient read finds no recipient of a closed project, so the notice ends `failed` and never mails. (The property is about
  // the update notice; for the invitation, property 2 is the claim's.)
  val closedUpdateNeverMails = KIND != "update" or closedAt == 0 or attempt == 0 or attempt < closedAt or mailed.get(epoch) == 0

  // 3. A notice is marked sent only if an email went out.
  val sentMeansMailed = status != "sent" or mailed.get(epoch) >= 1

  // 4. A notice is marked failed only if no email went out: an uncertain answer leaves it `sending` for the owner to judge. A
  // signing notice is the exception the code makes on purpose: a countersign or an abandon fails it while its email is in flight
  // (A21), whether or not the email went out, so for it the property says that an email went out only once the agreement left
  // client_signed.
  val failedMeansNotMailed = status != "failed" or mailed.get(epoch) == 0 or (KIND == "signing" and not(open))

  // 5. A copy is claimed only while its agreement is executed and its archive open: no stored attempt is later than the
  // archive's close.
  val copyOnlyWhenExecuted = KIND != "copy" or closedAt == 0 or attempt == 0 or attempt < closedAt

  // 6. A signing notice is claimed only while its agreement is client_signed, before a countersign or an abandon: no stored
  // attempt is later than the moment it left client_signed.
  val noticeOnlyBeforeCountersign = KIND != "signing" or closedAt == 0 or attempt == 0 or attempt < closedAt

  val allProperties = and {
    oneEmailInTotal, claimOnlyWhileOpen, closedUpdateNeverMails, sentMeansMailed, failedMeansNotMailed, copyOnlyWhenExecuted,
    noticeOnlyBeforeCountersign,
  }

  // Reachability witness, for a hand with the negated invariant: a retry after a failure goes out (two epochs with an email
  // is not reachable, so this holds; the witness is that one email goes out after a queue).
  val mailedAfterQueue = epoch > 0 and mailed.get(epoch) > 0
  val neverMailedAfterQueue = not(mailedAfterQueue)

  // Reachability witness for a signing notice, for a hand run with the negated invariant: the notice was failed by a countersign
  // or an abandon while its email was in flight and the email went out (A21's case, which property 4 allows).
  val obsoleteAfterMail = KIND == "signing" and status == "failed" and mailed.get(epoch) > 0
  val neverObsoleteAfterMail = not(obsoleteAfterMail)
}

module projectNotices { import audioProjectNotices(MUTANT = "none", KIND = "invitation").* }
module projectNoticesUpdate { import audioProjectNotices(MUTANT = "none", KIND = "update").* }
module projectNoticesCopy { import audioProjectNotices(MUTANT = "none", KIND = "copy").* }
module projectNoticesSigning { import audioProjectNotices(MUTANT = "none", KIND = "signing").* }

// Mutants of the invitation. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module projectNoticesClaimNoStatus { import audioProjectNotices(MUTANT = "claim-no-status", KIND = "invitation").* }
module projectNoticesClaimNoOpen { import audioProjectNotices(MUTANT = "claim-no-open", KIND = "invitation").* }
module projectNoticesQueueAnyStatus { import audioProjectNotices(MUTANT = "queue-any-status", KIND = "invitation").* }
module projectNoticesUncertainSent { import audioProjectNotices(MUTANT = "uncertain-sent", KIND = "invitation").* }
module projectNoticesUncertainFailed { import audioProjectNotices(MUTANT = "uncertain-failed", KIND = "invitation").* }
module projectNoticesUpdateLookupNoOpen { import audioProjectNotices(MUTANT = "lookup-no-open", KIND = "update").* }
module projectNoticesQueueNoCas { import audioProjectNotices(MUTANT = "queue-no-cas", KIND = "invitation").* }
module projectNoticesQueueStatusOnly { import audioProjectNotices(MUTANT = "queue-status-only", KIND = "invitation").* }

// Mutants of the agreements' kinds.
module projectNoticesCopyClaimNoState { import audioProjectNotices(MUTANT = "claim-no-state", KIND = "copy").* }
module projectNoticesNoticeClaimNoState { import audioProjectNotices(MUTANT = "claim-no-state", KIND = "signing").* }
