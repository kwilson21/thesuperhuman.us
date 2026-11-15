// Quint model of the client's copy of a software brief: the claim that decides who may send it, for owner clicks and the
// public form's own copy that arrive at once. Written for the conversion of the owner brief copy route.
// Code modelled, step for step as the code reads and writes:
//   the read:       src/server/flows/brief-copy.ts: one read of the request row (one step: whether it is open, the copy's
//                   status and the instant of the attempt that recorded it). The instant `at` of the delivery is taken once,
//                   before the first read, and a retry keeps it.
//   the rule:       src/server/rules/brief-copy.ts, a pure decision over what was read. The public form's copy (the first copy)
//                   is claimed only when no status is recorded. The owner's resend is claimed when no status is recorded or
//                   the last one is "failed", and when it is "uncertain" only with the owner's confirmation and only once the
//                   hold (60 seconds) since that attempt has passed. A request that is resolved or withdrawn is never claimed,
//                   and a sent copy is never claimed again.
//   the claim:      src/server/intake-store.ts, a compare-and-set (one step) that writes status "uncertain" and the instant,
//                   only while the row is still as it was read. A lost set reads and judges again, three tries in all.
//   the send:       the provider's call, after the claim and only for the run that won it (one step; the answer is "sent",
//                   "refused" or "uncertain").
//   the record:     the final write (one step), only while the row still carries this run's own attempt instant.
// The address is part of the row: the rule refuses a request with no address, and the claim re-checks it (as it re-checks the
// status, the attempt instant and whether the request is open), so a claim never lands over a row whose address went away.
// What is left out, on purpose: the unconfigured mail keys (a run that
// never asks the provider records "failed" at once, which is the "refused" path here), the answers the route gives, and the two
// writes that record a failure when the claim or the answer could not be written (the one over a copy with no status, and the
// one over this run's own attempt): each is guarded as the claim and the final write are, and writes only "failed".
//
// The properties are invariants over the real state, set from what each step found in the row at that moment, never from
// what the run believed: `claims` records the row each claim overwrote, `overwrites` each final write that changed a row
// carrying another run's attempt.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
module briefCopyClaim {
  // "none" is the design. Every other value removes one protection so a property must fail (the mutants):
  //   "no-cas"          the claim does not re-check the row: two runs that both read it claimable both claim it
  //   "cas-skips-open"  the claim re-checks the status and the instant but not whether the request is still open
  //   "cas-skips-att"   the claim re-checks the status, the address and whether the request is open but not the attempt instant
  //   "cas-skips-addr"  the claim re-checks the status, the instant and whether the request is open but not the address
  //   "no-hold"         the owner's resend claims an "uncertain" copy without waiting for the hold
  //   "no-confirm"      the owner's resend claims an "uncertain" copy without the owner's confirmation
  //   "resend-sent"     the owner's resend claims a copy that was sent
  //   "public-again"    the public form's copy is claimed again after a failure
  //   "ignore-closed"   the rule does not look at whether the request is open
  //   "no-claim"        the run sends without writing a claim
  //   "final-unguarded" the final write does not check the row still carries this run's attempt
  const MUTANT: str

  val HOLD = 2
  val TMAX = 5
  val TRIES = 3
  val RUNS = 1.to(3)

  // The row: whether the request is open (not resolved or withdrawn), whether it has an address to send to, the copy's status
  // ("none", "failed", "uncertain" or "sent") and the instant of the attempt that recorded it (-1 when none).
  type Row = { open: bool, addr: bool, st: str, att: int }

  // A run: its mode ("public" or "owner"), whether the owner confirmed, its phase ("none", "start", "read", "claimed",
  // "sent", "done"), its instant `at` (kept across retries), the row as it read it, the tries, what the provider answered and
  // how it ended ("none", "refused", "kept-changing", "recorded").
  type Run = { phase: str, mode: str, confirmed: bool, at: int, seen: Row, tries: int, answer: str, outcome: str }

  // A claim as it was made: who, and the real row it overwrote (never what the run had read).
  type Claim = { by: int, mode: str, confirmed: bool, at: int, from: Row }

  var now: int
  var row: Row
  var runs: int -> Run
  var claims: Set[Claim]
  // The runs that asked the provider.
  var sends: Set[int]
  // The final writes that changed a row carrying another run's attempt: who, and the instant of the attempt it overwrote.
  var overwrites: Set[{ by: int, over: int }]

