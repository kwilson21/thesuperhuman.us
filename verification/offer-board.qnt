// Quint model of the offer board's Use and Undo on the owner's request page (docs/plans/2026-11-offer-board.md). Use puts a
// card into the offer editor's own fields, so one press changes two things: the board and the offer. Meanwhile the owner
// types in the offer, adds and removes milestone rows, sets a used milestone's fee, keeps, edits, sets aside and brings
// back cards, and undoes; replies arrive late and out of order, and a request can fail. Written after the first review
// found five bugs in this coupling by reading (each is a mutant below), so the next one is found by search instead.
// Code modelled:
//   use:      src/scripts/offer-board.ts `use`, `setField`, `milestoneFor` (which row a milestone fills), and
//             src/lib/brief-board.ts `useCard`
//   undo:     src/scripts/offer-board.ts `undoLast` (what Use recorded for that history step, put back only where the
//             offer still holds what Use put there; a row Use added goes once it is empty) and `undoIn`
//   fee:      src/scripts/offer-board.ts `setFee` (the fee of a used milestone, and nothing else)
//   replies:  `apply` (a card's milestone detail follows a reply only where the reply could change the card) over
//             `applyReplyIn`, whose own rules the brief-board model checks
//   failures: `ask`, `failed` and `schedule` (a failure stops the board asking on its own until Suggest)
// What is left out, on purpose: the text of a card (an idea is its number), lanes and their limits, the questions lane
// (it copies to a separate box the same way a one-per-line field is filled), one-per-line fields (a Use adds a line and
// Undo removes that line only, the same rule as a field), the estimate range buttons (the owner's own press, no Undo),
// held replies (a held reply is a later delivery) and the scheduler's timing.
// Values: a field or row part holds 0 (empty), a card's number (what Use put there), OWNER (words the owner typed) or,
// for a fee, a card's fee or OWNER_FEE.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module offerBoardModel {
  // "none" is the design. Every other value puts back one bug the first review found, or removes one protection:
  //   "key-by-length"       what Use changed is remembered under the history's length, not the step (the history is capped,
  //                         so an Undo after the cap puts back another step's fields)
  //   "restore-always"      Undo puts a field back even when the owner has typed in it since, and removes a row Use added
  //                         even when the owner has typed in it
  //   "keep-only-proposed"  Use on an edited or brought-back card changes the offer but records no step (the board's Keep
  //                         took only open cards)
  //   "fee-is-use"          the fee button uses the milestone again, writing its name and deliverables over the owner's
  //   "stale-used-in"       Undo leaves where a milestone went, and Use trusts it without checking the row still holds it
  //   "detail-ignores-since" a reply changes the milestone detail of any open card it mentions, even one Undo reopened after
  //                         its request was sent
  //   "retry-on-fail"       a failed request leaves the board asking on its own
  //   "name-only-empty"     a row counts as empty when its name is empty, so Use writes over deliverables or a fee the owner
  //                         typed in a row without a name
  //   "no-row-removal"      Undo empties a row Use added but leaves it in the offer
  //   "remove-last-row"     Undo removes a row Use added even when the owner has since removed every other row
  //   "detail-on-owned"     a reply's milestone detail is matched by idea alone, so it lands on a card the owner used
  const MUTANT: str

  type Row = { name: int, deliv: int, fee: int }
  type Card = { status: str, since: int, detail: int }
  // What a Use changed, for its Undo: the field before and after, or the row (and whether Use added it), and where the card
  // was used before. kind "none": a step that changed only the board.
  type Restore = {
    kind: str, stepId: int, idea: int, fieldWas: int, fieldSet: int, row: int, rowWas: Row, rowSet: Row, added: bool,
    usedWas: bool, usedInWas: int
  }
  // One step on the board's history, with the offer as it was before it and the owner's edits so far (for undoComplete).
  type Step = { id: int, idea: int, prev: Card, restore: Restore, snapField: int, snapRows: int -> Row, edits: int }
  type Offer = { field: int, rows: int -> Row, nextRow: int, edits: int }
  type BoardState = {
    cards: int -> Card, used: Set[int], usedIn: int -> int, history: List[Step], nextStep: int,
    restoreAt: int -> Restore, rejected: Set[int], restoredAt: int -> int
  }
  type Net = { live: Set[int], sent: int, applied: int, autoAsk: bool, failedSinceSuggest: bool }
  type Ghost = {
    clobbered: bool, wrongRestore: bool, useWithoutStep: bool, overwroteOther: bool, ownedTouched: bool,
    undoReverted: bool, autoAfterFail: bool, undoIncomplete: bool
  }

  // Ideas 1 and 2 fill the same field (the outcome); ideas 3 and 4 are milestones, each filling a row.
  val IDEAS = 1.to(4)
  val ROW_IDEAS = Set(3, 4)
  val MAXROWS = 2
  // The real history keeps 40 steps; two are enough to reach the cap.
  val HCAP = 2
  val MAXREQ = 3
  val OWNER = 9
  val OWNER_FEE = 7

  pure def feeOf(i: int): int = i + 2
  pure val emptyRow: Row = { name: 0, deliv: 0, fee: 0 }
  pure val noRestore: Restore = {
    kind: "none", stepId: 0, idea: 0, fieldWas: 0, fieldSet: 0, row: 0, rowWas: emptyRow, rowSet: emptyRow,
    added: false, usedWas: false, usedInWas: 0
  }
  pure def ownerValue(v: int): bool = v == OWNER or v == OWNER_FEE
  pure def blank(r: Row): bool = r.name == 0 and r.deliv == 0 and r.fee == 0
  pure def owned(c: Card): bool = Set("kept", "edited", "dismissed").contains(c.status)
  pure def without(m: int -> Row, k: int): int -> Row = m.keys().exclude(Set(k)).mapBy(x => m.get(x))
  pure def withoutRestore(m: int -> Restore, k: int): int -> Restore = m.keys().exclude(Set(k)).mapBy(x => m.get(x))
  pure def capped(l: List[Step]): List[Step] = if (l.length() > HCAP) l.slice(1, l.length()) else l
  pure def lowest(s: Set[int]): int = s.fold(1000, (m, r) => if (r < m) r else m)
  // Undo of one part: back to what it was, only while it still holds what Use put there ("always": the old code).
  pure def back(now: int, was: int, written: int, oldRule: bool): int = if (was != written and (oldRule or now == written)) was else now
  // Whether a change from `before` to `after` replaces something the owner typed.
  pure def clobbers(before: Row, after: Row): bool =
    (ownerValue(before.name) and after.name != before.name)
      or (ownerValue(before.deliv) and after.deliv != before.deliv)
      or (ownerValue(before.fee) and after.fee != before.fee)
  pure def holdsOwner(r: Row): bool = ownerValue(r.name) or ownerValue(r.deliv) or ownerValue(r.fee)

  var offer: Offer
  var board: BoardState
  var net: Net
  // Ghosts, set from the page as it really is when something happens.
  var ghost: Ghost

  action init = all {
    offer' = { field: 0, rows: Map(1 -> emptyRow), nextRow: 2, edits: 0 },
    board' = {
      cards: IDEAS.mapBy(i => { status: "absent", since: 0, detail: 0 }),
      used: Set(),
      usedIn: IDEAS.mapBy(i => 0),
      history: List(),
      nextStep: 1,
      restoreAt: Map(),
      rejected: Set(),
      restoredAt: IDEAS.mapBy(i => 0),
    },
    net' = { live: Set(), sent: 0, applied: 0, autoAsk: false, failedSinceSuggest: false },
    ghost' = {
      clobbered: false, wrongRestore: false, useWithoutStep: false, overwroteOther: false, ownedTouched: false,
      undoReverted: false, autoAfterFail: false, undoIncomplete: false,
    },
  }

  // ---- The owner, in the offer editor ---------------------------------------------------------------------------------
  action ownerChanges(o: Offer): bool = all {
    offer' = { ...o, edits: offer.edits + 1 }, board' = board, net' = net, ghost' = ghost,
  }

  action typeField = {
    nondet v = Set(0, OWNER).oneOf()
    ownerChanges({ ...offer, field: v })
  }

  action typeRow = {
    nondet r = offer.rows.keys().oneOf()
    nondet part = Set("name", "deliv", "fee").oneOf()
    nondet typed = Set(false, true).oneOf()
    val row = offer.rows.get(r)
    val typedRow =
      if (part == "name") { ...row, name: if (typed) OWNER else 0 }
      else if (part == "deliv") { ...row, deliv: if (typed) OWNER else 0 }
      else { ...row, fee: if (typed) OWNER_FEE else 0 }
    ownerChanges({ ...offer, rows: offer.rows.set(r, typedRow) })
  }

  action addRow = all {
    offer.rows.keys().size() < MAXROWS,
    ownerChanges({ ...offer, rows: offer.rows.put(offer.nextRow, emptyRow), nextRow: offer.nextRow + 1 }),
  }

  action removeRow = {
    nondet r = offer.rows.keys().oneOf()
    all { offer.rows.keys().size() > 1, ownerChanges({ ...offer, rows: without(offer.rows, r) }) }
  }

  // ---- The owner, on the board ----------------------------------------------------------------------------------------
  // Use is offered for a card not already in the offer that is open, edited, or kept by bringing it back.
  def usable(i: int): bool =
    not(board.used.contains(i)) and Set("proposed", "edited", "kept").contains(board.cards.get(i).status)

  def emptyForUse(r: Row): bool = if (MUTANT == "name-only-empty") r.name == 0 else blank(r)

  // The row a milestone fills: the row it filled before while that row still holds its name, the first empty row, or a new
  // row. 0: none (the offer already has MAXROWS rows, and Use says so and changes nothing).
  def targetRow(i: int): int = {
    val k = board.usedIn.get(i)
    val ids = offer.rows.keys()
    val knownOk = k != 0 and ids.contains(k) and (MUTANT == "stale-used-in" or offer.rows.get(k).name == i)
    val empties = ids.filter(r => emptyForUse(offer.rows.get(r)))
    if (knownOk) k
    else if (empties.size() > 0) lowest(empties)
    else if (ids.size() < MAXROWS) offer.nextRow
    else 0
  }

  action use(i: int, withFee: bool): bool = {
    val card = board.cards.get(i)
    val isRow = ROW_IDEAS.contains(i)
    val t = if (isRow) targetRow(i) else 0
    val added = isRow and t != 0 and not(offer.rows.keys().contains(t))
    val rowBefore = if (isRow and t != 0 and not(added)) offer.rows.get(t) else emptyRow
    val rowAfter = { name: i, deliv: i, fee: if (withFee) feeOf(i) else rowBefore.fee }
    val offerAfter =
      if (isRow) { ...offer, rows: offer.rows.put(t, rowAfter), nextRow: if (added) offer.nextRow + 1 else offer.nextRow }
      else { ...offer, field: i }
    val restore = {
      kind: if (isRow) "row" else "field", stepId: board.nextStep, idea: i, fieldWas: offer.field, fieldSet: i,
      row: t, rowWas: rowBefore, rowSet: rowAfter, added: added, usedWas: board.used.contains(i),
      usedInWas: board.usedIn.get(i),
    }
    // The board records a step for the Use (src/lib/brief-board.ts useCard); the old Keep took only open cards.
    val records = MUTANT != "keep-only-proposed" or card.status == "proposed"
    val step = {
      id: board.nextStep, idea: i, prev: card, restore: restore, snapField: offer.field, snapRows: offer.rows,
      edits: offer.edits,
    }
    val history = capped(board.history.append(step))
    all {
      not(isRow) or t != 0,
      offer' = offerAfter,
      board' = {
        ...board,
        cards: if (records) board.cards.set(i, { ...card, status: "kept" }) else board.cards,
        used: board.used.union(Set(i)),
        usedIn: if (isRow) board.usedIn.set(i, t) else board.usedIn,
        history: if (records) history else board.history,
        nextStep: board.nextStep + 1,
        restoreAt:
          if (records and MUTANT == "key-by-length") board.restoreAt.put(history.length(), restore) else board.restoreAt,
      },
      net' = net,
      ghost' = {
        ...ghost,
        clobbered: ghost.clobbered or (isRow and clobbers(rowBefore, rowAfter)),
        overwroteOther: ghost.overwroteOther or (isRow and ROW_IDEAS.exclude(Set(i)).contains(rowBefore.name)),
        useWithoutStep: ghost.useWithoutStep or (not(records) and offerAfter != offer),
      },
    }
  }

  action useAny = {
    nondet i = IDEAS.filter(j => usable(j)).oneOf()
    nondet withFee = Set(false, true).oneOf()
    use(i, withFee and ROW_IDEAS.contains(i))
  }

  // "Set its fee": the owner's press on a used milestone. The fee is theirs to replace; nothing else in the row changes.
  action setFee(i: int): bool = {
    val t = board.usedIn.get(i)
    val row = if (offer.rows.keys().contains(t)) offer.rows.get(t) else emptyRow
    val after = if (MUTANT == "fee-is-use") { name: i, deliv: i, fee: feeOf(i) } else { ...row, fee: feeOf(i) }
    all {
      t != 0,
      offer.rows.keys().contains(t),
      offer' = { ...offer, rows: offer.rows.set(t, after), edits: offer.edits + 1 },
      board' = board,
      net' = net,
      ghost' = { ...ghost, clobbered: ghost.clobbered or clobbers(row, { ...after, fee: row.fee }) },
    }
  }

  action feeAny = {
    nondet i = board.used.intersect(ROW_IDEAS).oneOf()
    setFee(i)
  }

  // Edit, Not this and Bring back change only the board; Undo of them puts the card back.
  action boardStep(i: int, card: Card, rejectedNext: Set[int]): bool = {
    val step = {
      id: board.nextStep, idea: i, prev: board.cards.get(i), restore: { ...noRestore, stepId: board.nextStep, idea: i },
      snapField: offer.field, snapRows: offer.rows, edits: offer.edits,
    }
    all {
      offer' = offer,
      board' = {
        ...board,
        cards: board.cards.set(i, card),
        history: capped(board.history.append(step)),
        nextStep: board.nextStep + 1,
        rejected: rejectedNext,
      },
      net' = net,
      ghost' = ghost,
    }
  }

  action edit = {
    nondet i = IDEAS.filter(j => usable(j)).oneOf()
    boardStep(i, { ...board.cards.get(i), status: "edited" }, board.rejected)
  }

  action setAside = {
    nondet i = IDEAS.filter(j => Set("proposed", "kept", "edited").contains(board.cards.get(j).status)).oneOf()
    boardStep(i, { ...board.cards.get(i), status: "dismissed" }, board.rejected.union(Set(i)))
  }

  action bringBack = {
    nondet i = IDEAS.filter(j => board.cards.get(j).status == "dismissed").oneOf()
    boardStep(i, { ...board.cards.get(i), status: "kept" }, board.rejected.exclude(Set(i)))
  }

  action undoLast = {
    val n = board.history.length()
    val last = board.history[n - 1]
    val r =
      if (MUTANT == "key-by-length") (if (board.restoreAt.keys().contains(n)) board.restoreAt.get(n) else noRestore)
      else last.restore
    val oldRule = MUTANT == "restore-always"
    val fieldNext = if (r.kind == "field") back(offer.field, r.fieldWas, r.fieldSet, oldRule) else offer.field
    val hasRow = r.kind == "row" and offer.rows.keys().contains(r.row)
    val rowNow = if (hasRow) offer.rows.get(r.row) else emptyRow
    val rowBack = {
      name: back(rowNow.name, r.rowWas.name, r.rowSet.name, oldRule),
      deliv: back(rowNow.deliv, r.rowWas.deliv, r.rowSet.deliv, oldRule),
      fee: back(rowNow.fee, r.rowWas.fee, r.rowSet.fee, oldRule),
    }
    // The editor's Remove milestone refuses the last row, so a row Use added stays when it is the only one.
    val remove =
      hasRow and r.added and MUTANT != "no-row-removal" and (oldRule or blank(rowBack))
        and (MUTANT == "remove-last-row" or offer.rows.keys().size() > 1)
    val rowsNext = if (not(hasRow)) offer.rows else if (remove) without(offer.rows, r.row) else offer.rows.set(r.row, rowBack)
    val offerNext = { ...offer, field: fieldNext, rows: rowsNext }
    val i = last.idea
    val restored = if (last.prev.status == "proposed") { ...last.prev, since: net.sent } else last.prev
    all {
      offer' = offerNext,
      board' = {
        ...board,
        cards: board.cards.set(i, restored),
        used: if (r.kind != "none" and not(r.usedWas)) board.used.exclude(Set(r.idea)) else board.used,
        usedIn: if (r.kind == "row" and MUTANT != "stale-used-in") board.usedIn.set(r.idea, r.usedInWas) else board.usedIn,
        history: board.history.slice(0, n - 1),
        restoreAt: if (MUTANT == "key-by-length") withoutRestore(board.restoreAt, n) else board.restoreAt,
        rejected: if (restored.status == "dismissed") board.rejected.union(Set(i)) else board.rejected.exclude(Set(i)),
        restoredAt: if (restored.status == "proposed") board.restoredAt.set(i, net.sent) else board.restoredAt,
      },
      net' = net,
      ghost' = {
        ...ghost,
        clobbered: ghost.clobbered
          or (ownerValue(offer.field) and fieldNext != offer.field)
          or (hasRow and (if (remove) holdsOwner(rowNow) else clobbers(rowNow, rowBack))),
        wrongRestore: ghost.wrongRestore or (r.kind != "none" and r.stepId != last.id),
        undoIncomplete: ghost.undoIncomplete
          or (offer.edits == last.edits and (offerNext.field != last.snapField or offerNext.rows != last.snapRows)),
      },
    }
  }

  action undo = all { board.history.length() > 0, undoLast }

  // ---- Requests and replies -------------------------------------------------------------------------------------------
  // Suggest (the owner's press) starts the board asking on its own; a request it makes itself is `auto`.
  action send(auto: bool): bool = all {
    net.sent < MAXREQ,
    net' = {
      ...net,
      live: net.live.union(Set(net.sent + 1)),
      sent: net.sent + 1,
      autoAsk: if (auto) net.autoAsk else true,
      failedSinceSuggest: if (auto) net.failedSinceSuggest else false,
    },
    offer' = offer,
    board' = board,
    ghost' = { ...ghost, autoAfterFail: ghost.autoAfterFail or (auto and net.failedSinceSuggest) },
  }

  action suggest = send(false)

  action autoSend = all { net.autoAsk, send(true) }

  action failRequest = {
    nondet n = net.live.oneOf()
    all {
      net' = {
        ...net,
        live: net.live.exclude(Set(n)),
        autoAsk: if (MUTANT == "retry-on-fail") net.autoAsk else false,
        failedSinceSuggest: true,
      },
      offer' = offer,
      board' = board,
      ghost' = ghost,
    }
  }

  // The card for idea i after reply n, which mentions `mention`: an open card it may change (its request was sent after the
  // card last became open) is updated, its milestone detail with it, or withdrawn; a new idea is added unless set aside.
  def replied(n: int, i: int, mention: Set[int]): Card = {
    val c = board.cards.get(i)
    val detail = if (ROW_IDEAS.contains(i)) n else 0
    if (c.status == "proposed" and n > c.since)
      (if (mention.contains(i)) { ...c, detail: detail } else { status: "absent", since: 0, detail: 0 })
    else if (c.status == "absent" and mention.contains(i)) { status: "proposed", since: net.sent, detail: detail }
    else if (c.status == "proposed" and mention.contains(i) and MUTANT == "detail-ignores-since") { ...c, detail: detail }
    else if (c.status != "absent" and mention.contains(i) and MUTANT == "detail-on-owned") { ...c, detail: detail }
    else c
  }

  action deliver = {
    nondet n = net.live.oneOf()
    nondet mention = IDEAS.powerset().oneOf()
    val stale = n <= net.applied
    val updated = IDEAS.mapBy(i => replied(n, i, mention))
    val changed = IDEAS.filter(i => updated.get(i) != board.cards.get(i))
    all {
      net' = { ...net, live: net.live.exclude(Set(n)), applied: if (stale) net.applied else n },
      board' = if (stale) board else { ...board, cards: updated },
      offer' = offer,
      ghost' =
        if (stale) ghost
        else {
          ...ghost,
          ownedTouched: ghost.ownedTouched or changed.exists(i => owned(board.cards.get(i))),
          undoReverted: ghost.undoReverted or changed.exists(i => n <= board.restoredAt.get(i)),
        },
    }
  }

  action step = any {
    typeField, typeRow, addRow, removeRow, useAny, feeAny, edit, setAside, bringBack, undo, suggest, autoSend, deliver,
    failRequest,
  }

  // For the Apalache check only (`--step stepOrEnd`).
  action finished = all { offer' = offer, board' = board, net' = net, ghost' = ghost }
  action stepOrEnd = any { step, finished }

  // ---- Properties -----------------------------------------------------------------------------------------------------
  // 1. Nothing the board does writes over words the owner typed (Use into the one field the owner chose to replace aside):
  //    not Undo, not a milestone's Use, not Set its fee beyond the fee itself.
  val ownerWordsKept = not(ghost.clobbered)

  // 2. Undo puts back what the step it undoes changed, never another step's.
  val undoMatchesStep = not(ghost.wrongRestore)

  // 3. Every Use that changes the offer is a step Undo can reach.
  val everyUseUndoable = not(ghost.useWithoutStep)

  // 4. A milestone's Use never writes into a row that holds another milestone.
  val useNeverOverwritesOther = not(ghost.overwroteOther)

  // 5. A reply never changes a card the owner used, kept, edited or set aside, nor its milestone detail.
  val ownedUntouched = not(ghost.ownedTouched)

  // 6. A reply never changes a card (or its detail) that Undo reopened after that reply's request was sent.
  val undoRespected = not(ghost.undoReverted)

  // 7. After a failed request the board asks again only when the owner presses Suggest.
  val noAutoAfterFailure = not(ghost.autoAfterFail)

  // 8. When the owner has not touched the offer since a step, its Undo gives back the offer exactly as it was before it.
  val undoComplete = not(ghost.undoIncomplete)

  // The offer keeps one to MAXROWS rows.
  val rowsBounded = offer.rows.keys().size() >= 1 and offer.rows.keys().size() <= MAXROWS

  val allProperties = and {
    ownerWordsKept, undoMatchesStep, everyUseUndoable, useNeverOverwritesOther, ownedUntouched, undoRespected,
    noAutoAfterFailure, undoComplete, rowsBounded,
  }

  // Reachability witness, for a hand check with the negated invariant: both milestones in the offer, one in a row Use added.
  val bothMilestonesUsed = board.used.contains(3) and board.used.contains(4) and offer.rows.keys().size() == 2
  val neverBothMilestonesUsed = not(bothMilestonesUsed)
}

module offerBoard { import offerBoardModel(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module offerKeyByLength { import offerBoardModel(MUTANT = "key-by-length").* }
module offerRestoreAlways { import offerBoardModel(MUTANT = "restore-always").* }
module offerKeepOnlyProposed { import offerBoardModel(MUTANT = "keep-only-proposed").* }
module offerFeeIsUse { import offerBoardModel(MUTANT = "fee-is-use").* }
module offerStaleUsedIn { import offerBoardModel(MUTANT = "stale-used-in").* }
module offerDetailIgnoresSince { import offerBoardModel(MUTANT = "detail-ignores-since").* }
module offerRetryOnFail { import offerBoardModel(MUTANT = "retry-on-fail").* }
module offerNameOnlyEmpty { import offerBoardModel(MUTANT = "name-only-empty").* }
module offerNoRowRemoval { import offerBoardModel(MUTANT = "no-row-removal").* }
module offerRemoveLastRow { import offerBoardModel(MUTANT = "remove-last-row").* }
module offerDetailOnOwned { import offerBoardModel(MUTANT = "detail-on-owned").* }
