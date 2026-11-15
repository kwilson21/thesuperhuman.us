// Quint model of an audio project's files: an upload that starts, completes or is aborted, and the owner's publish, revoke and
// complete, while the owner closes the project's access, the request is withdrawn or a payment is voided. Written for the
// design of the audio projects conversion (docs/plans/2026-11-audio-projects-conversion.md, section 6), before its code.
// Code modelled (today each write is one statement or batch with its conditions in the WHERE; after the conversion a read,
// a rule and a guarded write, which is what the model has):
//   the read:     one batch reads the facts a rule uses: the project (access, stage), the request's status, the payments and the
//                 file or upload row; R2 is a separate call (createMultipartUpload, complete, head, delete, abort)
//   the write:    ONE statement or batch that changes a row only while each fact the rule used is still what the read saw
//                 (compare-and-set), and that revokes the review files a publish replaces
//   the upload:   the row is created before the file exists; `abort` marks it discarding in one guarded statement (only while
//                 no file row exists) and only then deletes the object; a file row is inserted only from a pending upload row
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
  //   "revoke-no-others"      a revoke does not compare the other published files of its version
  //   "complete-no-stage"     a completion does not compare the stage
  //   "complete-no-payment"   a completion does not compare the payments
  const MUTANT: str

  // A file row. status "none" is no row; the ghosts are set from the state the write found.
  type File = { version: str, status: str, openAtInsert: bool, upload: str, allowedAtPublish: bool }
  // The facts one read saw.
  type Snap = {
    revoked: bool, withdrawn: bool, booking: bool, balance: bool, stage: str,
    fileStatus: str, upload: str, object: bool, othersLive: int, finalLive: int,
  }
  // One request: kind "upload", "publish", "revoke" or "complete", on file `id`; and its phase.
  type Run = { kind: str, id: int, version: str, phase: str, snap: Snap }

  // The project, its files, its uploads and R2, in one record so a step names only what it changes.
  type World = {
    files: int -> File,
    ups: int -> str,         // the upload rows: "none", "pending" or "discarding"
    upVersion: int -> str,
    upOpen: int -> bool,     // ghost: the project's access was open when the upload row was written
    mp: int -> bool,         // R2: the multipart upload is alive
    obj: int -> bool,        // R2: the object exists
    revoked: bool,
    withdrawn: bool,
    booking: bool,
    balance: bool,
    stage: str,
    completedPaid: bool,     // ghost: the payments were paid when the project was completed
  }
  var w: World
  var runs: int -> Run

  val IDS = 1.to(2)
  val RUNS = 1.to(5)
  val VERSIONS = Set("review", "final")

  val noSnap = {
    revoked: false, withdrawn: false, booking: false, balance: false, stage: "in_progress",
    fileStatus: "none", upload: "none", object: false, othersLive: 0, finalLive: 0,
  }
  val idleRun = { kind: "none", id: 1, version: "review", phase: "none", snap: noSnap }
  val noFile = { version: "review", status: "none", openAtInsert: true, upload: "pending", allowedAtPublish: true }

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
  def liveOthers(version: str, id: int): int =
    IDS.filter(i => i != id and w.files.get(i).status == "published" and w.files.get(i).version == version).size()

  def liveOf(version: str): int =
    IDS.filter(i => w.files.get(i).status == "published" and w.files.get(i).version == version).size()

  def snapOf(id: int): Snap = {
    revoked: w.revoked, withdrawn: w.withdrawn, booking: w.booking, balance: w.balance, stage: w.stage,
    fileStatus: w.files.get(id).status, upload: w.ups.get(id), object: w.obj.get(id),
    othersLive: liveOthers(w.files.get(id).version, id), finalLive: liveOf("final"),
  }

  // The compare-and-set parts, each as the code has them: true while the fact is still what the read saw.
  def sameAccess(s: Snap): bool = w.revoked == s.revoked and w.withdrawn == s.withdrawn
  def samePayments(s: Snap): bool = w.booking == s.booking and w.balance == s.balance

  // A request is between its read and its write: the facts it read can change now.
  def inflightPhase(p: str): bool = or {
    p == "write", p == "createMultipart", p == "row", p == "completeR2", p == "fileRow", p == "abortR2",
  }

  // ---- Start ------------------------------------------------------------------------------------------------------
  action init = {
    nondet scenario = Set("fresh", "review", "final", "reviewPlus", "finalPlus", "finalBoth").oneOf()
    all {
      w' = {
        files: IDS.mapBy(i =>
          if (i == 1 and (scenario == "review" or scenario == "reviewPlus")) { ...noFile, version: "review", status: "published" }
          else if (i == 1 and (scenario == "final" or scenario == "finalPlus" or scenario == "finalBoth")) { ...noFile, version: "final", status: "published" }
          else if (i == 2 and scenario == "finalBoth") { ...noFile, version: "final", status: "published" }
          else if (i == 2 and scenario == "reviewPlus") { ...noFile, version: "review", status: "uploaded" }
          else if (i == 2 and scenario == "finalPlus") { ...noFile, version: "final", status: "uploaded" }
          else noFile),
        ups: IDS.mapBy(i => "none"),
        upVersion: IDS.mapBy(i => "review"),
        upOpen: IDS.mapBy(i => true),
        mp: IDS.mapBy(i => false),
        obj: IDS.mapBy(i => scenario != "fresh" and (i == 1 or scenario == "reviewPlus" or scenario == "finalPlus" or scenario == "finalBoth")),
        revoked: false, withdrawn: false, booking: true,
        balance: scenario == "final" or scenario == "finalPlus" or scenario == "finalBoth",
        stage: if (scenario == "review" or scenario == "reviewPlus") "review_ready"
               else if (scenario == "final" or scenario == "finalPlus" or scenario == "finalBoth") "final_files_ready" else "in_progress",
        completedPaid: true,
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
      else if (h.kind == "revoke") (s.fileStatus == "uploaded" or s.fileStatus == "published")
      else s.stage == "final_files_ready" and s.finalLive > 0 and s.booking and s.balance and not(s.revoked) and not(s.withdrawn)
    all {
      w' = w,
      runs' = runs.set(r, { ...h, snap: s, version: version, phase: if (go) (if (h.kind == "upload") "createMultipart" else "write") else "refused" }),
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
    val others = liveOthers(rev, h.id)
    val ok =
      if (h.kind == "publish") and {
        fresh,
        MUTANT == "publish-no-access" or sameAccess(s),
        MUTANT == "publish-no-payment" or samePayments(s),
        MUTANT == "publish-no-stage" or w.stage == s.stage,
      }
      else if (h.kind == "revoke") and {
        fresh, w.stage == s.stage,
        MUTANT == "revoke-no-others" or others == s.othersLive,
      }
      else and {
        // The stage guard is also what protects the published final: a revoke of the last final resets the stage in its own batch.
        MUTANT == "complete-no-stage" or w.stage == s.stage,
        MUTANT == "complete-no-payment" or samePayments(s),
        sameAccess(s),
      }
    if (not(ok)) all { w' = w, runs' = runs.set(r, { ...h, phase: "conflict" }) }
    else if (h.kind == "publish") all {
      w' = { ...w,
        files: IDS.mapBy(i =>
          if (i == h.id) { ...f, status: "published",
            allowedAtPublish: canPublish(rev, w.revoked, w.withdrawn, w.booking, w.balance, w.stage) }
          else if (rev == "review" and MUTANT != "no-supersede" and w.files.get(i).version == "review" and w.files.get(i).status == "published")
            { ...w.files.get(i), status: "revoked" }
          else w.files.get(i)),
        stage: if (rev == "review") "review_ready" else "final_files_ready" },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else if (h.kind == "revoke") all {
      // The rule decided from the read: without another published file of its version the project returns to in_progress (also a completed project losing its only final).
      w' = { ...w,
        files: w.files.set(h.id, { ...f, status: "revoked" }),
        stage: if (s.othersLive == 0 and ((rev == "review" and w.stage == "review_ready") or (rev == "final" and (w.stage == "final_files_ready" or w.stage == "complete")))) "in_progress"
               else w.stage },
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
    else all {
      w' = { ...w, stage: "complete", completedPaid: w.booking and w.balance },
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
    val s = h.snap
    val ok = and {
      w.ups.get(h.id) == "none",
      MUTANT == "start-no-access" or sameAccess(s),
      samePayments(s),
      w.stage == s.stage,
    }
    if (ok) all {
      w' = { ...w,
        ups: w.ups.set(h.id, "pending"),
        upVersion: w.upVersion.set(h.id, h.version),
        upOpen: w.upOpen.set(h.id, canUpload(h.version, w.revoked, w.withdrawn, w.booking, w.stage)) },
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
    val s = h.snap
    val v = w.upVersion.get(h.id)
    val ok = and {
      w.files.get(h.id).status == "none",
      MUTANT == "insert-no-state" or w.ups.get(h.id) == "pending",
      MUTANT == "insert-no-access" or sameAccess(s),
      samePayments(s),
      w.stage == s.stage,
    }
    if (ok) all {
      w' = { ...w,
        files: w.files.set(h.id, {
          version: v, status: "uploaded",
          openAtInsert: canUpload(v, w.revoked, w.withdrawn, w.booking, w.stage),
          upload: w.ups.get(h.id), allowedAtPublish: true }),
        ups: w.ups.set(h.id, "none") },
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
      w' = if (w.files.get(h.id).status == "none") { ...w, ups: w.ups.set(h.id, "none") } else w,
      runs' = runs.set(r, { ...h, phase: "done" }),
    }
  }

  // ---- The world: access closes, the request is withdrawn, a payment is voided ------------------------------------
  // These happen while a request is between its read and its write (see `inflightPhase`); so a step takes one only then.
  val inflight = RUNS.exists(r => inflightPhase(runs.get(r).phase))

  action ownerRevokes = all { inflight, not(w.revoked), w' = { ...w, revoked: true }, runs' = runs }
  action requestWithdrawn = all { inflight, not(w.withdrawn), w' = { ...w, withdrawn: true }, runs' = runs }
  action bookingVoided = all { inflight, w.booking, w' = { ...w, booking: false }, runs' = runs }
  action balanceVoided = all { inflight, w.balance, w' = { ...w, balance: false }, runs' = runs }

  action step = any {
    begin, read, write, createMultipart, row, completeRead, completeR2, fileRow, abortCas, abortR2, abortRow,
    ownerRevokes, requestWithdrawn, bookingVoided, balanceVoided,
  }

  // ---- Properties -------------------------------------------------------------------------------------------------
  // 1. A file row is written only while the project's access is open and its payment and stage allow an upload.
  val filesOnlyForOpenProject = IDS.forall(i => w.files.get(i).status == "none" or w.files.get(i).openAtInsert)

  // 2. An upload row is written only while the project's access is open and its payment and stage allow an upload.
  val uploadsOnlyForOpenProject = IDS.forall(i => w.ups.get(i) == "none" or w.upOpen.get(i))

  // 3. A file is published only while the project's access is open, the booking (and for a final the balance) is paid, and the stage allows it.
  val publishedOnlyWhenAllowed = IDS.forall(i => w.files.get(i).allowedAtPublish)

  // 4. At most one review file is published at a time.
  val oneLiveReview = liveOf("review") <= 1

  // 5. A stage that needs a published file has one: review_ready a published review; final_files_ready and complete a published final.
  val readyStagesHaveFiles = and {
    w.stage != "review_ready" or liveOf("review") > 0,
    (w.stage != "final_files_ready" and w.stage != "complete") or liveOf("final") > 0,
  }

  // 6. A project is completed only while the booking and the balance are paid.
  val completedOnlyWhenPaid = w.stage != "complete" or w.completedPaid

  // 7. A file row never comes from an upload that was being discarded.
  val noFileFromDiscarded = IDS.forall(i => w.files.get(i).status == "none" or w.files.get(i).upload != "discarding")

  // 8. A file that is uploaded or published has its object in R2.
  val fileHasObject = IDS.forall(i => (w.files.get(i).status != "uploaded" and w.files.get(i).status != "published") or w.obj.get(i))

  val allProperties = and {
    filesOnlyForOpenProject, uploadsOnlyForOpenProject, publishedOnlyWhenAllowed, oneLiveReview,
    readyStagesHaveFiles, completedOnlyWhenPaid, noFileFromDiscarded, fileHasObject,
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
module projectFilesRevokeNoOthers { import audioProjectFiles(MUTANT = "revoke-no-others").* }
module projectFilesCompleteNoStage { import audioProjectFiles(MUTANT = "complete-no-stage").* }
module projectFilesCompleteNoPayment { import audioProjectFiles(MUTANT = "complete-no-payment").* }