  val idleRow = { open: true, addr: true, st: "none", att: -1 }
  val idle = { phase: "none", mode: "none", confirmed: false, at: -1, seen: idleRow, tries: 0, answer: "none", outcome: "none" }

  // The design's rule: what may be claimed.
  pure def eligible(mode: str, confirmed: bool, at: int, r: Row): bool =
    r.open and r.addr and (
      if (mode == "public") r.st == "none"
      else r.st == "none" or r.st == "failed" or (r.st == "uncertain" and confirmed and r.att + HOLD <= at)
    )

  // The rule as the code under test has it: the design's, with the mutant's change.
  pure def decides(m: str, mode: str, confirmed: bool, at: int, r: Row): bool =
    (r.open or m == "ignore-closed") and r.addr and (
      if (mode == "public") r.st == "none" or (m == "public-again" and r.st == "failed")
      else r.st == "none" or r.st == "failed" or (m == "resend-sent" and r.st == "sent") or
        (r.st == "uncertain" and (confirmed or m == "no-confirm") and (r.att + HOLD <= at or m == "no-hold"))
    )

  // The guard of the claim: the row is as it was read.
  pure def unchanged(m: str, seen: Row, r: Row): bool =
    m == "no-cas" or (
      seen.st == r.st and (seen.att == r.att or m == "cas-skips-att") and
      (seen.open == r.open or m == "cas-skips-open") and (seen.addr == r.addr or m == "cas-skips-addr"))

  // The model starts with a fresh request, or with one whose earlier attempt left the copy uncertain (the attempt at instant 0).
  action init = {
    nondet start = Set(idleRow, { ...idleRow, st: "uncertain", att: 0 }).oneOf()
    all {
      now' = 0,
      row' = start,
      runs' = RUNS.mapBy(r => idle),
      claims' = Set(),
      sends' = Set(),
      overwrites' = Set(),
      }
  }

  // Time passes.
  action tick = all {
    now < TMAX,
    now' = now + 1,
    row' = row,
    runs' = runs,
    claims' = claims,
    sends' = sends,
    overwrites' = overwrites,
  }

  // The request is resolved or withdrawn.
  action close = all {
    row.open,
    now' = now,
    row' = { ...row, open: false },
    runs' = runs,
    claims' = claims,
    sends' = sends,
    overwrites' = overwrites,
  }

  // The request loses its address.
  action blank = all {
    row.addr,
    now' = now,
    row' = { ...row, addr: false },
    runs' = runs,
    claims' = claims,
    sends' = sends,
    overwrites' = overwrites,
  }

