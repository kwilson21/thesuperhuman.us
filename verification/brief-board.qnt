// Quint model of the living brief's board (docs/plans/2026-11-living-brief.md). Replies from the interpreting model arrive
// late, out of order and overlapping, while the visitor keeps writing and keeps, edits, sets aside, brings back and undoes
// cards, and pauses the board. Written before the code, from the design.
// Code modelled:
//   reconcile:   src/lib/brief-board.ts `applyReply` (the request number guard, pause, the passage checked against the
//                current answers, owned cards left alone, set-aside ideas not added again, and a card changed only by a
//                reply whose request was sent after the card last became unowned: `since`)
//   actions:     src/lib/brief-board.ts `keepCard`, `editCard`, `setAside`, `bringBack`, `addNote`, `undo`
//   the outline: src/lib/brief-board.ts `briefOutline` (what is sent with the brief, and its "from your answers" items)
// The lane on screen (section 10.3 of the design): the page shows one lane at a time, or none (a written question). A
// reply applies in full to every lane not on screen. On the lane on screen it only adds cards; its changes to and
// withdrawals of the cards already listed there wait, as the held reply (`deferred`), until the visitor leaves the lane,
// and are then applied under the same rules as any reply (ownership, `since`, newest wins, pause) against the board as it
// is at that moment. Requests no longer depend on a visible board: `send` is unchanged.
// What is left out, on purpose: lane limits and the one rule that looks across lanes (naming: a reply card that names, by
// its ref, a card in another lane leaves that card as it is, which the model's replies already cover by naming any idea;
// cards never move between lanes; the model has two lanes, three ideas), similarity (an idea here is its normalised key; tests/lib/brief-board.test.ts covers the matching),
// and the scheduler's timing (it only makes overlap rarer: here any number of requests overlap and replies come in any
// order). The visitor may also write or erase while a lane is on screen: more than the page allows, on purpose.
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
//   "apply-on-screen"  a reply is applied in full to the lane on screen too: its changes and withdrawals move the cards
//                      the visitor is looking at
  const MUTANT: str

  // A card for one idea. status: absent, proposed (the model's, unowned), kept, edited, dismissed (set aside), wrote (the
  // visitor's own note). basis: said (read from the answers) or suggested, for a card the model made. since: the number of
  // requests sent when the card last became unowned.
  type Card = { status: str, basis: str, since: int }
  // A request: the answers and the unowned ideas it showed the model, and whether its reply is still to come.
  type Req = { text: Set[int], seen: Set[int], live: bool }
  // One visitor action, for Undo: the idea and the card as it was before.
  type Step = { idea: int, prev: Card }
  // The reply held for the lane on screen: its request number (0 for none), the ideas it mentions and the ideas it says
  // were read from the answers. Its changes and withdrawals are applied when the visitor leaves the lane.
  type Held = { n: int, mention: Set[int], said: Set[int] }

  val IDEAS = 1.to(3)
  // Idea i is read from passage i. Idea 3 is in no passage: it can only be an inference.
  val PASSAGES = 1.to(2)
  val MAXREQ = 4
  // Two lanes: ideas 1 and 2 are in lane 1, idea 3 is in lane 2. The lane on screen is 0 (none), 1 or 2.
  val LANES = 1.to(2)
  pure def laneOf(i: int): int = if (i <= 2) 1 else 2
  val noHeld: Held = { n: 0, mention: Set(), said: Set() }
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
  // The lane on screen and the reply held for it.
  var screen: int
  var deferred: Held
  // Ghosts: a delivery changed or withdrew a card listed on the lane on screen; leaving a lane applied held changes.
  var onScreenChanged: bool
  var flushChanged: bool

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
    screen' = 0,
    deferred' = noHeld,
    onScreenChanged' = false,
    flushChanged' = false,
  }

  action keepRequestsAndGhosts = all {
    reqs' = reqs, sent' = sent, applied' = applied,
    ownedTouched' = ownedTouched, ungroundedApplied' = ungroundedApplied, olderApplied' = olderApplied,
    appliedPaused' = appliedPaused, undoReverted' = undoReverted,
    screen' = screen, deferred' = deferred, onScreenChanged' = onScreenChanged, flushChanged' = flushChanged,
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
    screen' = screen, deferred' = deferred, onScreenChanged' = onScreenChanged, flushChanged' = flushChanged,
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

  // The card for idea i after reply n if the reply may only add: the part of `after` that lists a new card. This is all a
  // reply does to the lane on screen when it arrives.
  def afterAdd(n: int, i: int, mention: Set[int], said: Set[int]): Card = {
    val c = cards.get(i)
    val r = reqs.get(n)
    val against = if (MUTANT == "snapshot-quote") r.text else text
    val ok = mention.contains(i) and (said.contains(i) implies groundedIn(i, against))
    val basis = if (said.contains(i)) "said" else "suggested"
    val addable = c.status == "absent" or (MUTANT == "no-avoid" and c.status == "dismissed")
    if (ok and addable and not(c.status != "absent" and mayChange(n, i))) { status: "proposed", basis: basis, since: sent }
    else c
  }

  // The card for idea i after the changes and withdrawals of reply n, which the lane on screen held until it was left.
  def afterChange(n: int, i: int, mention: Set[int], said: Set[int]): Card = {
    val c = cards.get(i)
    val r = reqs.get(n)
    val against = if (MUTANT == "snapshot-quote") r.text else text
    val ok = mention.contains(i) and (said.contains(i) implies groundedIn(i, against))
    val basis = if (said.contains(i)) "said" else "suggested"
    if (ok and c.status != "absent" and mayChange(n, i)) { ...c, status: "proposed", basis: basis }
    else if (not(ok) and c.status != "absent" and mayWithdraw(n, i)) absent
    else c
  }

  // Puts `updated` on the board, by reply n, and records what the ghosts watch. `watch` is the ideas whose change a
  // delivery may not make (the lane on screen); `leaving` marks the application of a held reply.
  action commit(n: int, updated: int -> Card, reqsNext: int -> Req, appliedNext: int, screenNext: int, deferredNext: Held,
                watch: Set[int], leaving: bool): bool = {
    val changed = IDEAS.filter(i => updated.get(i) != cards.get(i))
    all {
      reqs' = reqsNext,
      cards' = updated,
      applied' = appliedNext,
      screen' = screenNext,
      deferred' = deferredNext,
      text' = text, sent' = sent, paused' = paused, history' = history, rejected' = rejected, restoredAt' = restoredAt,
      ownedTouched' = (ownedTouched or changed.exists(i => owned(cards.get(i)))),
      ungroundedApplied' = (ungroundedApplied
        or changed.exists(i => updated.get(i).status == "proposed" and updated.get(i).basis == "said" and not(groundedIn(i, text)))),
      olderApplied' = (olderApplied or (n < applied and changed.size() > 0)),
      appliedPaused' = (appliedPaused or (paused and changed.size() > 0)),
      undoReverted' = (undoReverted or changed.exists(i => n <= restoredAt.get(i))),
      onScreenChanged' = (onScreenChanged or changed.exists(i => watch.contains(i) and cards.get(i).status != "absent")),
      flushChanged' = (flushChanged or (leaving and changed.size() > 0)),
    }
  }

  action deliver = {
    nondet n = reqs.keys().filter(k => reqs.get(k).live).oneOf()
    nondet mention = IDEAS.powerset().oneOf()
    nondet said = IDEAS.powerset().oneOf()
    val stale = MUTANT != "no-number-guard" and n <= applied
    val held = MUTANT != "apply-paused" and paused
    // The lane on screen is held back, except in the mutant that applies everything to it.
    val onScreen = if (MUTANT == "apply-on-screen") Set() else IDEAS.filter(i => screen > 0 and laneOf(i) == screen)
    val updated = IDEAS.mapBy(i => if (onScreen.contains(i)) afterAdd(n, i, mention, said) else after(n, i, mention, said))
    val spent = reqs.set(n, { ...reqs.get(n), live: false })
    if (stale or held) all {
      reqs' = spent,
      text' = text, cards' = cards, sent' = sent, applied' = applied, paused' = paused, history' = history,
      rejected' = rejected, restoredAt' = restoredAt, ownedTouched' = ownedTouched,
      ungroundedApplied' = ungroundedApplied, olderApplied' = olderApplied, appliedPaused' = appliedPaused,
      undoReverted' = undoReverted, screen' = screen, deferred' = deferred, onScreenChanged' = onScreenChanged,
      flushChanged' = flushChanged,
    } else commit(n, updated, spent, if (n > applied) n else applied, screen,
                  if (screen > 0 and MUTANT != "apply-on-screen") { n: n, mention: mention, said: said } else deferred,
                  IDEAS.filter(i => screen > 0 and laneOf(i) == screen), false)
  }

  // The visitor moves to another lane, or to none (a written question or another step). Leaving a lane applies the reply
  // held for it. The held reply is dropped, not applied, when a newer reply has applied since or the board is paused: the
  // same two rules that stop a reply on arrival.
  action moveScreen = {
    nondet lane = 0.to(2).filter(l => l != screen).oneOf()
    val has = screen > 0 and deferred.n > 0
    val dropped = (MUTANT != "no-number-guard" and deferred.n < applied) or (MUTANT != "apply-paused" and paused)
    val updated =
      if (has and not(dropped))
        IDEAS.mapBy(i => if (laneOf(i) == screen) afterChange(deferred.n, i, deferred.mention, deferred.said) else cards.get(i))
      else cards
    commit(deferred.n, updated, reqs, applied, lane, noHeld, Set(), true)
  }

  action step = any { write, erase, keep, edit, setAside, bringBack, addNote, undo, pause, resume, send, deliver, moveScreen }

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

  // 8. No card listed on the lane on screen is changed or withdrawn by a delivery. (A held change is applied when the
  // visitor leaves the lane, and then it is judged by properties 1 to 7 like any other.)
  val onScreenStable = not(onScreenChanged)

  val allProperties = and {
    ownedUntouched, rejectedStaysRejected, undoRespected, groundedOnApply, outlineGrounded, newestWins, pausedHolds,
    onScreenStable,
  }

  // Reachability witness, for a hand check with the negated invariant: a reply sent before the visitor kept a card arrived
  // after it and left it alone, and a later reply updated another card.
  val keptThenStaleReply = IDEAS.exists(i => cards.get(i).status == "kept") and applied >= 2
  val neverKeptThenStaleReply = not(keptThenStaleReply)

  // Reachability witnesses for the lane on screen: a reply was held for it, and leaving the lane applied a held change.
  val neverHeld = not(screen > 0 and deferred.n > 0)
  val neverFlushChanged = not(flushChanged)
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
module boardApplyOnScreen { import briefBoard(MUTANT = "apply-on-screen").* }
