// Quint model of one software brief submitted twice at once (POST /api/software-inquiry): the form retries, or two tabs send
// the same submission id, to a Worker that serves several requests at the same time. Written for the conversion of the
// public intake routes.
// Code modelled:
//   look up, count, store: src/server/flows/software-inquiry.ts (`submitInquiry` through `decideAndSave`: look up the brief
//                        stored under the submission id, count the address against its request limit once, insert the
//                        brief; when the insert meets the unique index, look up again, three tries in all)
//   the decisions:       src/server/rules/software-inquiry.ts (a brief already stored is not stored again, and is not
//                        counted; it is answered to the address that sent it, and refused to any other)
//   the guard:           the unique index on owner_requests.submission_id (db/music.sql)
//   the allowance:       the counter in KV (src/server/flows/rate-limit.ts): a request that stored nothing gives it back
//   the client's copy:   src/lib/software-brief-copy.ts, sent once for the request this delivery stored
// What is left out, on purpose: the attempt limit and the captcha (they come before the look-up and decide nothing about
// the brief), the owner notice (best effort, sent once for a stored request), and the owner's alert on a lost insert (the
// insert failing for another reason than the index is a defect this model does not have).
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module softwareInquiry {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-index"       the submission id is not unique (the unique index is gone)
  //   "no-retry"       an insert that meets the index answers a failure at once, without looking up again
  //   "keep-allowance" the loser of a race, answered with the other brief, keeps its count against the limit
  //   "any-address"    a brief stored under the id is answered to any address, not only the one that sent it
  //   "copy-for-all"   the client's copy goes out for every delivery that is answered with a stored brief
  const MUTANT: str

  // A stored brief: its submission id, the address that sent it, and the delivery that stored it.
  type Row = { sid: int, email: int, by: int }
  // One delivery: phase "none" (not started), "idle" (about to look up), "found" (the look-up said nothing is stored, about to
  // count), "counted" (about to insert), "stored" (inserted, the client's copy is next) or "done"; what it was looking for
  // (sid, email); whether its address was counted against the limit (charged); how many inserts met the index; and how it
  // ended: "stored" (it stored the brief), "duplicate" (answered with the stored brief), "clash" (another address's brief
  // holds the id), "failed" (told the brief was not stored).
  type Run = { phase: str, sid: int, email: int, charged: bool, tries: int, outcome: str }

  var rows: Set[Row]
  var runs: int -> Run
  // The client copies sent: the delivery that sent each, for the brief it was sent for.
  var copies: Set[{ sid: int, by: int }]

  val RUNS = 1.to(3)
  val SIDS = 1.to(2)
  val EMAILS = 1.to(2)
  val TRIES = 3

  val idle = { phase: "none", sid: 0, email: 0, charged: false, tries: 0, outcome: "none" }

  action init = all {
    rows' = Set(),
    runs' = RUNS.mapBy(r => idle),
    copies' = Set(),
  }

  // A form submission reaches a handler. The same id may reach several handlers, from the same address or another.
  action deliver = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet sid = SIDS.oneOf()
    nondet email = EMAILS.oneOf()
    all {
      rows' = rows,
      runs' = runs.set(r, { ...idle, phase: "idle", sid: sid, email: email }),
      copies' = copies,
    }
  }

  // The look-up: ONE statement, one step. A brief found is answered at once (no count, nothing stored); on a later pass the
  // delivery that was counted gives its count back, and the answer is the stored brief. Nothing found goes on to the count.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val stored = rows.filter(x => x.sid == h.sid)
    val sent = stored.exists(x => x.email == h.email or MUTANT == "any-address")
    val gives = h.charged and MUTANT != "keep-allowance"
    all {
      rows' = rows,
      runs' = runs.set(r,
        if (stored.size() == 0) { ...h, phase: "found" }
        else { ...h, phase: "done", charged: if (gives) false else h.charged, outcome: if (sent) "duplicate" else "clash" }),
      copies' = if (stored.size() > 0 and MUTANT == "copy-for-all") copies.union(Set({ sid: h.sid, by: r })) else copies,
    }
  }

  // The count against the request limit: a separate step (it is in KV, not the database), made once however many passes.
  action count = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    all {
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "counted", charged: true }),
      copies' = copies,
    }
  }

  // The insert, guarded by the unique index on the submission id as the table is now. When the index refuses it, the delivery
  // looks up again (the same pass counts, never a second charge), three tries in all.
  action insert = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "counted").oneOf()
    val h = runs.get(r)
    val taken = MUTANT != "no-index" and rows.exists(x => x.sid == h.sid)
    val keepsTrying = taken and MUTANT != "no-retry" and h.tries + 1 < TRIES
    val lost = taken and not(keepsTrying)
    all {
      rows' = if (taken) rows else rows.union(Set({ sid: h.sid, email: h.email, by: r })),
      runs' = runs.set(r,
        if (not(taken)) { ...h, phase: "stored", outcome: "stored" }
        else if (keepsTrying) { ...h, phase: "idle", tries: h.tries + 1 }
        else { ...h, phase: "done", tries: h.tries + 1, charged: false, outcome: "failed" }),
      copies' = copies,
    }
  }

  // The client's copy, sent after the brief was stored, by the delivery that stored it.
  action sendCopy = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "stored").oneOf()
    val h = runs.get(r)
    all {
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "done" }),
      copies' = copies.union(Set({ sid: h.sid, by: r })),
    }
  }

  action step = any { deliver, lookup, count, insert, sendCopy }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. One stored brief per submission id.
  val oneBriefPerId = rows.forall(a => rows.forall(b => a.sid == b.sid implies a.by == b.by))

  // 2. One client copy per submission id, sent by the delivery that stored the brief.
  val oneCopyPerId = copies.forall(c => rows.exists(x => x.sid == c.sid and x.by == c.by)) and
    copies.forall(a => copies.forall(b => a.sid == b.sid implies a.by == b.by))

  // 3. The loser of a race is answered with the other brief, never told its brief was lost, while a brief for its id is stored.
  val loserNeverFailed = runs.keys().forall(r => runs.get(r).outcome != "failed" or not(rows.exists(x => x.sid == runs.get(r).sid)))

  // 4. A delivery answered with a stored brief (it stored nothing) holds no count against the limit.
  val allowanceReturned = runs.keys().forall(r =>
    (runs.get(r).outcome != "duplicate" and runs.get(r).outcome != "clash" and runs.get(r).outcome != "failed") or not(runs.get(r).charged))

  // 5. A stored brief is answered only to the address that sent it.
  val strangerNeverSeesBrief = runs.keys().forall(r =>
    runs.get(r).outcome != "duplicate" or rows.exists(x => x.sid == runs.get(r).sid and x.email == runs.get(r).email))

  val allProperties = and {
    oneBriefPerId, oneCopyPerId, loserNeverFailed, allowanceReturned, strangerNeverSeesBrief,
  }

  // Reachability witness, for a hand h with the negated invariant: two deliveries took the same id at once, one stored it
  // and the other, which had been counted, was answered with the stored brief and gave its count back.
  val raced = runs.keys().exists(a => runs.keys().exists(b => a != b and runs.get(a).outcome == "stored" and runs.get(b).outcome == "duplicate" and runs.get(b).tries > 0 and runs.get(a).sid == runs.get(b).sid))
  val neverRaced = not(raced)
}

module inquiry { import softwareInquiry(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module inquiryNoIndex { import softwareInquiry(MUTANT = "no-index").* }
module inquiryNoRetry { import softwareInquiry(MUTANT = "no-retry").* }
module inquiryKeepAllowance { import softwareInquiry(MUTANT = "keep-allowance").* }
module inquiryAnyAddress { import softwareInquiry(MUTANT = "any-address").* }
module inquiryCopyForAll { import softwareInquiry(MUTANT = "copy-for-all").* }
