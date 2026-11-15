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
//   the allowance:       the counter in KV, one key per address (src/server/flows/rate-limit.ts): present means the address
//                        already sent a brief in the window and the next one is refused; the loser of a race for the same
//                        submission id answers with the stored brief and keeps the allowance it spent, so the key is
//                        never deleted by a delivery that finds a brief stored
//   the client's copy:   src/lib/software-brief-copy.ts, sent once for the request this delivery stored
// Because a delivery that finds its submission already stored never deletes the key, a stored brief keeps its address's key
// whatever the deliveries from one address do: `keptForStored` holds without an exception. The mutant "loser-gives-back" is the
// earlier behaviour (the loser deleted the key), and breaks `loserKeepsAllowance`.
// What is left out, on purpose: the attempt limit and the captcha (they come before the look-up and decide nothing about
// the brief), the owner notice (best effort, sent once for a stored request), and the owner's alert on a lost insert, and the key
// that a failed insert (the database failing, not the index) gives back: the insert failing for another reason than the index is
// a defect this model does not have.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module softwareInquiry {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-index"       the submission id is not unique (the unique index is gone)
  //   "no-retry"       an insert that meets the index answers a failure at once, without looking up again
  //   "loser-gives-back" the loser of a race, answered with the stored brief, deletes its address's key (the earlier behaviour)
  //   "any-address"    a brief stored under the id is answered to any address, not only the one that sent it
  //   "copy-for-all"   the client's copy goes out for every delivery that is answered with a stored brief
  //   "retry-gives-back" a plain retry (a brief already stored, nothing counted) deletes its address's key
  //   "never-counts"   the count never sets the key, so a stored brief leaves nothing against its address
  const MUTANT: str

  // A stored brief: its submission id, the email that sent it, and the delivery that stored it.
  type Row = { sid: int, email: int, by: int }
  // One delivery: phase "none" (not started), "idle" (about to look up), "found" (the look-up said nothing is stored, about to
  // read the key), "read" (the key was read, about to write it), "counted" (its address's key is set, about to insert), "stored" (inserted, the client's copy is next) or "done";
  // what it was looking for (sid), who sent it (email) and from which address (ip); how many inserts met the index; and how it
  // read the key as unset (passed: it may set the key) or set; ended: "stored" (it stored the brief), "duplicate" (answered with the stored brief), "clash" (another email's brief
  // holds the id), "limited" (its address already sent a brief in the window: 429), "failed" (told the brief was not stored).
  type Run = { phase: str, sid: int, email: int, ip: int, tries: int, passed: bool, outcome: str }

  var rows: Set[Row]
  var runs: int -> Run
  // The addresses whose counter key is set (rl:software:<address>).
  var held: Set[int]
  // The client copies sent: the delivery that sent each, for the brief it was sent for.
  var copies: Set[{ sid: int, by: int }]

  val RUNS = 1.to(3)
  val SIDS = 1.to(2)
  val EMAILS = 1.to(2)
  val IPS = 1.to(2)

  val idle = { phase: "none", sid: 0, email: 0, ip: 0, tries: 0, passed: false, outcome: "none" }

  action init = all {
    rows' = Set(),
    runs' = RUNS.mapBy(r => idle),
    held' = Set(),
    copies' = Set(),
  }

  // A form submission reaches a handler. The same id may reach several handlers, from the same address or another.
  action deliver = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet sid = SIDS.oneOf()
    nondet email = EMAILS.oneOf()
    nondet ip = IPS.oneOf()
    all {
      rows' = rows,
      runs' = runs.set(r, { ...idle, phase: "idle", sid: sid, email: email, ip: ip }),
      held' = held,
      copies' = copies,
    }
  }

  // The look-up: ONE statement, one step. A brief found is answered at once (nothing stored); a delivery that had been counted
  // (it came back from a lost insert) deletes its address's key. Nothing found goes on to the key, but on the pass after a
  // lost insert it ends the try: the brief is lost (no second insert), the key is given back and the visitor is told so.
  action lookup = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val stored = rows.filter(x => x.sid == h.sid)
    val sent = stored.exists(x => x.email == h.email or MUTANT == "any-address")
    val counted = h.tries > 0
    val gives = (counted and MUTANT == "loser-gives-back") or MUTANT == "retry-gives-back"
    val lostBrief = stored.size() == 0 and counted
    all {
      rows' = rows,
      runs' = runs.set(r,
        if (lostBrief) { ...h, phase: "done", outcome: "failed" }
        else if (stored.size() == 0) { ...h, phase: "found" }
        else { ...h, phase: "done", outcome: if (sent) "duplicate" else "clash" }),
      held' = if ((stored.size() > 0 and gives) or lostBrief) held.exclude(Set(h.ip)) else held,
      copies' = if (stored.size() > 0 and MUTANT == "copy-for-all") copies.union(Set({ sid: h.sid, by: r })) else copies,
    }
  }

  // The count against the request limit, made once however many passes, and in two calls as the code makes them (a KV get and
  // then a put): the key is read in one step, and written in a later one, after another delivery may have written it.
  action readKey = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "found").oneOf()
    val h = runs.get(r)
    all {
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "read", passed: not(held.contains(h.ip)) }),
      held' = held,
      copies' = copies,
    }
  }

  // A delivery that read the key as set is refused (429); one that read it unset sets it (a key already set stays set).
  action writeKey = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    all {
      rows' = rows,
      runs' = runs.set(r, if (h.passed) { ...h, phase: "counted" } else { ...h, phase: "done", outcome: "limited" }),
      held' = if (h.passed and MUTANT != "never-counts") held.union(Set(h.ip)) else held,
      copies' = copies,
    }
  }

  // The insert, guarded by the unique index on the submission id as the table is now. When the index refuses it, the delivery
  // looks up again (the key stays set, never a second count); that look-up either finds the other brief or ends the try, so
  // the insert is made at most once per delivery that meets the index.
  action insert = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "counted").oneOf()
    val h = runs.get(r)
    val taken = MUTANT != "no-index" and rows.exists(x => x.sid == h.sid)
    val keepsTrying = taken and MUTANT != "no-retry"
    val lost = taken and not(keepsTrying)
    all {
      rows' = if (taken) rows else rows.union(Set({ sid: h.sid, email: h.email, by: r })),
      runs' = runs.set(r,
        if (not(taken)) { ...h, phase: "stored", outcome: "stored" }
        else if (keepsTrying) { ...h, phase: "idle", tries: h.tries + 1 }
        else { ...h, phase: "done", tries: h.tries + 1, outcome: "failed" }),
      held' = if (lost) held.exclude(Set(h.ip)) else held,
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
      held' = held,
      copies' = copies.union(Set({ sid: h.sid, by: r })),
    }
  }

  action step = any { deliver, lookup, readKey, writeKey, insert, sendCopy }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. One stored brief per submission id.
  val oneBriefPerId = rows.forall(a => rows.forall(b => a.sid == b.sid implies a.by == b.by))

  // 2. One client copy per submission id, sent by the delivery that stored the brief.
  val oneCopyPerId = copies.forall(c => rows.exists(x => x.sid == c.sid and x.by == c.by)) and
    copies.forall(a => copies.forall(b => a.sid == b.sid implies a.by == b.by))

  // 3. The loser of a race is answered with the other brief, never told its brief was lost, while a brief for its id is stored.
  val loserNeverFailed = runs.keys().forall(r => runs.get(r).outcome != "failed" or not(rows.exists(x => x.sid == runs.get(r).sid)))

  // 4. A delivery that counted and was then answered with the stored brief keeps the allowance it spent: its address's key is
  //    still set. (The address-wide key is shared with every delivery from that address.)
  val loserKeepsAllowance = runs.keys().forall(r =>
    not(runs.get(r).outcome == "duplicate" and runs.get(r).tries > 0) or held.contains(runs.get(r).ip))

  // 5. A stored brief keeps its address's counter key.
  val keptForStored = rows.forall(x => held.contains(runs.get(x.by).ip))

  // 6. A stored brief is answered only to the email that sent it.
  val strangerNeverSeesBrief = runs.keys().forall(r =>
    runs.get(r).outcome != "duplicate" or rows.exists(x => x.sid == runs.get(r).sid and x.email == runs.get(r).email))

  val allProperties = and {
    oneBriefPerId, oneCopyPerId, loserNeverFailed, loserKeepsAllowance, keptForStored, strangerNeverSeesBrief,
  }

  // Reachability witness, for a hand h with the negated invariant: two deliveries took the same id at once from different
  // addresses, one stored it and the other, which had been counted, was answered with the stored brief.
  val raced = runs.keys().exists(a => runs.keys().exists(b => a != b and runs.get(a).outcome == "stored" and runs.get(b).outcome == "duplicate" and runs.get(b).tries > 0 and runs.get(a).sid == runs.get(b).sid))
  val neverRaced = not(raced)
}

module inquiry { import softwareInquiry(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module inquiryNoIndex { import softwareInquiry(MUTANT = "no-index").* }
module inquiryNoRetry { import softwareInquiry(MUTANT = "no-retry").* }
module inquiryLoserGivesBack { import softwareInquiry(MUTANT = "loser-gives-back").* }
module inquiryAnyAddress { import softwareInquiry(MUTANT = "any-address").* }
module inquiryRetryGivesBack { import softwareInquiry(MUTANT = "retry-gives-back").* }
module inquiryNeverCounts { import softwareInquiry(MUTANT = "never-counts").* }
module inquiryCopyForAll { import softwareInquiry(MUTANT = "copy-for-all").* }
