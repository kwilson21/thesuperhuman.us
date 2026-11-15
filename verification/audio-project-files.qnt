// Quint model of an audio project's files: an upload that starts, completes or is aborted, and the owner's publish, revoke and
// complete, while the owner closes the project's access, the request is withdrawn or a payment is voided. Written for the
// design of the audio projects conversion (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (today each write is one statement or batch with its conditions in the WHERE; after the conversion a read,
// a rule and a guarded write, which is what the model has):
//   the read:     one batch reads the facts a rule uses: the project (access, stage), the request's status, the payments and the
//                 file or upload row (for a revoke also the version's other published files); R2 is a separate call
//                 (createMultipartUpload, complete, head, delete, abort)
//   the write:    ONE statement or batch that changes a row only while the conditions the rule used still hold now (the guard
//                 keeps today's conditions, as the offers design does), and that revokes the review files a publish replaces;
//                 a lost guard is not retried, the request answers what a refused write answers today (409). One write is
//                 different: a revoke's stage reset is decided by the rule from the read (no other published file of the
//                 version is left), and its batch carries a guard that the other published files and the stage are the ones
//                 read; a moved guard rolls the batch back and the request reads and decides again (three tries in all, as
//                 `decideAndSave` does), while the file's own guard (the status read, an open project) answers 409 at once
//   the upload:   the row is created before the file exists; `abort` marks it discarding in one guarded statement (only while
//                 no file row exists) and only then deletes the object; a file row is inserted only from a pending upload row
// The properties read the stored rows and never a flag set from a guard. Every write takes the next stamp of one counter
// (`seq`, the order D1 serializes the statements in, as the tables' timestamps order them), and the project's access, the
// request's withdrawal and the payments carry the stamp of the move that ended them (0 while they hold), as `revoked_at` and
// a payment's status change do. A payment that was never paid carries the first stamp.
// What is left out, on purpose: the file's name, size, peaks and expiry, the notices queued by a publish or revoke (the
// notices model), the client's reads of a file, the audit rows, and the bytes of the parts.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module audioProjectFiles {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "start-no-access"       the upload row is written without comparing the project's access
  //   "insert-no-access"      the file row is written without comparing the project's access
  //   "insert-no-state"       the file row is written without requiring a pending upload row
  //   "abort-no-cas"          an abort deletes the object without first marking the upload discarding
  //   "publish-no-access"     a publish does not compare the project's access
  //   "publish-no-payment"    a publish does not compare the payments
  //   "publish-no-stage"      a publish does not compare the stage
  //   "no-supersede"          a publish does not revoke the review it replaces
  //   "publish-stale-supersede" a publish revokes the live review files it read without the guard that they are still the ones
//                           live (and without the retry), so a review published in between stays live
//   "reset-no-link"         a revoke's stage reset is written when the file update was refused (the reset is not linked to it)
//   "revoke-stale-reset"    a revoke decides the stage reset from the other files it read and writes it without the guard that they
//                           are still the ones read (and without the retry)
  //   "complete-no-stage"     a completion compares neither the stage nor the published final
