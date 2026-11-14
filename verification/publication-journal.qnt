// Quint model of one project's publication journal (POST /api/work-feed and the publish_project_update tool) when several
// deliveries of envelopes reach the Worker at once. Written for the conversion of the publication routes (PR 12 of the
// Effect stack). Code modelled:
//   read, judge, store:  src/server/flows/publication-commit.ts (`commit` through `decideAndSave`: read the latest
//                        revision, the event stored under this event id and the operations stored for this entry in ONE
//                        batch; judge by `commitPublication`; insert; when the insert meets a unique constraint, read and
//                        judge again, three tries in all)
//   the judgement:       src/server/rules/publication-commit.ts (a stored event with other content is a conflict; a
//                        withdrawn entry takes nothing more; the expected revision must be the latest; a publish needs a
//                        new entry and a correction an entry that has events)
//   the guards:          the two unique constraints of publication_events (migrations/publication/0001_publication_journal.sql):
//                        the primary key (project, event id) and UNIQUE (project, revision). Every accepted write takes the
//                        next revision, so the revision key is the compare-and-set for every other fact the rule read.
// What is left out, on purpose: the content of an entry (the erasure of a withdrawn entry's text is one UPDATE in the same
// batch as the insert, and changes no row this model keeps), the hash (content equality is the whole envelope below), the
// origin (backfill changes the feed, not the journal's rules), and the allowlist and token checks, which run before a delivery
// reaches the journal. The event id key is also a guard, but with the revision key and the rule it adds nothing a property
// here could see, so no property names it.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module publicationJournal {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-revision-key"    the revision is not unique (UNIQUE (project_id, revision) gone)
  //   "any-revision"       the rule accepts any expected revision, not only the latest (the stored revision is still expected + 1)
  //   "no-withdrawn-rule"  the rule does not refuse events for a withdrawn entry
  //   "no-new-entry-rule"  the rule accepts a publish of an entry that already has events
  //   "no-target-rule"     the rule accepts a correction of an entry that has no events
  //   "no-retry"           an insert that meets a unique constraint answers conflict at once, without reading again
  //   "split-read"         the stored event with this id and the latest revision are read in separate steps, not one snapshot
  const MUTANT: str

  // A delivered envelope: its event id, its entry, what it does, and the revision its sender expected. Equal envelopes are
  // equal content (the stored hash covers all of it).
  type Ev = { id: int, entry: int, op: str, exp: int }
  // A stored event: the envelope, the revision it took, and the delivery that stored it (two rows are two writes).
  type Row = { id: int, entry: int, op: str, exp: int, rev: int, by: int }
  // One delivery: phase "none" (not started), "idle" (about to read), "idRead" (only in the split-read mutant: the event id and
  // the entry were read, the latest revision was not), "read" (read, about to judge and store) or "done"; what it read; how many
  // inserts have met a constraint; and how it ended.
  type Run = {
    phase: str, ev: Ev, same: str, hasEntry: bool, withdrawn: bool, latest: int, tries: int, outcome: str,
  }

  var rows: Set[Row]
  var runs: int -> Run
  // Ghost: a delivery ended as a conflict although an event with exactly its content is stored (a retry or a duplicate in
  // flight must answer duplicate, or withdrawn, never conflict).
  var conflictedSame: bool

  val RUNS = 1.to(4)
  val IDS = 1.to(2)
  val ENTRIES = 1.to(2)
  val OPS = Set("publish", "correct", "withdraw")
  val EXPS = 0.to(3)
  val TRIES = 3

  val idle = { phase: "none", ev: { id: 0, entry: 0, op: "publish", exp: 0 }, same: "none", hasEntry: false, withdrawn: false, latest: 0, tries: 0, outcome: "none" }

  action init = all {
    rows' = Set(),
    runs' = RUNS.mapBy(r => idle),
    conflictedSame' = false,
  }

  // An envelope reaches a handler. The same envelope may reach several handlers (a retry, or a duplicate in flight), and an
  // event id may be reused with other content.
  action deliver = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet id = IDS.oneOf()
    nondet entry = ENTRIES.oneOf()
    nondet op = OPS.oneOf()
    nondet exp = EXPS.oneOf()
    all {
      rows' = rows,
      runs' = runs.set(r, { ...idle, phase: "idle", ev: { id: id, entry: entry, op: op, exp: exp } }),
      conflictedSame' = conflictedSame,
    }
  }

  pure def latestOf(rs: Set[Row]): int = rs.fold(0, (m, x) => if (x.rev > m) x.rev else m)
  pure def storedSame(rs: Set[Row], e: Ev): bool = rs.exists(x => x.id == e.id and x.entry == e.entry and x.op == e.op and x.exp == e.exp)
  pure def storedOther(rs: Set[Row], e: Ev): bool = rs.exists(x => x.id == e.id and not(x.entry == e.entry and x.op == e.op and x.exp == e.exp))

  // The reads: the latest revision, the event under this event id, and the entry's operations, as ONE step (one D1 batch, one
  // snapshot). Another handler may store between this and the same handler's insert, never between the reads.
  action read = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val mine = rows.filter(x => x.entry == h.ev.entry)
    all {
      MUTANT != "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "read",
        same: if (storedSame(rows, h.ev)) "same" else if (storedOther(rows, h.ev)) "other" else "none",
        hasEntry: mine.size() > 0, withdrawn: mine.exists(x => x.op == "withdraw"), latest: latestOf(rows) }),
      conflictedSame' = conflictedSame,
    }
  }

  // The split-read mutant: the event id and the entry are read in one step ...
  action readIdentity = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idle").oneOf()
    val h = runs.get(r)
    val mine = rows.filter(x => x.entry == h.ev.entry)
    all {
      MUTANT == "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "idRead",
        same: if (storedSame(rows, h.ev)) "same" else if (storedOther(rows, h.ev)) "other" else "none",
        hasEntry: mine.size() > 0, withdrawn: mine.exists(x => x.op == "withdraw") }),
      conflictedSame' = conflictedSame,
    }
  }

  // ... and the latest revision in a later one, after another handler may have stored this very event.
  action readLatest = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "idRead").oneOf()
    val h = runs.get(r)
    all {
      MUTANT == "split-read",
      rows' = rows,
      runs' = runs.set(r, { ...h, phase: "read", latest: latestOf(rows) }),
      conflictedSame' = conflictedSame,
    }
  }

  // The judgement, on what was read: "duplicate" (nothing to do), a refusal ("conflict" or "withdrawn"), or "insert".
  pure def judge(h: Run): str =
    if (h.same == "other") "conflict"
    else if (h.same == "same" and h.ev.op == "withdraw") "duplicate"
    else if (h.same == "same" and not(h.withdrawn)) "duplicate"
    else if (h.withdrawn and MUTANT != "no-withdrawn-rule") "withdrawn"
    else if (h.same == "same") "duplicate"
    else if (h.ev.exp != h.latest and MUTANT != "any-revision") "conflict"
    else if (h.ev.op == "publish" and h.hasEntry and MUTANT != "no-new-entry-rule") "conflict"
    else if (h.ev.op == "correct" and not(h.hasEntry) and MUTANT != "no-target-rule") "conflict"
    else "insert"

  action judgeAndStore = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val ev = h.ev
    val verdict = judge(h)
    val revision = ev.exp + 1
    val revisionTaken = MUTANT != "no-revision-key" and rows.exists(x => x.rev == revision)
    val idTaken = rows.exists(x => x.id == ev.id)
    val guardFired = verdict == "insert" and (revisionTaken or idTaken)
    val inserts = verdict == "insert" and not(guardFired)
    // The guard fired: the facts changed since they were read. Read and judge again, up to three tries in all.
    val keepsTrying = guardFired and MUTANT != "no-retry" and h.tries + 1 < TRIES
    val outcome = if (verdict == "insert") (if (guardFired) "conflict" else "stored") else verdict
    val after = if (keepsTrying) { ...h, phase: "idle", tries: h.tries + 1 }
               else { ...h, phase: "done", tries: if (guardFired) h.tries + 1 else h.tries, outcome: outcome }
    all {
      rows' = if (inserts) rows.union(Set({ id: ev.id, entry: ev.entry, op: ev.op, exp: ev.exp, rev: revision, by: r })) else rows,
      runs' = runs.set(r, after),
      // Ghost: set from the real outcome, never from the mutant: the delivery ends as a conflict while an event with exactly
      // its content is stored.
      conflictedSame' = (conflictedSame or (not(keepsTrying) and outcome == "conflict" and storedSame(rows, ev))),
    }
  }

  action step = any { deliver, read, readIdentity, readLatest, judgeAndStore }

  // For the Apalache check only (`--step stepOrEnd`): a state where nothing else can happen stays as it is.
  action finished = all { rows' = rows, runs' = runs, conflictedSame' = conflictedSame }
  action stepOrEnd = any { step, finished }

  // ---- Properties ---------------------------------------------------------------------------------------------------
  // 1. One stored event per revision.
  val oneRowPerRevision = rows.forall(a => rows.forall(b => a.rev == b.rev implies a.by == b.by))

  // 2. The revisions are 1, 2, 3 ... with none missing.
  val contiguousFromOne = rows.forall(r => r.rev == 1 or rows.exists(p => p.rev == r.rev - 1))

  // 3. A withdrawn entry takes nothing more: no event of the entry is stored after its withdrawal.
  val entryNeverResurrected = rows.forall(w => w.op == "withdraw" implies rows.forall(x => x.entry == w.entry implies x.rev <= w.rev))

  // 4. An entry is published once.
  val onePublishPerEntry = rows.forall(a => rows.forall(b => a.op == "publish" and b.op == "publish" and a.entry == b.entry implies a.rev == b.rev))

  // 5. A correction follows an event of its entry.
  val correctionHasTarget = rows.forall(c => c.op == "correct" implies rows.exists(p => p.entry == c.entry and p.rev < c.rev))

  // 6. An event that is stored is never answered as a conflict when it is delivered again (the loser of a race reads
  //    again and finds it).
  val retryNeverConflicts = not(conflictedSame)

  val allProperties = and {
    oneRowPerRevision, contiguousFromOne, entryNeverResurrected, onePublishPerEntry, correctionHasTarget, retryNeverConflicts,
  }

  // Reachability witness, for a hand h with the negated invariant: two handlers took the same envelope at once, and both
  // ended: one stored it and the other answered duplicate.
  val raced = runs.keys().exists(a => runs.keys().exists(b => a != b and runs.get(a).outcome == "stored" and runs.get(b).outcome == "duplicate" and runs.get(a).ev == runs.get(b).ev))
  val neverRaced = not(raced)
}

module publication { import publicationJournal(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module publicationNoRevisionKey { import publicationJournal(MUTANT = "no-revision-key").* }
module publicationAnyRevision { import publicationJournal(MUTANT = "any-revision").* }
module publicationNoWithdrawnRule { import publicationJournal(MUTANT = "no-withdrawn-rule").* }
module publicationNoNewEntryRule { import publicationJournal(MUTANT = "no-new-entry-rule").* }
module publicationNoTargetRule { import publicationJournal(MUTANT = "no-target-rule").* }
module publicationNoRetry { import publicationJournal(MUTANT = "no-retry").* }
module publicationSplitRead { import publicationJournal(MUTANT = "split-read").* }
