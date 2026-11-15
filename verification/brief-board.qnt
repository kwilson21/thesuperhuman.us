// Quint model of the living brief's board (docs/plans/2026-11-living-brief.md). Replies from the interpreting model arrive
// late, out of order and overlapping, while the visitor keeps writing and keeps, edits, sets aside, brings back and undoes
// cards, and pauses the board. Written before the code, from the design.
// Code modelled:
//   reconcile:   src/lib/brief-board.ts `applyReply` (the request number guard, pause, the passage checked against the
//                current answers, owned cards left alone, set-aside ideas not added again, and a card changed only by a
//                reply whose request was sent after the card last became unowned: `since`)
//   actions:     src/lib/brief-board.ts `keepCard`, `editCard`, `setAside`, `bringBack`, `addNote`, `undo`
//   the outline: src/lib/brief-board.ts `briefOutline` (what is sent with the brief, and its "from your answers" items)
// What is left out, on purpose: lanes (each lane is reconciled on its own and the rules do not cross lanes, so one is
// enough), similarity (an idea here is its normalised key; tests/lib/brief-board.test.ts covers the matching), lane limits,
// the scheduler's timing (it only makes overlap rarer: here any number of requests overlap and replies come in any order),
// and holding replies while focus is in the board (a held reply is the same as one delivered later).
// The model is adversarial: a reply may mention any idea, claim any idea was read from the answers, and name owned or
// set-aside ideas.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module briefBoard {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "snapshot-status"  a reply judges a card by its status when the request was sent, not by its status now
  //   "seen-only"        a reply may change any card that was unowned when its request was sent and is unowned now (the
  //                      first design: it forgets a set-aside that was undone while the request was in flight)
  //   "withdraw-unseen"  a reply withdraws every unowned card it leaves out, even one its request never showed
  //   "no-avoid"         an idea the visitor set aside can be added again by a reply
  //   "snapshot-quote"   a passage is checked against the answers as they were when the request was sent
  //   "outline-quote"    the outline marks a card as read from the answers without checking its passage again
  //   "no-number-guard"  a reply older than the last one applied is applied
  //   "apply-paused"     a reply applies while the board is paused
  const MUTANT: str

  // A card for one idea. status: absent, proposed (the model's, unowned), kept, edited, dismissed (set aside), wrote (the
  // visitor's own note). basis: said (read from the answers) or suggested, for a card the model made. since: the number of
  // requests sent when the card last became unowned.
  type Card = { status: str, basis: str, since: int }
  // A request: the answers and the unowned ideas it showed the model, and whether its reply is still to come.
  type Req = { text: Set[int], seen: Set[int], live: bool }
  // One visitor action, for Undo: the idea and the card as it was before.
  type Step = { idea: int, prev: Card }

  val IDEAS = 1.to(3)
  // Idea i is read from passage i. Idea 3 is in no passage: it can only be an inference.
  val PASSAGES = 1.to(2)
  val MAXREQ = 4
  val absent = { status: "absent", basis: "none", since: 0 }

  pure def owned(c: Card): bool = Set("kept", "edited", "dismissed", "wrote").contains(c.status)
  pure def groundedIn(i: int, text: Set[int]): bool = PASSAGES.contains(i) and text.contains(i)

  var text: Set[int]
  var cards: int -> Card
  var reqs: int -> Req
  var sent: int
  var applied: int
  var paused: bool
  var history: List[Step]
  // Ghosts, set from the board as it really is when a reply applies, not from what the request saw.
  var rejected: Set[int]
  var restoredAt: int -> int
  var ownedTouched: bool
  var ungroundedApplied: bool
  var olderApplied: bool
  var appliedPaused: bool
  var undoReverted: bool

  action init = all {
    text' = Set(),
    cards' = IDEAS.mapBy(i => absent),
    reqs' = Map(),
    sent' = 0,
    applied' = 0,
    paused' = false,
    history' = List(),
    rejected' = Set(),
    restoredAt' = IDEAS.mapBy(i => 0),
    ownedTouched' = false,
    ungroundedApplied' = false,
    olderApplied' = false,
    appliedPaused' = false,
    undoReverted' = false,
  }

  action keepRequestsAndGhosts = all {
    reqs' = reqs, sent' = sent, applied' = applied,
    ownedTouched' = ownedTouched, ungroundedApplied' = ungroundedApplied, olderApplied' = olderApplied,
    appliedPaused' = appliedPaused, undoReverted' = undoReverted,
  }

  // ---- The visitor ----------------------------------------------------------------------------------------------------
  action write = {
    nondet p = PASSAGES.oneOf()
    all {
      text' = text.union(Set(p)), cards' = cards, paused' = paused, history' = history, rejected' = rejected,
      restoredAt' = restoredAt, keepRequestsAndGhosts,
    }
  }

  action erase = {
    nondet p = PASSAGES.oneOf()
    all {
      text' = text.exclude(Set(p)), cards' = cards, paused' = paused, history' = history, rejected' = rejected,
      restoredAt' = restoredAt, keepRequestsAndGhosts,
    }
  }

  // Keep, Edit, Not this, Bring back and adding a note: one card changes, and Undo remembers how it was.
  action visitorSets(i: int, card: Card, rejectedNext: Set[int]): bool = all {
    text' = text,
    cards' = cards.set(i, card),
    paused' = paused,
    history' = history.append({ idea: i, prev: cards.get(i) }),
    rejected' = rejectedNext,
    restoredAt' = restoredAt,
    keepRequestsAndGhosts,
  }

  action keep = {
    nondet i = IDEAS.filter(j => cards.get(j).status == "proposed").oneOf()
    visitorSets(i, { ...cards.get(i), status: "kept" }, rejected)
  }

  action edit = {
    nondet i = IDEAS.filter(j => Set("proposed", "kept").contains(cards.get(j).status)).oneOf()
    visitorSets(i, { ...cards.get(i), status: "edited" }, rejected)
  }

  action setAside = {
    nondet i = IDEAS.filter(j => Set("proposed", "kept", "edited").contains(cards.get(j).status)).oneOf()
    visitorSets(i, { ...cards.get(i), status: "dismissed" }, rejected.union(Set(i)))
  }

  action bringBack = {
    nondet i = IDEAS.filter(j => cards.get(j).status == "dismissed").oneOf()
    visitorSets(i, { ...cards.get(i), status: "kept" }, rejected.exclude(Set(i)))
  }

  action addNote = {
    nondet i = IDEAS.filter(j => cards.get(j).status == "absent").oneOf()
    visitorSets(i, { status: "wrote", basis: "none", since: 0 }, rejected)
  }

  // Undo puts the card back exactly as it was. A card that becomes unowned again is stamped with the requests sent so far.
  action undoLast = {
    val last = history[history.length() - 1]
    val back = if (last.prev.status == "proposed") { ...last.prev, since: sent } else last.prev
    all {
      text' = text,
      cards' = cards.set(last.idea, back),
      paused' = paused,
      history' = history.slice(0, history.length() - 1),
      rejected' = if (back.status == "dismissed") rejected.union(Set(last.idea)) else rejected.exclude(Set(last.idea)),
      restoredAt' = if (back.status == "proposed") restoredAt.set(last.idea, sent) else restoredAt,
      keepRequestsAndGhosts,
    }
  }

  action undo = all { history.length() > 0, undoLast }

  action pause = all {
    not(paused), paused' = true,
    text' = text, cards' = cards, history' = history, rejected' = rejected, restoredAt' = restoredAt, keepRequestsAndGhosts,
  }

  action resume = all {
    paused, paused' = false,
    text' = text, cards' = cards, history' = history, rejected' = rejected, restoredAt' = restoredAt, keepRequestsAndGhosts,
  }

  // ---- Requests and replies -------------------------------------------------------------------------------------------
  action send = all {
    not(paused),
    sent < MAXREQ,
    reqs' = reqs.put(sent + 1, { text: text, seen: IDEAS.filter(j => cards.get(j).status == "proposed"), live: true }),
    sent' = sent + 1,
    text' = text, cards' = cards, applied' = applied, paused' = paused, history' = history, rejected' = rejected,
    restoredAt' = restoredAt, ownedTouched' = ownedTouched, ungroundedApplied' = ungroundedApplied,
    olderApplied' = olderApplied, appliedPaused' = appliedPaused, undoReverted' = undoReverted,
  }

  // Whether reply n may change the card for idea i (update it, or withdraw it by leaving it out).
  def mayChange(n: int, i: int): bool = {
    val c = cards.get(i)
    val r = reqs.get(n)
    if (MUTANT == "snapshot-status") r.seen.contains(i)
    else if (MUTANT == "seen-only") c.status == "proposed" and r.seen.contains(i)
    else c.status == "proposed" and n > c.since
  }

  def mayWithdraw(n: int, i: int): bool =
    if (MUTANT == "withdraw-unseen") cards.get(i).status == "proposed" else mayChange(n, i)

  // The card for idea i after reply n, which mentions the ideas in `mention` and claims `said` were read from the answers.
  def after(n: int, i: int, mention: Set[int], said: Set[int]): Card = {
    val c = cards.get(i)
    val r = reqs.get(n)
    val against = if (MUTANT == "snapshot-quote") r.text else text
    val ok = mention.contains(i) and (said.contains(i) implies groundedIn(i, against))
    val basis = if (said.contains(i)) "said" else "suggested"
    val addable = c.status == "absent" or (MUTANT == "no-avoid" and c.status == "dismissed")
    if (ok and c.status != "absent" and mayChange(n, i)) { ...c, status: "proposed", basis: basis }
    else if (ok and addable) { status: "proposed", basis: basis, since: sent }
    else if (not(ok) and c.status != "absent" and mayWithdraw(n, i)) absent
    else c
  }

  action deliver = {
    nondet n = reqs.keys().filter(k => reqs.get(k).live).oneOf()
    nondet mention = IDEAS.powerset().oneOf()
    nondet said = IDEAS.powerset().oneOf()
    val stale = MUTANT != "no-number-guard" and n <= applied
    val held = MUTANT != "apply-paused" and paused
    val updated = IDEAS.mapBy(i => after(n, i, mention, said))
    val changed = IDEAS.filter(i => updated.get(i) != cards.get(i))
    if (stale or held) all {
      reqs' = reqs.set(n, { ...reqs.get(n), live: false }),
      text' = text, cards' = cards, sent' = sent, applied' = applied, paused' = paused, history' = history,
      rejected' = rejected, restoredAt' = restoredAt, ownedTouched' = ownedTouched,
      ungroundedApplied' = ungroundedApplied, olderApplied' = olderApplied, appliedPaused' = appliedPaused,
      undoReverted' = undoReverted,
    } else all {
      reqs' = reqs.set(n, { ...reqs.get(n), live: false }),
      cards' = updated,
      applied' = if (n > applied) n else applied,
      text' = text, sent' = sent, paused' = paused, history' = history, rejected' = rejected, restoredAt' = restoredAt,
      ownedTouched' = (ownedTouched or changed.exists(i => owned(cards.get(i)))),
      ungroundedApplied' = (ungroundedApplied
        or changed.exists(i => updated.get(i).status == "proposed" and updated.get(i).basis == "said" and not(groundedIn(i, text)))),
      olderApplied' = (olderApplied or (n < applied and changed.size() > 0)),
      appliedPaused' = (appliedPaused or (paused and changed.size() > 0)),
      undoReverted' = (undoReverted or changed.exists(i => n <= restoredAt.get(i))),
    }
  }

  action step = any { write, erase, keep, edit, setAside, bringBack, addNote, undo, pause, resume, send, deliver }

  // For the Apalache check only (`--step stepOrEnd`).
  action finished = all {
    text' = text, cards' = cards, paused' = paused, history' = history, rejected' = rejected, restoredAt' = restoredAt,
    keepRequestsAndGhosts,
  }
  action stepOrEnd = any { step, finished }

  // ---- What is sent with the brief ------------------------------------------------------------------------------------
  // The ideas the outline marks "from your answers": unowned or kept cards read from the answers whose passage is in the
  // answers now. A kept card whose passage has gone is sent as kept, not as read from the answers.
  val fromAnswers = IDEAS.filter(i =>
    Set("proposed", "kept").contains(cards.get(i).status) and cards.get(i).basis == "said"
      and (MUTANT == "outline-quote" or groundedIn(i, text)))

  // ---- Properties -----------------------------------------------------------------------------------------------------
  // 1. A reply never changes a card the visitor owns (kept, edited, set aside, or their own note).
  val ownedUntouched = not(ownedTouched)

  // 2. An idea the visitor set aside stays set aside until the visitor brings it back or undoes setting it aside.
  val rejectedStaysRejected = rejected.forall(i => cards.get(i).status == "dismissed")

  // 3. A reply never changes or withdraws a card that Undo made unowned again after that reply's request was sent.
  val undoRespected = not(undoReverted)

  // 4. A reply never makes a card "read from your answers" from a passage that is not in the answers now.
  val groundedOnApply = not(ungroundedApplied)

  // 5. Everything the outline sends as read from the answers is in the answers being sent.
  val outlineGrounded = fromAnswers.forall(i => groundedIn(i, text))

  // 6. An older reply never changes the board after a newer one has applied.
  val newestWins = not(olderApplied)

  // 7. Nothing a reply says changes the board while it is paused.
  val pausedHolds = not(appliedPaused)

  val allProperties = and {
    ownedUntouched, rejectedStaysRejected, undoRespected, groundedOnApply, outlineGrounded, newestWins, pausedHolds,
  }

  // Reachability witness, for a hand check with the negated invariant: a reply sent before the visitor kept a card arrived
  // after it and left it alone, and a later reply updated another card.
  val keptThenStaleReply = IDEAS.exists(i => cards.get(i).status == "kept") and applied >= 2
  val neverKeptThenStaleReply = not(keptThenStaleReply)
}

module board { import briefBoard(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module boardSnapshotStatus { import briefBoard(MUTANT = "snapshot-status").* }
module boardSeenOnly { import briefBoard(MUTANT = "seen-only").* }
module boardWithdrawUnseen { import briefBoard(MUTANT = "withdraw-unseen").* }
module boardNoAvoid { import briefBoard(MUTANT = "no-avoid").* }
module boardSnapshotQuote { import briefBoard(MUTANT = "snapshot-quote").* }
module boardOutlineQuote { import briefBoard(MUTANT = "outline-quote").* }
module boardNoNumberGuard { import briefBoard(MUTANT = "no-number-guard").* }
module boardApplyPaused { import briefBoard(MUTANT = "apply-paused").* }