//   "revoke-no-first-status" a revoke that read a draft and retries does not carry the first read's status, so a publish that
//                           landed in between lets it revoke the published file
//   "only-final-plus"       no change to the rules: the run starts only from `finalPlus` (a pass run, not a mutant)
//   "only-final-and-review" no change to the rules: the run starts only from the point `finalAndReview` (a pass run, not a mutant)
//   "complete-no-file"      a completion does not compare the published final (an equivalent mutant: the stage implies it)
//   "final-no-supersede"    a publish of a final does not revoke the live review (the write has no condition on the version only for a review)
  //   "complete-no-payment"   a completion does not compare the payments
  const MUTANT: str

  // A file row. status "none" is no row; insAt and pubAt are the stamps of its insert and publication (0 for none).
  type File = { version: str, status: str, insAt: int, pubAt: int }
  // The facts one read saw.
  type Snap = {
    revoked: bool, withdrawn: bool, booking: bool, balance: bool, stage: str,
    fileStatus: str, upload: str, object: bool, others: Set[int], reviews: Set[int], finalLive: int,
  }
  // One request: kind "upload", "publish", "revoke" or "complete", on file `id`; its phase; and the reads a revoke made.
  type Run = { kind: str, id: int, version: str, phase: str, snap: Snap, tries: int, first: str }

  // The project, its files, its uploads and R2, in one record so a step names only what it changes.
  type World = {
    files: int -> File,
    ups: int -> str,         // the upload rows: "none", "pending" or "discarding"
    upVersion: int -> str,
    upAt: int -> int,        // the stamp of the upload row's write (0 for none)
    mp: int -> bool,         // R2: the multipart upload is alive
    obj: int -> bool,        // R2: the object exists
    seq: int,                // the last stamp taken
    revokedAt: int,          // the stamp of the project's close (0 while open): `revoked_at`
    withdrawnAt: int,        // the stamp of the request's withdrawal (0 while not withdrawn)
    bookingVoidAt: int,      // the stamp of the booking's voiding (0 while paid)
    balanceVoidAt: int,      // the stamp of the balance's voiding (0 while paid; 1 when it was never paid)
    stage: str,
    completedAt: int,        // the stamp of the completion (0 while not complete): `completed_at`
  }
  var w: World
  var runs: int -> Run

  val IDS = 1.to(2)
  val RUNS = 1.to(5)
  val VERSIONS = Set("review", "final")

  val noSnap = {
    revoked: false, withdrawn: false, booking: false, balance: false, stage: "in_progress",
    fileStatus: "none", upload: "none", object: false, others: Set(), reviews: Set(), finalLive: 0,
  }
  val idleRun = { kind: "none", id: 1, version: "review", phase: "none", snap: noSnap, tries: 0, first: "none" }
  val noFile = { version: "review", status: "none", insAt: 0, pubAt: 0 }

  // The facts the rules and guards read, from the stamps.
  def isRevoked: bool = w.revokedAt > 0
  def isWithdrawn: bool = w.withdrawnAt > 0
  def bookingPaid: bool = w.bookingVoidAt == 0
  def balancePaid: bool = w.balanceVoidAt == 0

  // ---- Rules, from the plain columns -------------------------------------------------------------------------------
  def openStage(s: str): bool = s == "in_progress" or s == "review_ready" or s == "revision_in_progress"

  def canUpload(version: str, revokedNow: bool, withdrawnNow: bool, bookingNow: bool, stageNow: str): bool = and {
    not(revokedNow), not(withdrawnNow), bookingNow,
    openStage(stageNow) or (version == "final" and stageNow == "final_files_ready"),
  }

  def canPublish(version: str, revokedNow: bool, withdrawnNow: bool, bookingNow: bool, balanceNow: bool, stageNow: str): bool = and {
    not(revokedNow), not(withdrawnNow), bookingNow,
    if (version == "review") openStage(stageNow)
    else (openStage(stageNow) or stageNow == "final_files_ready") and balanceNow,
  }

  // The published files of a version, other than file `id`.
  def liveOtherIds(version: str, id: int): Set[int] =
    IDS.filter(i => i != id and w.files.get(i).status == "published" and w.files.get(i).version == version)

  // The published review files other than file `id`: what any publish supersedes.
  def liveReviewIds(id: int): Set[int] =
    IDS.filter(i => i != id and w.files.get(i).status == "published" and w.files.get(i).version == "review")

  def liveOf(version: str): int =
    IDS.filter(i => w.files.get(i).status == "published" and w.files.get(i).version == version).size()

  def snapOf(id: int): Snap = {
    revoked: isRevoked, withdrawn: isWithdrawn, booking: bookingPaid, balance: balancePaid, stage: w.stage,
    fileStatus: w.files.get(id).status, upload: w.ups.get(id), object: w.obj.get(id),
    others: liveOtherIds(w.files.get(id).version, id), reviews: liveReviewIds(id), finalLive: liveOf("final"),
  }

  // The guards of the writes, each the conditions the code checks today, now. A mutant leaves one out.
  def uploadGuard(version: str): bool = and {
    MUTANT == "start-no-access" or (not(isRevoked) and not(isWithdrawn)),
    bookingPaid,
    openStage(w.stage) or (version == "final" and w.stage == "final_files_ready"),
  }

  def insertGuard(version: str): bool = and {
    MUTANT == "insert-no-access" or (not(isRevoked) and not(isWithdrawn)),
    bookingPaid,
    openStage(w.stage) or (version == "final" and w.stage == "final_files_ready"),
  }

  def publishGuard(version: str): bool = and {
    MUTANT == "publish-no-access" or (not(isRevoked) and not(isWithdrawn)),
    MUTANT == "publish-no-payment" or (bookingPaid and (version == "review" or balancePaid)),
    MUTANT == "publish-no-stage" or (if (version == "review") openStage(w.stage) else (openStage(w.stage) or w.stage == "final_files_ready")),
  }

  // A request is between its read and its write: the facts it read can change now.
  def inflightPhase(p: str): bool = or {
    p == "write", p == "createMultipart", p == "row", p == "completeR2", p == "fileRow", p == "abortR2",
  }

  // ---- Start ------------------------------------------------------------------------------------------------------
  // The starting points. The run that must pass takes all of them; a mutant whose race needs one particular start takes only
  // that one (found in a few random runs instead of many), which narrows where the search begins and not what the properties say.
  val allStarts = Set("fresh", "review", "final", "reviewPlus", "finalPlus", "finalBoth", "twoReviews", "reviewFinal", "finalAndReview")
  val starts =
    if (MUTANT == "publish-no-stage") Set("finalAndReview")        // a review publish read at in_progress, a final publish lands first
    else if (MUTANT == "publish-stale-supersede") Set("twoReviews")  // two uploaded reviews published at once
    else if (MUTANT == "complete-no-stage") Set("final", "finalPlus") // the last final is revoked between the read and the write
    else if (MUTANT == "revoke-no-first-status") Set("twoReviews") // a draft is revoked while its publish lands
    else if (MUTANT == "only-final-plus") Set("finalPlus") // no mutation: the pass run for the final branch of the publish's stage guard
    else if (MUTANT == "only-final-and-review") Set("finalAndReview") // no mutation: the pass run that reaches a publish whose stage guard is false in a race
    else allStarts

  action init = {
    nondet scenario = starts.oneOf()
    val paidBalance = scenario == "final" or scenario == "finalPlus" or scenario == "finalBoth" or scenario == "reviewFinal" or scenario == "finalAndReview"
    all {
      w' = {
        files: IDS.mapBy(i =>
          if (i == 1 and (scenario == "review" or scenario == "reviewPlus")) { ...noFile, version: "review", status: "published", pubAt: -1 }
          else if (i == 1 and (scenario == "final" or scenario == "finalPlus" or scenario == "finalBoth")) { ...noFile, version: "final", status: "published", pubAt: -1 }
          else if (i == 2 and scenario == "finalBoth") { ...noFile, version: "final", status: "published", pubAt: -1 }
          else if (i == 1 and scenario == "finalAndReview") { ...noFile, version: "final", status: "uploaded" }
          else if (i == 2 and scenario == "finalAndReview") { ...noFile, version: "review", status: "uploaded" }
          else if (i == 2 and scenario == "reviewFinal") { ...noFile, version: "final", status: "uploaded" }
          else if (i == 1 and scenario == "reviewFinal") { ...noFile, version: "review", status: "published", pubAt: -1 }
          else if (scenario == "twoReviews") { ...noFile, version: "review", status: "uploaded" }
          else if (i == 2 and scenario == "reviewPlus") { ...noFile, version: "review", status: "uploaded" }
          else if (i == 2 and scenario == "finalPlus") { ...noFile, version: "final", status: "uploaded" }
          else noFile),
        ups: IDS.mapBy(i => "none"),
        upVersion: IDS.mapBy(i => "review"),
        upAt: IDS.mapBy(i => 0),
        mp: IDS.mapBy(i => false),
        obj: IDS.mapBy(i => scenario != "fresh" and (i == 1 or scenario == "reviewPlus" or scenario == "finalPlus" or scenario == "finalBoth" or scenario == "twoReviews" or scenario == "reviewFinal" or scenario == "finalAndReview")),
        seq: 1, revokedAt: 0, withdrawnAt: 0, bookingVoidAt: 0, balanceVoidAt: if (paidBalance) 0 else 1,
        stage: if (scenario == "review" or scenario == "reviewPlus" or scenario == "reviewFinal") "review_ready"
               else if (scenario == "finalAndReview") "in_progress"
               else if (paidBalance) "final_files_ready" else "in_progress",
        completedAt: 0,
      },
      runs' = RUNS.mapBy(r => idleRun),
    }
  }

  // A request begins. Each request has a part: request 1 starts an upload (the file id 2), request 2 completes it, request 3
  // aborts it, and requests 4 and 5 are the owner's publish, revoke or completion of a file. A part begins only when it can.
  action begin = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet ownerKind = Set("publish", "revoke", "complete").oneOf()
    nondet id = IDS.oneOf()
    nondet version = VERSIONS.oneOf()
    all {
      if (r == 1) and { w.ups.get(2) == "none", w.files.get(2).status == "none" }
      else if (r == 2) w.ups.get(2) == "pending"
      else if (r == 3) w.ups.get(2) != "none"
      else if (ownerKind == "complete") true
      else w.files.get(id).status != "none",
      w' = w,
      runs' = runs.set(r,
        if (r == 1) { ...idleRun, kind: "upload", id: 2, version: version, phase: "read" }
        else if (r == 2) { ...idleRun, kind: "finish", id: 2, phase: "completeRead" }
        else if (r == 3) { ...idleRun, kind: "abort", id: 2, phase: "abortCas" }
        else { ...idleRun, kind: ownerKind, id: id, phase: "read" }),
    }
  }

  // ---- One read, and the rule that decides from it ----------------------------------------------------------------
  action read = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val s = snapOf(h.id)
    val version = if (h.kind == "upload") h.version else w.files.get(h.id).version
    val go =
      if (h.kind == "upload") canUpload(version, s.revoked, s.withdrawn, s.booking, s.stage)
      else if (h.kind == "publish") s.fileStatus == "uploaded" and s.object and canPublish(version, s.revoked, s.withdrawn, s.booking, s.balance, s.stage)
      else if (h.kind == "revoke")
        // The status the first read saw is carried into every retry: a file whose status moved since (a draft that was
        // published in between) is refused, as today's statement compares the status read earlier in the same request.
        (s.fileStatus == "uploaded" or s.fileStatus == "published") and (h.tries == 0 or MUTANT == "revoke-no-first-status" or s.fileStatus == h.first)
      else s.stage == "final_files_ready" and s.finalLive > 0 and s.booking and s.balance and not(s.revoked) and not(s.withdrawn)
    all {
      w' = w,
      runs' = runs.set(r, { ...h, snap: s, version: version, first: if (h.tries == 0) s.fileStatus else h.first, phase: if (go) (if (h.kind == "upload") "createMultipart" else "write") else "refused" }),
    }
  }

  // ---- The owner's writes: one guarded statement or batch each ----------------------------------------------------
  action write = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "write").oneOf()
    val h = runs.get(r)
    val s = h.snap
    val f = w.files.get(h.id)
    val fresh = f.status == s.fileStatus
    val rev = f.version
    val at = w.seq + 1
    // A revoke's stage reset is decided by the rule from the read: no other published file of the version was left, and the
    // stage was the one the version resets. Its batch guard: the others and the stage are still the ones read.
    val reset = s.others.size() == 0 and ((rev == "review" and s.stage == "review_ready") or (rev == "final" and (s.stage == "final_files_ready" or s.stage == "complete")))
    val guardMoved =
      if (h.kind == "revoke") MUTANT != "revoke-stale-reset" and (liveOtherIds(rev, h.id) != s.others or w.stage != s.stage)
      else if (h.kind == "publish") MUTANT != "publish-stale-supersede" and liveReviewIds(h.id) != s.reviews
      else false
    val ok =
      if (h.kind == "publish") and { fresh, publishGuard(rev) }
      else if (h.kind == "revoke") and { fresh, not(isRevoked) }
      else and {
        // The stage guard is also what protects the published final: a revoke of the last final resets the stage in its own batch.
        MUTANT == "complete-no-stage" or w.stage == "final_files_ready",
        // Today's statement also requires a published final (the corpus races revoke the file row alone); in this model the
        // stage implies it, because a revoke of the last final resets the stage in its own batch.
        MUTANT == "complete-no-stage" or MUTANT == "complete-no-file" or liveOf("final") > 0,
        MUTANT == "complete-no-payment" or (bookingPaid and balancePaid),
        not(isRevoked) and not(isWithdrawn),
      }
    if (guardMoved)
      // The batch guard raised: nothing was written. The request reads and decides again, three tries in all.
      all { w' = w, runs' = runs.set(r, if (h.tries < 2) { ...h, tries: h.tries + 1, phase: "read" } else { ...h, phase: "conflict" }) }
    else if (not(ok))
      // The file's own guard refused (the status moved, or the project closed): nothing is written, and the request answers 409
      // at once. The reset is linked to the file update landing; the mutant writes it when the file update did not.
      all {
        w' = if (MUTANT == "reset-no-link" and h.kind == "revoke" and reset)
               { ...w, seq: at, stage: "in_progress", completedAt: 0 } else w,
        runs' = runs.set(r, { ...h, phase: "conflict" }),
      }
    else if (h.kind == "publish") all {
      w' = { ...w,
        seq: at,
        files: IDS.mapBy(i =>
          if (i == h.id) { ...f, status: "published", pubAt: at }
          else if (MUTANT != "no-supersede" and not(MUTANT == "final-no-supersede" and rev == "final") and s.reviews.contains(i))
            { ...w.files.get(i), status: "revoked" }
          else w.files.get(i)),
        stage: if (rev == "review") "review_ready" else "final_files_ready" },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else if (h.kind == "revoke") all {
      // Without another published file of its version the project returns to in_progress (also a completed project losing its
      // only final), as the rule decided from the read; the mutant writes that decision without the guard.
      w' = { ...w,
        seq: at,
        files: w.files.set(h.id, { ...f, status: "revoked" }),
        stage: if (reset) "in_progress" else w.stage,
        completedAt: if (reset) 0 else w.completedAt },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else all {
      w' = { ...w, seq: at, stage: "complete", completedAt: at },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // ---- An upload: start (the row), then complete or abort --------------------------------------------------------
  // R2 creates the multipart upload.
  action createMultipart = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "createMultipart").oneOf()
    val h = runs.get(r)
    all {
      w' = { ...w, mp: w.mp.set(h.id, true) },
      runs' = runs.set(r, { ...h, phase: "row" }),
    }
  }

  // The upload row is written while the facts are what the read saw (and the id is new); otherwise the multipart upload is aborted.
  action row = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "row").oneOf()
    val h = runs.get(r)
    val ok = and { w.ups.get(h.id) == "none", uploadGuard(h.version) }
    if (ok) all {
      w' = { ...w,
        seq: w.seq + 1,
        ups: w.ups.set(h.id, "pending"),
        upVersion: w.upVersion.set(h.id, h.version),
        upAt: w.upAt.set(h.id, w.seq + 1) },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else all {
      w' = { ...w, mp: w.mp.set(h.id, false) },
      runs' = runs.set(r, { ...h, phase: "conflict" }),
    }
  }

  // Completing: read the row and the facts, decide, complete the object in R2, then write the file row.
  action completeRead = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "completeRead").oneOf()
    val h = runs.get(r)
    val s = snapOf(h.id)
    val go = s.upload == "pending" and canUpload(w.upVersion.get(h.id), s.revoked, s.withdrawn, s.booking, s.stage)
    all { w' = w, runs' = runs.set(r, { ...h, snap: s, phase: if (go) "completeR2" else "refused" }) }
  }

  action completeR2 = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "completeR2").oneOf()
    val h = runs.get(r)
    // R2 can complete a multipart upload only while it is alive; an aborted one is gone (the call fails).
    if (w.mp.get(h.id) or w.obj.get(h.id)) all {
      w' = { ...w, mp: w.mp.set(h.id, false), obj: w.obj.set(h.id, true) },
      runs' = runs.set(r, { ...h, phase: "fileRow" }),
    }
    else all { w' = w, runs' = runs.set(r, { ...h, phase: "failed" }) }
  }

  // The file row, from a pending upload row, while the facts are what the read saw; then the upload row goes.
  action fileRow = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "fileRow").oneOf()
    val h = runs.get(r)
    val v = w.upVersion.get(h.id)
    val ok = and {
      w.files.get(h.id).status == "none",
      MUTANT == "insert-no-state" or w.ups.get(h.id) == "pending",
      insertGuard(v),
    }
    if (ok) all {
      w' = { ...w,
        seq: w.seq + 1,
        files: w.files.set(h.id, { version: v, status: "uploaded", insAt: w.seq + 1, pubAt: 0 }),
        ups: w.ups.set(h.id, "none"),
        upAt: w.upAt.set(h.id, 0) },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else all { w' = w, runs' = runs.set(r, { ...h, phase: "blocked" }) }
  }

  // Aborting: mark the row discarding while no file row exists (one guarded statement), then delete the object, then the row.
  action abortCas = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "abortCas").oneOf()
    val h = runs.get(r)
    val canMark = w.ups.get(h.id) != "none" and w.files.get(h.id).status == "none"
    if (MUTANT == "abort-no-cas") all { w' = w, runs' = runs.set(r, { ...h, phase: "abortR2" }) }
    else if (canMark) all {
      w' = { ...w, ups: w.ups.set(h.id, "discarding") },
      runs' = runs.set(r, { ...h, phase: "abortR2" }),
    }
    else all { w' = w, runs' = runs.set(r, { ...h, phase: "done" }) }
  }

  action abortR2 = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "abortR2").oneOf()
    val h = runs.get(r)
    all {
      w' = { ...w, mp: w.mp.set(h.id, false), obj: w.obj.set(h.id, false) },
      runs' = runs.set(r, { ...h, phase: "abortRow" }),
    }
  }

  action abortRow = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "abortRow").oneOf()
    val h = runs.get(r)
    all {
      w' = if (w.files.get(h.id).status == "none") { ...w, ups: w.ups.set(h.id, "none"), upAt: w.upAt.set(h.id, 0) } else w,
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // ---- The world: access closes, the request is withdrawn, a payment is voided ------------------------------------
  // These happen while a request is between its read and its write (see `inflightPhase`); so a step takes one only then.
  val inflight = RUNS.exists(r => inflightPhase(runs.get(r).phase))

  action ownerRevokes = all { inflight, not(isRevoked), w' = { ...w, seq: w.seq + 1, revokedAt: w.seq + 1 }, runs' = runs }
  action requestWithdrawn = all { inflight, not(isWithdrawn), w' = { ...w, seq: w.seq + 1, withdrawnAt: w.seq + 1 }, runs' = runs }
  action bookingVoided = all { inflight, bookingPaid, w' = { ...w, seq: w.seq + 1, bookingVoidAt: w.seq + 1 }, runs' = runs }
  action balanceVoided = all { inflight, balancePaid, w' = { ...w, seq: w.seq + 1, balanceVoidAt: w.seq + 1 }, runs' = runs }

  action step = any {
    begin, read, write, createMultipart, row, completeRead, completeR2, fileRow, abortCas, abortR2, abortRow,
    ownerRevokes, requestWithdrawn, bookingVoided, balanceVoided,
  }

  // ---- Properties (each reads the stored rows and stamps) ----------------------------------------------------------
  // A stamp `t` is "before" a move whose stamp is `m` when the move has not happened (0) or came later.
  def before(t: int, m: int): bool = m == 0 or t < m
  def whileOpenAndBooked(t: int): bool = and {
    before(t, w.revokedAt), before(t, w.withdrawnAt), before(t, w.bookingVoidAt),
  }

  // 1. A file row is written only while the project's access is open, the request is not withdrawn and the booking is paid.
  val filesOnlyForOpenProject = IDS.forall(i => w.files.get(i).status == "none" or whileOpenAndBooked(w.files.get(i).insAt))

  // 2. An upload row is written only while the project's access is open, the request is not withdrawn and the booking is paid.
  val uploadsOnlyForOpenProject = IDS.forall(i => w.ups.get(i) == "none" or whileOpenAndBooked(w.upAt.get(i)))

  // 3. A file is published only while the access is open, the request is not withdrawn and the booking (and for a final the
  // balance) is paid.
  val publishedOnlyWhenPaidAndOpen = IDS.forall(i =>
    w.files.get(i).status != "published" or and {
      whileOpenAndBooked(w.files.get(i).pubAt),
      w.files.get(i).version == "review" or before(w.files.get(i).pubAt, w.balanceVoidAt),
    })

  // 4. The stage agrees with the rows around it: a published final means the project is at a final stage (a review is never
  // published over it), and a completion is stamped exactly while the stage is complete (a final is never published over a
  // completed project), whatever the stage allowed.
  val stageCoherent = and {
    liveOf("final") == 0 or w.stage == "final_files_ready" or w.stage == "complete",
    (w.completedAt > 0) == (w.stage == "complete"),
  }

  // 5. At most one review file is published at a time.
  val oneLiveReview = liveOf("review") <= 1

  // 6. A stage that needs a published file has one: review_ready a published review; final_files_ready and complete a published final.
  val readyStagesHaveFiles = and {
    w.stage != "review_ready" or liveOf("review") > 0,
    (w.stage != "final_files_ready" and w.stage != "complete") or liveOf("final") > 0,
  }

  // 7. A project is completed only while the booking and the balance are paid.
  val completedOnlyWhenPaid = w.completedAt == 0 or (before(w.completedAt, w.bookingVoidAt) and before(w.completedAt, w.balanceVoidAt))

  // 8. A file that is uploaded or published has its object in R2 (so a file row never comes from an upload being discarded: the
  // abort deletes the object).
  val fileHasObject = IDS.forall(i => (w.files.get(i).status != "uploaded" and w.files.get(i).status != "published") or w.obj.get(i))

  // 9. A project at a final stage has no live review: publishing a final supersedes it, as today's statement does.
  val finalStageHasNoLiveReview = (w.stage != "final_files_ready" and w.stage != "complete") or liveOf("review") == 0

  // 10. A revoke that read a draft never revokes a file that had been published: the file's `published_at` is set exactly when the
  // first read saw it published (the request keeps the status of its first read).
  val revokeKeepsFirstRead = RUNS.forall(r =>
    runs.get(r).kind != "revoke" or runs.get(r).phase != "done" or (w.files.get(runs.get(r).id).pubAt != 0) == (runs.get(r).first == "published"))

  val allProperties = and {
    revokeKeepsFirstRead, finalStageHasNoLiveReview, filesOnlyForOpenProject, uploadsOnlyForOpenProject, publishedOnlyWhenPaidAndOpen, stageCoherent, oneLiveReview,
    readyStagesHaveFiles, completedOnlyWhenPaid, fileHasObject,
  }

  // Reachability witness, for a hand with the negated invariant: an owner's upload becomes a published file.
  val uploadPublished = w.files.get(2).status == "published" and w.obj.get(2)
  val neverPublishedUpload = not(uploadPublished)
}

