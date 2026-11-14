// Quint model of one playthrough's playback events (POST /api/music-event) delivered by a player that retries, to a Worker
// that serves several requests at once. Written for the conversion of the public music routes (PR 10 of the Effect stack).
// Code modelled:
//   read, judge, store:  src/server/flows/music-event.ts (`recordPlayback` through `decideAndSave`: read the stored event
//                        with this id, and the playthrough's last event; judge by `judgePlayback`; insert; when the
//                        insert meets a unique constraint, read and judge again, three tries in all)
//   the judgement:       src/server/rules/playback.ts (the same event again is nothing to do; another event reusing the
//                        id, or out of sequence, is refused; seconds never fall)
//   the guards:          the two unique constraints of music_playback_events (db/music.sql): the event id (primary key)
//                        and (session_id, playthrough_id, sequence)
// What is left out, on purpose: the clock rule (seconds against the server's time) and the listen and completion rules:
// they are pure functions of the event and the facts read (tests/rules/playback.test.ts), and no other request can change
// what they read except through the last event, which this model covers. The rate limits and the campaign tag do not
// change what is stored in the playthrough.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module musicPlayback {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-id-key"        the event id is not unique (the primary key is gone)
  //   "no-place-key"     the place in the playthrough is not unique (UNIQUE(session_id, playthrough_id, sequence) gone)
  //   "no-sequence-rule" the rule accepts any sequence number whose place is free, not only the next
  //   "no-seconds-rule"  the rule accepts seconds that go backwards
  //   "no-retry"         an insert that meets a unique constraint answers 409 at once, without reading again
  //   "split-read"       the stored event with this id and the playthrough's last event are read in two separate steps,
  //                      not as one snapshot (the code before the fix to PR 272: two D1 calls)
  const MUTANT: str

  // A stored event: its id, its playthrough (pt), its place in it (sequence), seconds so far, and the delivery that stored it (so two
  // rows are two writes, even when they say the same).
  type Row = { id: int, pt: int, seq: int, acc: int, by: int }
  type Ev = { id: int, pt: int, seq: int, acc: int }
  // One delivery of an event to a request handler: phase "none" (not started), "idle" (about to read), "dupRead" (only in the
  // split-read mutant: the id has been read, the last event has not), "read" (read, about to judge and store) or "done";
  // what it read (sawSame: this very event was stored when it did its last read, at any place in the playthrough); how many inserts have met a constraint; and how it ended.
  type Run = {
    phase: str, ev: Ev, dupSame: bool, dupOther: bool, sawSame: bool, lastSeq: int, lastAcc: int, tries: int, outcome: str,
  }

  var rows: Set[Row]
  var runs: int -> Run
  // Ghost: a delivery of an event ended as a refusal or a conflict although it had read its own event as already stored,
  // or the very same event (id and place) was stored when its insert met a constraint for the last time.
  var conflictedSame: bool

  val RUNS = 1.to(4)
  val IDS = 1.to(3)
  val PTS = 1.to(2)
  val SEQS = 1.to(3)
  val ACCS = 0.to(1)
  val TRIES = 3

  val idle = { phase: "none", ev: { id: 0, pt: 0, seq: 0, acc: 0 }, dupSame: false, dupOther: false, sawSame: false, lastSeq: 0, lastAcc: 0, tries: 0, outcome: "none" }

  action init = all {
    rows' = Set(),
    runs' = RUNS.mapBy(r => idle),
    conflictedSame' = false,
  }

  // A player's event reaches a handler. The same event may reach several handlers (a retry, or a duplicate in flight), and
  // an id may be reused with another place or other seconds.
  action deliver = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet id = IDS.oneOf()
    nondet pt = PTS.oneOf()
    nondet seq = SEQS.oneOf()
    nondet acc = ACCS.oneOf()
    all {
      rows' = rows,
      runs' = runs.set(r, { ...idle, phase: "idle", ev: { id: id, pt: pt, seq: seq, acc: acc } }),
      conflictedSame' = conflictedSame,
    }
  }

  // The reads: the stored event with this id, and the playthrough's last event, as ONE step (one D1 batch, one snapshot).
  // Another handler may store between this and the same handler's insert, never between the two reads.
  action read = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val mine = rows.filter(x => x.pt == h.ev.pt)
    val last = mine.fold(0, (m, x) => if (x.seq > m) x.seq else m)
    val lastSecs = mine.filter(x => x.seq == last).fold(0, (m, x) => if (x.acc > m) x.acc else m)
    val same = rows.exists(x => x.id == h.ev.id and x.pt == h.ev.pt and x.seq == h.ev.seq)
    val other = rows.exists(x => x.id == h.ev.id and (x.pt != h.ev.pt or x.seq != h.ev.seq))
    // This very event (id and place) is stored now, wherever it sits in the playthrough, not only as its newest row.
    val sawOwn = rows.exists(x => x.id == h.ev.id and x.pt == h.ev.pt and x.seq == h.ev.seq)
    all {
      MUTANT != "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "read", dupSame: same, dupOther: other, sawSame: sawOwn, lastSeq: last, lastAcc: lastSecs }),
      conflictedSame' = conflictedSame,
    }
  }

  // The split-read mutant: the id is read in one step ...
  action readDuplicate = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val same = rows.exists(x => x.id == h.ev.id and x.pt == h.ev.pt and x.seq == h.ev.seq)
    val other = rows.exists(x => x.id == h.ev.id and (x.pt != h.ev.pt or x.seq != h.ev.seq))
    all {
      MUTANT == "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "dupRead", dupSame: same, dupOther: other }),
      conflictedSame' = conflictedSame,
    }
  }

  // ... and the last event in a later one, after another handler may have stored this very event.
  action readLast = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "dupRead").oneOf()
    val h = runs.get(r)
    val mine = rows.filter(x => x.pt == h.ev.pt)
    val last = mine.fold(0, (m, x) => if (x.seq > m) x.seq else m)
    val lastSecs = mine.filter(x => x.seq == last).fold(0, (m, x) => if (x.acc > m) x.acc else m)
    // This very event (id and place) is stored now, wherever it sits in the playthrough, not only as its newest row.
    val sawOwn = rows.exists(x => x.id == h.ev.id and x.pt == h.ev.pt and x.seq == h.ev.seq)
    all {
      MUTANT == "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "read", sawSame: sawOwn, lastSeq: last, lastAcc: lastSecs }),
      conflictedSame' = conflictedSame,
    }
  }

  // The judgement, on what was read: nothing to do, a refusal, or an insert, which the two unique constraints may refuse.
  pure def ruleAllows(h: Run): bool =
    if (h.lastSeq == 0) h.ev.seq == 1 and h.ev.acc == 0
    else (h.ev.seq == h.lastSeq + 1 or MUTANT == "no-sequence-rule") and (h.ev.acc >= h.lastAcc or MUTANT == "no-seconds-rule")

  action judgeAndStore = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val ev = h.ev
    val idTaken = MUTANT != "no-id-key" and rows.exists(x => x.id == ev.id)
    val placeTaken = MUTANT != "no-place-key" and rows.exists(x => x.pt == ev.pt and x.seq == ev.seq)
    val sameStored = rows.exists(x => x.id == ev.id and x.pt == ev.pt and x.seq == ev.seq)
    val settled = h.dupSame or h.dupOther or not(ruleAllows(h))
    val inserts = not(settled) and not(idTaken) and not(placeTaken)
    val guardFired = not(settled) and (idTaken or placeTaken)
    // The guard fired: the facts changed since they were read. Read and judge again, up to three tries in all.
    val outcome = if (h.dupSame) "duplicate" else if (settled) "refused" else if (inserts) "stored" else "conflict"
    val keepsTrying = guardFired and MUTANT != "no-retry" and h.tries + 1 < TRIES
    val after = if (keepsTrying) { ...h, phase: "idle", tries: h.tries + 1 }
               else { ...h, phase: "done", tries: if (guardFired) h.tries + 1 else h.tries, outcome: outcome }
    all {
      rows' = if (inserts) rows.union(Set({ id: ev.id, pt: ev.pt, seq: ev.seq, acc: ev.acc, by: r })) else rows,
      runs' = runs.set(r, after),
      // Ghost: set from the real outcome, never from the mutant: the delivery ends as a conflict (it will not try again)
      // while the very same event is stored.
      conflictedSame' = (conflictedSame or (guardFired and not(keepsTrying) and sameStored) or (outcome == "refused" and h.sawSame)),
    }
  }

  action step = any { deliver, read, readDuplicate, readLast, judgeAndStore }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is.
  action finished = all { rows' = rows, runs' = runs, conflictedSame' = conflictedSame }
  action stepOrEnd = any { step, finished }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. One stored event per event id.
  val oneRowPerId = rows.forall(a => rows.forall(b => a.id == b.id implies a.by == b.by))

  // 2. One stored event per place in a playthrough.
  val oneRowPerPlace = rows.forall(a => rows.forall(b => a.pt == b.pt and a.seq == b.seq implies a.by == b.by))

  // 3. Each playthrough's places are 1, 2, 3 ... with none missing.
  val contiguousFromOne = rows.forall(r => r.seq == 1 or rows.exists(p => p.pt == r.pt and p.seq == r.seq - 1))

  // 4. Seconds never fall along a playthrough.
  val secondsNeverFall = rows.forall(a => rows.forall(b => a.pt == b.pt and a.seq < b.seq implies a.acc <= b.acc))

  // 5. The same event delivered twice, at once, is never answered as a refusal or a conflict: a delivery that read its own
  //    event as stored, or whose insert meets it, answers duplicate (the loser reads again and finds it).
  val sameEventNeverConflicts = not(conflictedSame)

  val allProperties = and {
    oneRowPerId, oneRowPerPlace, contiguousFromOne, secondsNeverFall, sameEventNeverConflicts,
  }

  // Reachability witness, for a hand h with the negated invariant: two handlers took the same event at once, and both
  // ended: one stored it and the other answered duplicate.
  val raced = runs.keys().exists(a => runs.keys().exists(b => a != b and runs.get(a).outcome == "stored" and runs.get(b).outcome == "duplicate" and runs.get(a).ev == runs.get(b).ev))
  val neverRaced = not(raced)
}

module music { import musicPlayback(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module musicNoIdKey { import musicPlayback(MUTANT = "no-id-key").* }
module musicNoPlaceKey { import musicPlayback(MUTANT = "no-place-key").* }
module musicNoSequenceRule { import musicPlayback(MUTANT = "no-sequence-rule").* }
module musicNoSecondsRule { import musicPlayback(MUTANT = "no-seconds-rule").* }
module musicNoRetry { import musicPlayback(MUTANT = "no-retry").* }
module musicSplitRead { import musicPlayback(MUTANT = "split-read").* }
