// Quint model of one email notice of an audio project: the studio invitation (audio_projects.invitation_status) and an update
// notice (audio_project_updates.notification_status) go through the same four states and the same three statements, so one
// model covers both. Written for the design of the audio projects conversion
// (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (src/lib/audio-project-invitations.ts and the notice functions of src/lib/audio-project-updates.ts; after the
// conversion a read, a rule and a compare-and-set write for each of the three):
//   queue:   the owner's retry reads the status and whether the project is open and the request not withdrawn, and moves a
//            failed or pending notice (or one stuck in `sending` that the owner confirms was not sent) back to pending
//   claim:   a delivery moves pending to sending, only while the status is still what it read and the project still open
//   send:    the recipient is read, the email is sent (it can be refused, uncertain, or sent), and the outcome is written
//            only while the status is still `sending`; an uncertain outcome writes nothing
// What is left out, on purpose: the 60 second staleness test itself (the model lets the owner confirm only a notice that is
// stuck, and only truthfully: the email did not go out), the mail text, and the recipient's address.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module audioProjectNotices {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "claim-no-status"   the claim does not compare the status, so two deliveries that read `pending` both claim it
  //   "claim-no-open"     the claim does not compare that the project is still open
  //   "queue-no-open"     the retry does not compare that the project is still open
  //   "queue-any-status"  the rule lets a retry move a notice that was sent
  //   "uncertain-sent"    an uncertain outcome is written as sent
  //   "uncertain-failed"  an uncertain outcome is written as failed
  const MUTANT: str

  type Snap = { status: str, open: bool }
  // One delivery: phase "none", "read" (about to read), "claim" (about to claim), "lookup" (claimed, about to read the
  // recipient), "send" (about to send), "finish" (the outcome is known), "done" or "refused"; and what the send answered.
  type Run = { phase: str, snap: Snap, outcome: str }

  var status: str          // "pending", "sending", "sent" or "failed"
  var open: bool           // the project's access is open and the request is not withdrawn
  var epoch: int           // how many times the owner queued the notice again
  var mailed: int -> int   // ghost: the emails that really went out for each epoch (delivered, even if the answer was uncertain)
  var badClaim: bool       // ghost: a delivery claimed the notice while the project was closed
  var badQueue: bool       // ghost: the owner's retry moved a notice while the project was closed
  var badRequeue: bool     // ghost: a retry moved a notice that was sent
  var sentUnmailed: bool   // ghost: the status says sent but no email went out
  var failedMailed: bool   // ghost: the status says failed but the email went out
  var runs: int -> Run

  val RUNS = 1.to(3)
  val EPOCHS = 0.to(2)
  val noSnap = { status: "pending", open: true }

  val inFlight = RUNS.exists(r => {
    val p = runs.get(r).phase
    p == "claim" or p == "lookup" or p == "send" or p == "finish"
  })

  def alive(p: str): bool = p == "claim" or p == "lookup" or p == "send" or p == "finish"

  action init = all {
    status' = "pending",
    open' = true,
    epoch' = 0,
    mailed' = EPOCHS.mapBy(e => 0),
    badClaim' = false, badQueue' = false, badRequeue' = false, sentUnmailed' = false, failedMailed' = false,
    runs' = RUNS.mapBy(r => { phase: "none", snap: noSnap, outcome: "none" }),
  }

  // A delivery begins: it reads the status and whether the project is open, and the rule decides.
  action begin = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    val snap = { status: status, open: open }
    all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed,
      badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs.set(r, { phase: if (snap.status == "pending" and snap.open) "claim" else "refused", snap: snap, outcome: "none" }),
    }
  }

  // The claim: pending becomes sending while the status and the project's access are what the read saw.
  action claim = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "claim").oneOf()
    val h = runs.get(r)
    val ok = (MUTANT == "claim-no-status" or status == h.snap.status) and (MUTANT == "claim-no-open" or open == h.snap.open)
    if (ok) all {
      status' = "sending", open' = open, epoch' = epoch, mailed' = mailed,
      badClaim' = (badClaim or not(open)),
      badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs.set(r, { ...h, phase: "lookup" }),
    }
    else all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed,
      badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs.set(r, { ...h, phase: "refused" }),
    }
  }

  // The recipient is read; a closed project has none, and the notice is marked failed without an email.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "lookup").oneOf()
    val h = runs.get(r)
    all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed,
      badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs.set(r, if (open) { ...h, phase: "send" } else { ...h, phase: "finish", outcome: "refused" }),
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
      badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs.set(r, { ...h, phase: "finish", outcome: if (outcome == "sent" or outcome == "refused") outcome else "uncertain" }),
    }
  }

  // The outcome is written only while the status is still `sending`; an uncertain outcome writes nothing.
  action finish = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "finish").oneOf()
    val h = runs.get(r)
    val writes = status == "sending" and (h.outcome != "uncertain" or MUTANT == "uncertain-sent" or MUTANT == "uncertain-failed")
    val written =
      if (h.outcome == "sent" or (h.outcome == "uncertain" and MUTANT == "uncertain-sent")) "sent" else "failed"
    all {
      status' = if (writes) written else status,
      open' = open, epoch' = epoch, mailed' = mailed,
      badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue,
      sentUnmailed' = (sentUnmailed or (writes and written == "sent" and mailed.get(epoch) == 0)),
      failedMailed' = (failedMailed or (writes and written == "failed" and mailed.get(epoch) > 0)),
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // The owner's retry: a failed or pending notice, or one stuck in `sending` that the owner confirms was not sent (truthfully:
  // no email went out and no delivery is still working), goes back to pending, while the facts it read still hold.
  action queue = {
    val confirmedNotSent = status == "sending" and mailed.get(epoch) == 0 and not(RUNS.exists(r => alive(runs.get(r).phase)))
    val movable = status == "failed" or status == "pending" or confirmedNotSent or (MUTANT == "queue-any-status" and status == "sent")
    all {
      movable,
      epoch < 2,
      // The read and the write are one step here: the model's race is between a delivery's steps and this one, and the
      // compare-and-set of the retry (status and access equal to what it read) holds trivially in one step. The mutant that
      // removes the access comparison is therefore the rule that ignores it.
      MUTANT == "queue-no-open" or open,
      status' = "pending", open' = open,
      epoch' = epoch + 1,
      mailed' = mailed,
      badClaim' = badClaim,
      badQueue' = (badQueue or not(open)),
      badRequeue' = (badRequeue or status == "sent"),
      sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
      runs' = runs,
    }
  }

  // The owner closes the project's access, or the request is withdrawn, while a delivery is between its steps.
  action closes = all {
    open,
    inFlight,
    status' = status, open' = false, epoch' = epoch, mailed' = mailed,
    badClaim' = badClaim, badQueue' = badQueue, badRequeue' = badRequeue, sentUnmailed' = sentUnmailed, failedMailed' = failedMailed,
    runs' = runs,
  }

  action step = any { begin, claim, lookup, send, finish, queue, closes }

  // ---- Properties -------------------------------------------------------------------------------------------------
  // 1. Between two queuings, at most one email goes out: two deliveries never both claim the notice.
  val oneEmailPerQueuing = EPOCHS.forall(e => mailed.get(e) <= 1)

  // 2. A delivery claims the notice only while the project is open.
  val claimOnlyWhileOpen = not(badClaim)

  // 3. The owner's retry moves a notice only while the project is open.
  val queueOnlyWhileOpen = not(badQueue)

  // 4. A notice that was sent is never queued again.
  val sentNeverRequeued = not(badRequeue)

  // 5. A notice is marked sent only if an email went out.
  val sentMeansMailed = not(sentUnmailed)

  // 6. A notice is marked failed only if no email went out: an uncertain answer leaves it `sending` for the owner to judge.
  val failedMeansNotMailed = not(failedMailed)

  val allProperties = and {
    oneEmailPerQueuing, claimOnlyWhileOpen, queueOnlyWhileOpen, sentNeverRequeued, sentMeansMailed, failedMeansNotMailed,
  }

  // Reachability witness, for a hand with the negated invariant: a notice is sent, queued... a retry after a failure goes out.
  val sentTwiceOverall = mailed.get(0) + mailed.get(1) >= 2
  val neverSentTwiceOverall = not(sentTwiceOverall)
}

module projectNotices { import audioProjectNotices(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module projectNoticesClaimNoStatus { import audioProjectNotices(MUTANT = "claim-no-status").* }
module projectNoticesClaimNoOpen { import audioProjectNotices(MUTANT = "claim-no-open").* }
module projectNoticesQueueNoOpen { import audioProjectNotices(MUTANT = "queue-no-open").* }
module projectNoticesQueueAnyStatus { import audioProjectNotices(MUTANT = "queue-any-status").* }
module projectNoticesUncertainSent { import audioProjectNotices(MUTANT = "uncertain-sent").* }
module projectNoticesUncertainFailed { import audioProjectNotices(MUTANT = "uncertain-failed").* }