  // A delivery starts, for the public form's copy or an owner's resend (confirmed or not), and takes its instant.
  action ask = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "none").oneOf()
    nondet owner = Set(true, false).oneOf()
    nondet confirmed = Set(true, false).oneOf()
    all {
      now' = now,
      row' = row,
      runs' = runs.set(r, { ...idle, phase: "start", mode: if (owner) "owner" else "public", confirmed: owner and confirmed, at: now }),
      claims' = claims,
      sends' = sends,
      overwrites' = overwrites,
    }
  }

  // The read and the rule: one read of the row, then the pure decision. A copy that may not be claimed ends the run.
  action readRow = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "start").oneOf()
    val h = runs.get(r)
    val ok = decides(MUTANT, h.mode, h.confirmed, h.at, row)
    all {
      now' = now,
      row' = row,
      runs' = runs.set(r, if (ok) { ...h, phase: "read", seen: row } else { ...h, phase: "done", seen: row, outcome: "refused" }),
      claims' = claims,
      sends' = sends,
      overwrites' = overwrites,
    }
  }

  // The claim: a compare-and-set against the row as it was read. A lost set reads and judges again (three tries); the run
  // keeps its instant.
  action claim = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "read").oneOf()
    val h = runs.get(r)
    val won = unchanged(MUTANT, h.seen, row)
    val wrote = won and MUTANT != "no-claim"
    val retry = not(won) and h.tries + 1 < TRIES
    all {
      now' = now,
      row' = if (wrote) { ...row, st: "uncertain", att: h.at } else row,
      runs' = runs.set(r,
        if (won) { ...h, phase: "claimed" }
        else if (retry) { ...h, phase: "start", tries: h.tries + 1 }
        else { ...h, phase: "done", tries: h.tries + 1, outcome: "kept-changing" }),
      claims' = if (wrote) claims.union(Set({ by: r, mode: h.mode, confirmed: h.confirmed, at: h.at, from: row })) else claims,
      sends' = sends,
      overwrites' = overwrites,
    }
  }

  // The provider is asked, by a run that won its claim.
  action send = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "claimed").oneOf()
    nondet answer = Set("sent", "refused", "uncertain").oneOf()
    val h = runs.get(r)
    all {
      now' = now,
      row' = row,
      runs' = runs.set(r, { ...h, phase: "sent", answer: answer }),
      claims' = claims,
      sends' = sends.union(Set(r)),
      overwrites' = overwrites,
    }
  }

  // The final write: the provider's answer is recorded, only while the row still carries this run's attempt.
  action record = {
    nondet r = RUNS.filter(i => runs.get(i).phase == "sent").oneOf()
    val h = runs.get(r)
    val mine = row.att == h.at
    val writes = mine or MUTANT == "final-unguarded"
    val st = if (h.answer == "sent") "sent" else if (h.answer == "refused") "failed" else "uncertain"
    all {
      now' = now,
      row' = if (writes) { ...row, st: st } else row,
      runs' = runs.set(r, { ...h, phase: "done", outcome: "recorded" }),
      claims' = claims,
      sends' = sends,
      overwrites' = if (writes and not(mine)) overwrites.union(Set({ by: r, over: row.att })) else overwrites,
    }
  }

  action step = any { tick, close, blank, ask, readRow, claim, send, record }

  // ---- Properties: invariants over the real state ---------------------------------------------------------------------
  // 1. Every claim was made over a row the rule would have let it claim. (The master property: a claim made from a stale
  //    read, or by a rule that is too loose, breaks it.)
  val claimsEligible = claims.forall(c => eligible(c.mode, c.confirmed, c.at, c.from))

  // 2. A request that is resolved or withdrawn is never claimed.
  val closedNeverClaimed = claims.forall(c => c.from.open)

  // 3. A copy that was sent is never claimed again.
  val sentNeverResent = claims.forall(c => c.from.st != "sent")

  // 4. A copy the provider may or may not have sent is claimed again only by an owner who confirmed, and only after the hold.
  val uncertainHeld = claims.forall(c =>
    c.from.st != "uncertain" or (c.mode == "owner" and c.confirmed and c.from.att + HOLD <= c.at))

  // 5. The public form's copy is claimed only while no status is recorded.
  val publicOnlyFirst = claims.forall(c => c.mode != "public" or c.from.st == "none")

  // 6. Only a run that wrote a claim asks the provider.
  val everySendClaimed = sends.forall(r => claims.exists(c => c.by == r))

  // 7. The final write never changes a row that carries another run's attempt.
  val finalOnlyOwn = overwrites.size() == 0

  val allProperties = and {
    claimsEligible, closedNeverClaimed, sentNeverResent, uncertainHeld, publicOnlyFirst, everySendClaimed, finalOnlyOwn,
  }
}

module briefCopy { import briefCopyClaim(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module briefCopyNoCas { import briefCopyClaim(MUTANT = "no-cas").* }
module briefCopyCasSkipsOpen { import briefCopyClaim(MUTANT = "cas-skips-open").* }
module briefCopyCasSkipsAttempt { import briefCopyClaim(MUTANT = "cas-skips-att").* }
module briefCopyCasSkipsAddress { import briefCopyClaim(MUTANT = "cas-skips-addr").* }
module briefCopyNoHold { import briefCopyClaim(MUTANT = "no-hold").* }
module briefCopyNoConfirm { import briefCopyClaim(MUTANT = "no-confirm").* }
module briefCopyResendSent { import briefCopyClaim(MUTANT = "resend-sent").* }
module briefCopyPublicAgain { import briefCopyClaim(MUTANT = "public-again").* }
module briefCopyIgnoreClosed { import briefCopyClaim(MUTANT = "ignore-closed").* }
module briefCopyNoClaim { import briefCopyClaim(MUTANT = "no-claim").* }
module briefCopyFinalUnguarded { import briefCopyClaim(MUTANT = "final-unguarded").* }
