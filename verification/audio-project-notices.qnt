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
// The properties read the stored state and the world (the emails that really went out) and never a flag set from a guard. The
// clock stamps the attempt and the close, as `invitation_attempted_at` and `revoked_at` do.
// What is left out, on purpose: the 60 second staleness test itself (the model lets the owner confirm only a notice that is
// stuck, and only truthfully: the email did not go out), the mail text, the recipient's address, and the retry's open
// condition, which has no stored effect beyond its own answer (409): the delivery that follows a retry on a closed project
// sends nothing (the invitation's claim refuses, the update's recipient read is empty), which the properties below cover.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module audioProjectNotices {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "claim-no-status"   the claim does not compare the status, so two deliveries that read `pending` both claim it
  //   "claim-no-open"     the invitation's claim does not compare that the project is still open
  //   "queue-any-status"  the rule lets a retry move a notice that was sent
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
  // "invitation" or "update": whose conditions the claim and the outcome write have (see the header).
  const KIND: str

  type Snap = { status: str, open: bool, attempt: int }
  // One delivery: phase "none", "read" (about to read), "claim" (about to claim), "lookup" (claimed, about to read the
  // recipient), "send" (about to send), "finish" (the outcome is known), "done" or "refused"; and what the send answered.
  type Run = { phase: str, snap: Snap, outcome: str }

  var status: str          // "pending", "sending", "sent" or "failed"
  var open: bool           // the project's access is open and the request is not withdrawn
  var epoch: int           // how many times the owner queued the notice again
  var mailed: int -> int   // the world: the emails that really went out for each epoch (delivered, even if the answer was uncertain)
  var clock: int           // a logical clock that stamps the attempt and the close
  var attempt: int         // the stored attempt time (0 for none, as `invitation_attempted_at` NULL); a queue clears it
  var closedAt: int        // the stored close time (0 while open, as `revoked_at` NULL)
  var runs: int -> Run

  val RUNS = 1.to(3)
  // Keys 4 and 5 of `runs` are two owner retries (two tabs): phase "none", "write" (read, about to write) or "done"; its snap is what it read.
  val RETRIES = Set(4, 5)
  val KEYS = 1.to(5)
  val EPOCHS = 0.to(2)
  val noSnap = { status: "pending", open: true, attempt: 0 }

  val inFlight = RUNS.exists(r => {
    val p = runs.get(r).phase
    p == "claim" or p == "lookup" or p == "send" or p == "finish"
  })

  def alive(p: str): bool = p == "claim" or p == "lookup" or p == "send" or p == "finish"

  // The claim's rule, from what the read saw: the invitation's also needs the project open.
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

  // The claim: pending becomes sending while the status (and, for the invitation, the project's access) is what the read saw.
  action claim = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "claim").oneOf()
    val h = runs.get(r)
    val ok = (MUTANT == "claim-no-status" or status == "pending") and (KIND == "update" or MUTANT == "claim-no-open" or open)
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

  // The recipient is read; a closed project has none, and the notice is marked failed without an email.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "lookup").oneOf()
    val h = runs.get(r)
    all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, if (open or MUTANT == "lookup-no-open") { ...h, phase: "send" } else { ...h, phase: "finish", outcome: "refused" }),
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
      KIND == "update" or open,
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

  // The owner's retry is two steps, as the code is: a read and the rule, then a write. A failed or pending notice, or one stuck in
  // `sending` that the owner confirms was not sent (truthfully: no email went out and no delivery is still working), goes back to
  // pending. The write compares what the read saw: the status and, for a notice read as `sending`, that no attempt is newer than the
  // one read (today's `invitation_attempted_at<=?`, `notification_attempted_at<=?`, against the cutoff the retry computed), and the
  // project's access. Two retries can be in flight (two tabs), each in its own key of `runs`.
  action queueRead = {
    nondet r = RETRIES.filter(i => runs.get(i).phase == "none").oneOf()
    val confirmedNotSent = status == "sending" and mailed.get(epoch) == 0 and not(RUNS.exists(i => alive(runs.get(i).phase)))
    val movable = status == "failed" or status == "pending" or confirmedNotSent or (MUTANT == "queue-any-status" and status == "sent")
    all {
      movable,
      epoch < 2,
      open,
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { phase: "write", snap: { status: status, open: open, attempt: attempt }, outcome: "none" }),
    }
  }

  action queueWrite = {
    nondet r = RETRIES.filter(i => runs.get(i).phase == "write").oneOf()
    val h = runs.get(r)
    // Today's condition, exactly: `status IN ('pending','failed')`, or `sending` when the owner confirmed it (the retry read it as
    // `sending`) and its attempt is not newer than the one read (`attempted_at<=?`). The mutants drop the attempt, or every condition.
    val holds =
      MUTANT == "queue-no-cas" or status == "failed" or status == "pending" or
      (MUTANT == "queue-any-status" and status == "sent") or
      (h.snap.status == "sending" and status == "sending" and (MUTANT == "queue-status-only" or attempt <= h.snap.attempt))
    if (holds and open) all {
      status' = "pending", open' = open, epoch' = epoch + 1, mailed' = mailed,
      clock' = clock, attempt' = 0, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "done" }),
    } else all {
      status' = status, open' = open, epoch' = epoch, mailed' = mailed, clock' = clock, attempt' = attempt, closedAt' = closedAt,
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // The owner closes the project's access, or the request is withdrawn, while a delivery is between its steps.
  action closes = all {
    open,
    inFlight,
    status' = status, open' = false, epoch' = epoch, mailed' = mailed,
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
  val claimOnlyWhileOpen = KIND == "update" or closedAt == 0 or attempt == 0 or attempt < closedAt

  // 2b. The update notice is claimed after the close (its claim has no access condition), and no email goes out for it: its
  // recipient read finds no recipient of a closed project, so the notice ends `failed` and never mails. (The property is about
  // the update notice; for the invitation, property 2 is the claim's.)
  val closedUpdateNeverMails = KIND == "invitation" or closedAt == 0 or attempt == 0 or attempt < closedAt or mailed.get(epoch) == 0

  // 3. A notice is marked sent only if an email went out.
  val sentMeansMailed = status != "sent" or mailed.get(epoch) >= 1

  // 4. A notice is marked failed only if no email went out: an uncertain answer leaves it `sending` for the owner to judge.
  val failedMeansNotMailed = status != "failed" or mailed.get(epoch) == 0

  val allProperties = and {
    oneEmailInTotal, claimOnlyWhileOpen, closedUpdateNeverMails, sentMeansMailed, failedMeansNotMailed,
  }

  // Reachability witness, for a hand with the negated invariant: a retry after a failure goes out (two epochs with an email
  // is not reachable, so this holds; the witness is that one email goes out after a queue).
  val mailedAfterQueue = epoch > 0 and mailed.get(epoch) > 0
  val neverMailedAfterQueue = not(mailedAfterQueue)
}

module projectNotices { import audioProjectNotices(MUTANT = "none", KIND = "invitation").* }
module projectNoticesUpdate { import audioProjectNotices(MUTANT = "none", KIND = "update").* }

// Mutants of the invitation. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module projectNoticesClaimNoStatus { import audioProjectNotices(MUTANT = "claim-no-status", KIND = "invitation").* }
module projectNoticesClaimNoOpen { import audioProjectNotices(MUTANT = "claim-no-open", KIND = "invitation").* }
module projectNoticesQueueAnyStatus { import audioProjectNotices(MUTANT = "queue-any-status", KIND = "invitation").* }
module projectNoticesUncertainSent { import audioProjectNotices(MUTANT = "uncertain-sent", KIND = "invitation").* }
module projectNoticesUncertainFailed { import audioProjectNotices(MUTANT = "uncertain-failed", KIND = "invitation").* }
module projectNoticesUpdateLookupNoOpen { import audioProjectNotices(MUTANT = "lookup-no-open", KIND = "update").* }
module projectNoticesQueueNoCas { import audioProjectNotices(MUTANT = "queue-no-cas", KIND = "invitation").* }
module projectNoticesQueueStatusOnly { import audioProjectNotices(MUTANT = "queue-status-only", KIND = "invitation").* }