module projectFiles { import audioProjectFiles(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module projectFilesStartNoAccess { import audioProjectFiles(MUTANT = "start-no-access").* }
module projectFilesInsertNoAccess { import audioProjectFiles(MUTANT = "insert-no-access").* }
module projectFilesInsertNoState { import audioProjectFiles(MUTANT = "insert-no-state").* }
module projectFilesAbortNoCas { import audioProjectFiles(MUTANT = "abort-no-cas").* }
module projectFilesPublishNoAccess { import audioProjectFiles(MUTANT = "publish-no-access").* }
module projectFilesPublishNoPayment { import audioProjectFiles(MUTANT = "publish-no-payment").* }
module projectFilesPublishNoStage { import audioProjectFiles(MUTANT = "publish-no-stage").* }
module projectFilesNoSupersede { import audioProjectFiles(MUTANT = "no-supersede").* }
module projectFilesRevokeStaleReset { import audioProjectFiles(MUTANT = "revoke-stale-reset").* }
module projectFilesCompleteNoStage { import audioProjectFiles(MUTANT = "complete-no-stage").* }
module projectFilesCompleteNoPayment { import audioProjectFiles(MUTANT = "complete-no-payment").* }
module projectFilesPublishStaleSupersede { import audioProjectFiles(MUTANT = "publish-stale-supersede").* }
module projectFilesResetNoLink { import audioProjectFiles(MUTANT = "reset-no-link").* }
module projectFilesCompleteNoFile { import audioProjectFiles(MUTANT = "complete-no-file").* }
module projectFilesFinalNoSupersede { import audioProjectFiles(MUTANT = "final-no-supersede").* }
module projectFilesFinalAndReview { import audioProjectFiles(MUTANT = "only-final-and-review").* }
module projectFilesFinalPlus { import audioProjectFiles(MUTANT = "only-final-plus").* }
module projectFilesRevokeNoFirstStatus { import audioProjectFiles(MUTANT = "revoke-no-first-status").* }
