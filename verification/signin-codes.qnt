// Quint model of the studio sign-in codes of email addresses, with browsers that know the address and, for some of them, the code.
// Code modelled: src/lib/audio-client-access.ts (issueClientCode, completeClientCode, discardUndeliveredCode), the routes
//   src/pages/api/studio/code.ts and session.ts, and the pending sign-in cookie they set and read.
// See docs/verification.md ("The sign-in codes model") for what is and is not covered.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
//
// A code is keyed by the browser's cookie value AND the address (the table's primary key is (nonce_hash, email)): a browser holds
// at most one row per address under its value, and a request for an address reads, writes and deletes only that address's rows.
//
// The numbers are scaled down from the code so a search can reach the interesting states. Ratios are kept:
//   attempts per code   LIMIT 2   (code: 5)
//   emails per window   EMAILS 2  (code: 3, the "code-email" allowance, kept per address)
//   window              WINDOW 2 ticks (code: 5 minutes)
//   code lifetime       LIFE 2 ticks   (code: 10 minutes, two windows)
//   pause               THROTTLE 1 tick: the 30 second pause of an old code, kept only by the mutants that model it
//   live codes per address CAP 1 (code: 6): the smallest cap a random search reaches at once; what is checked is that the cap holds,
//   is never made room for by dropping another browser's live code, and cannot be got past by a write.
//
// Two addresses (1 and 2), each with a project that is open to begin with and that can be closed between a read and a write. Browsers:
// 0 is the client's own (it holds a value from an earlier visit), 1 is the client's other browser (it can read the client's
// inbox, so it knows every delivered code, but holds no cookie until it asks for a code), 2 is a stranger who knows the address and
// never learns a code (it also holds a value), 3 is another stranger with none. Any browser can ask for a code (a stranger solves
// the captcha), and each browser holds at most one pending cookie value.
module signinCodes {
  // "none" is the code as it is built. Every other value changes one thing so a property must fail (the mutants):
  //   "single-row"           one row per address: a new request replaces the address's row once it is older than the pause
  //                          (the code before the cookie binding, table keyed by email)
  //   "address-attempts"     a guess charges the attempts of the address's live rows, whoever sends it (the code before the cookie binding)
  //   "replace-live"         a request from another browser changes the live code in place (the code before the cookie binding)
  //   "cookie-not-required"  a correct code signs in without the pending sign-in cookie (the code before the cookie binding)
  //   "evict-oldest"         a full address makes room by removing the oldest live row instead of refusing the new request
  //   "no-attempt-cap"       the attempt limit is not enforced
  //   "no-allowance"         the emails-per-window allowance is not enforced
  //   "no-row-cap"           the live-row cap is not enforced
  //   "ignore-expiry"        an expired code still signs in
  //   "reuse-used"           a used code signs in again
  //   "fresh-cookie"         each request answers with a fresh cookie value, a refused one with an unrelated value; with two requests
  //                          from one browser in flight, the later response can overwrite the cookie of the code the earlier one emailed
  //   "charge-any-version"   the attempt is counted on the browser's row whatever its stored code is, so a code issued after the guess was
  //                          read is charged
  //   "no-open-guard"        the write does not re-check that a project is still open: a code and its audit row are written for a
  //                          project closed after the facts were read
  //   "accept-no-open-guard" the sign-in does not re-check that a project is still open
  //   "no-cap-guard"         the write does not re-check the address's live codes, only the count read earlier
  //   "no-replace"           the write inserts without replacing the browser's row for the same address, so a second insert under the
  //                          same key collides and the request that issues answers with an error where a refusal answers normally
  //   "sweep-unguarded"      the clean-up deletes the expired rows it read by key without checking that each still holds the code that was
  //                          read, so a code stored under the same key in the gap is deleted
  //   "entry-by-cookie"      the counted attempt and the sign-in of an entry match the row by the cookie value alone, so the browser's row
  //                          for the other address is charged and signed in too, and its audit entry is written
  //   "delete-by-cookie"     a request deletes the browser's rows by cookie value alone, whatever the address (the code of the previous four
  //                          rounds): a request for one address changes the fate of a row for another, depending on the first's state
  const MUTANT: str

  val LIMIT = 2
  val EMAILS = 2
  val WINDOW = 2
  val LIFE = 2
  val THROTTLE = 1
  val CAP = 1
  val MAX_ROWS = 5     // cookie values handed out in one run (1..5)
  val MAX_NOW = 10     // ticks in one run
  val MAX_FLIGHTS = 3  // code requests in progress at once, from any browsers
  val MAX_GUESSES = 1  // entries of a code in progress at once
  val CLIENT = 0
  val STRANGER = 2

  // The row of (cookie value v, address a): one key each (the table's primary key).
  pure def key(v: int, a: int): int = v * 2 + a - 1

  // issued: the key has been used. owner: the browser whose cookie value it is. addr: its address. ver: how many codes this key has held
  // (a replaced code is a new version). delivered: the email reached the inbox, so browsers 0 and 1 know the code (modelled as immediate).
  // attempts: the stored count. own: guesses its owner made that were charged (a ghost). compared: guesses actually compared with the code
  // (a ghost). rehashed: a browser other than the owner changed the code (a ghost).
  type Row = {
    issued: bool, owner: int, addr: int, ver: int, delivered: bool, attempts: int, own: int, compared: int,
    created: int, expires: int, used: bool, present: bool, rehashed: bool,
  }
  // A code request is four steps, matching the code's batches: the server READS the address's facts (sendRead), then runs the CLEAN-UP
  // batch (sendClear: the address's expired rows), then WRITES in one guarded batch after other steps may have changed the facts
  // (sendWrite), then the browser receives the response and stores the cookie value it carries (receive). Several can be in flight.
  // phase: "idle", "read", "cleared", "sent" (written, response on its way; err: the write failed on the table's key, so the route
  // answers 503 and sets no cookie).
  type Flight = {
    phase: str, b: int, a: int, value: int, c: int, bare: bool, err: bool,
    sOpen: bool, sLiveOthers: int,
    sExp: Set[int], sExpVer: int -> int,  // the address's expired rows read (their keys and which code each held), to be swept by key
  }
  // Entering a code is two steps: READ the row of (the browser's value, the address) (guessRead), then the guarded writes (guessWrite).
  type Guess = {
    phase: str, b: int, a: int, t: int, right: bool, c: int,
    sPresent: bool, sUsed: bool, sExp: int, sAtt: int, sVer: int, sOpen: bool,
  }
  type Ghost = {
    noCookieSignIn: bool,   // a sign-in happened for a browser whose cookie was not the row's
    badSignIn: bool,        // a used or expired code signed someone in
    clientRejected: bool,   // the client entered its own valid code with attempts left and was refused
    badCharge: bool,        // an attempt was counted on, or a sign-in accepted for, a code other than the one the guess read
    badAudit: bool,         // an audit row was written for a project that was closed
    badSweep: bool,         // a request's clean-up removed a code that was live (unused and unexpired) when it ran
    badOutcome: bool,       // a code request ended in an error, which only a request that issues can do: its outcome depends on the address
    badFrame: bool,         // a request or entry for one address changed a row of another address
  }

  var rows: int -> Row
  var cookie: int -> int    // browser -> the pending cookie value it holds, 0 none
  var now: int
  var nextId: int
  var winStart: int -> int  // address -> when its allowance window opened
  var winUses: int -> int   // address -> emails allowed in its current window
  var ghost: Ghost
  var flights: int -> Flight
  var lastIssued: int -> int  // browser -> the cookie value of its latest request that issued a code (a ghost), 0 none
  var exempt: Set[int]        // browsers that sent two cookie-less requests at once (a ghost; see property 8)
  var open: int -> bool       // address -> its project is open
  var gflights: int -> Guess
  var audit: int -> int       // address -> audit entries written for its projects (code issued, signed in)

  val blank: Row = {
    issued: false, owner: 0, addr: 0, ver: 0, delivered: false, attempts: 0, own: 0, compared: 0,
    created: 0, expires: 0, used: false, present: false, rehashed: false,
  }

  val idleFlight: Flight = {
    phase: "idle", b: 0, a: 0, value: 0, c: 0, bare: false, err: false, sOpen: false, sLiveOthers: 0, sExp: Set(), sExpVer: Map(),
  }
  val idleGuess: Guess = {
    phase: "idle", b: 0, a: 0, t: 0, right: false, c: 0,
    sPresent: false, sUsed: false, sExp: 0, sAtt: 0, sVer: 0, sOpen: false,
  }

  pure def isLive(r: Row, t: int): bool = r.issued and r.present and not(r.used) and t < r.expires

  // What the completing write accepts (the guard re-checking what the guess read). The mutants relax it.
  pure def accepts(r: Row, t: int): bool =
    r.issued and r.present and (MUTANT == "reuse-used" or not(r.used)) and (MUTANT == "ignore-expiry" or t < r.expires)

  pure def hasAttempts(r: Row): bool = MUTANT == "no-attempt-cap" or r.attempts < LIMIT

  pure def minOf(ids: Set[int]): int = ids.fold(1000, (m, i) => if (i < m) i else m)

  // The rows of an address that have expired: what the code's read of the address's rows returns for the clean-up.
  def expiredAt(a: int): Set[int] =
    rows.keys().filter(i => rows.get(i).issued and rows.get(i).present and rows.get(i).addr == a and now >= rows.get(i).expires)

  def liveAt(a: int): Set[int] = rows.keys().filter(i => isLive(rows.get(i), now) and rows.get(i).addr == a)

  // Whether a step changed a row of an address other than a.
  pure def foreignChange(before: int -> Row, after: int -> Row, a: int): bool =
    before.keys().exists(i => before.get(i).addr != a and before.get(i).addr != 0 and before.get(i) != after.get(i))

  // Whether a step changed the audit entries of an address other than a.
  pure def foreignAudit(before: int -> int, after: int -> int, a: int): bool =
    1.to(2).exists(x => x != a and before.get(x) != after.get(x))

  action init = all {
    rows' = 2.to(11).mapBy(_ => blank),
    // Browsers 0 (the client's) and 2 (a stranger) already hold a pending value from an earlier visit; browsers 1 and 3 hold none,
    // so both starts are explored.
    cookie' = Map(0 -> 1, 1 -> 0, 2 -> 2, 3 -> 0),
    now' = 0, nextId' = 3, winStart' = Map(1 -> 0, 2 -> 0), winUses' = Map(1 -> 0, 2 -> 0),
    ghost' = {
      noCookieSignIn: false, badSignIn: false, clientRejected: false, badCharge: false, badAudit: false, badSweep: false,
      badOutcome: false, badFrame: false,
    },
    flights' = 1.to(MAX_FLIGHTS).mapBy(_ => idleFlight),
    lastIssued' = 0.to(3).mapBy(_ => 0),
    exempt' = Set(),
    open' = Map(1 -> true, 2 -> true),
    gflights' = 1.to(MAX_GUESSES).mapBy(_ => idleGuess),
    audit' = Map(1 -> 0, 2 -> 0),
  }

  // ---- Asking for a code (code.ts, issueClientCode) ----------------------------------------------------------------
  // READ. The browser sends its pending cookie, if any. The allowance counts first (a fixed window opened by its first use, one per
  // address). The facts are read the same way whatever the address, and only about this address: whether its project is open, how
  // many live codes it has other than the browser's own, and its expired rows. A browser with no cookie is given a newly allocated
  // value; one with a cookie keeps it (the "fresh-cookie" mutant gives every request a fresh one).
  action sendRead(f: int, b: int, a: int): bool = {
    val c = cookie.get(b)
    val windowOpen = winUses.get(a) > 0 and now - winStart.get(a) < WINDOW
    val usesNow = if (windowOpen) winUses.get(a) else 0
    val allowed = MUTANT == "no-allowance" or usesNow < EMAILS
    val alloc = MUTANT == "fresh-cookie" or c == 0
    val value = if (alloc) nextId else c
    val bareFlight = flights.keys().exists(g => flights.get(g).phase != "idle" and flights.get(g).b == b and flights.get(g).bare)
    all {
      allowed,
      flights.get(f).phase == "idle",
      not(alloc) or nextId <= MAX_ROWS,
      winStart' = winStart.set(a, if (windowOpen) winStart.get(a) else now),
      winUses' = winUses.set(a, usesNow + 1),
      nextId' = if (alloc) nextId + 1 else nextId,
      flights' = flights.set(f, {
        phase: "read", b: b, a: a, value: value, c: c, bare: c == 0, err: false,
        sOpen: open.get(a), sLiveOthers: liveAt(a).filter(i => i != key(c, a)).size(),
        sExp: expiredAt(a), sExpVer: expiredAt(a).mapBy(i => rows.get(i).ver) }),
      exempt' = if (c == 0 and bareFlight) exempt.union(Set(b)) else exempt,
      rows' = rows, cookie' = cookie, now' = now, ghost' = ghost, lastIssued' = lastIssued, open' = open, gflights' = gflights, audit' = audit
    }
  }

  // CLEAN-UP (the code's second batch, run for every outcome). The expired rows of this address named at the read are deleted by key,
  // but only a row that still holds the code that was read and is still expired (the "sweep-unguarded" mutant deletes whatever now
  // holds the key). It touches no row of another address. The "delete-by-cookie" mutant also deletes the browser's row for the
  // other address, as the code of the previous four rounds did.
  action sendClear(f: int): bool = {
    val fl = flights.get(f)
    val c = fl.c
    val swept = fl.sExp.filter(i => rows.get(i).present and (MUTANT == "sweep-unguarded" or (rows.get(i).ver == fl.sExpVer.get(i) and now >= rows.get(i).expires)))
    val afterSweep = rows.keys().mapBy(i => if (swept.contains(i)) { ...rows.get(i), present: false } else rows.get(i))
    val other = key(c, 3 - fl.a)
    val newRows =
      if (MUTANT == "delete-by-cookie" and c != 0 and afterSweep.get(other).present) afterSweep.set(other, { ...afterSweep.get(other), present: false })
      else afterSweep
    all {
      fl.phase == "read",
      rows' = newRows,
      flights' = flights.set(f, { ...fl, phase: "cleared" }),
      ghost' = { ...ghost,
        badSweep: ghost.badSweep or swept.exists(i => isLive(rows.get(i), now)),
        badFrame: ghost.badFrame or foreignChange(rows, newRows, fl.a) },
      cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, lastIssued' = lastIssued, exempt' = exempt, open' = open, gflights' = gflights, audit' = audit
    }
  }

  // WRITE (the code's third batch). The rule decided from what was read: issue when the project was open and the address had
  // room. The write is one guarded batch about this address only: the code is issued only if, now, the project is still open and the
  // address's live codes other than the browser's own are still under the cap (otherwise nothing is issued and the request is
  // answered like a refusal; there is no retry). The table has one row per (cookie value, address): an issuing write first deletes the
  // row that holds the browser's value for this address, then inserts. The "no-replace" mutant does not delete, so the insert
  // collides on the key and the route answers 503.
  action sendWrite(f: int): bool = {
    val fl = flights.get(f)
    val b = fl.b
    val a = fl.a
    val c = fl.c
    val k = key(fl.value, a)
    val liveIds = liveAt(a)
    val liveOthersNow = liveIds.filter(i => i != key(c, a)).size()
    val anyYoung = liveIds.exists(i => rows.get(i).created + THROTTLE > now)
    // An old code answered "sent" without a new code when the address's row was under 30 seconds old. The code has no pause: a browser
    // that asks again replaces its own row, and the email allowance bounds the mail.
    val throttled = (MUTANT == "single-row" or MUTANT == "replace-live") and anyYoung
    val roomRead = MUTANT == "no-row-cap" or MUTANT == "evict-oldest" or fl.sLiveOthers < CAP
    val decided = fl.sOpen and roomRead and not(throttled)
    val guardOpen = MUTANT == "no-open-guard" or open.get(a)
    val guardRoom = MUTANT == "no-cap-guard" or MUTANT == "no-row-cap" or MUTANT == "evict-oldest" or liveOthersNow < CAP
    val issueOk = decided and guardOpen and guardRoom
    val fresh: Row = {
      issued: true, owner: b, addr: a, ver: rows.get(k).ver + 1, delivered: true, attempts: 0, own: 0, compared: 0,
      created: now, expires: now + LIFE, used: false, present: true, rehashed: false,
    }
    // replace-live: the code of the oldest live row is changed in place and the requester's cookie now names it.
    val target = minOf(liveIds)
    val replaceInPlace = MUTANT == "replace-live" and liveIds.size() > 0 and not(throttled) and fl.sOpen
    val wantsInsert = issueOk and not(replaceInPlace)
    val collision = wantsInsert and MUTANT == "no-replace" and rows.get(k).present
    val insert = wantsInsert and not(collision)
    val oldest = minOf(liveIds.filter(i => i != key(c, a)))
    val removed: Set[int] =
      if (MUTANT == "single-row") rows.keys()
      else if (MUTANT == "evict-oldest" and liveOthersNow >= CAP and insert) Set(oldest)
      else if (MUTANT == "fresh-cookie") Set(key(c, a))
      else Set()
    val cleared = rows.keys().mapBy(i => if (removed.contains(i)) { ...rows.get(i), present: false } else rows.get(i))
    val newRows =
      if (collision) rows
      else if (replaceInPlace)
        rows.set(target, { ...rows.get(target), delivered: true, attempts: 0, created: now, expires: now + LIFE,
          rehashed: rows.get(target).rehashed or rows.get(target).owner != b })
      else if (insert) cleared.set(k, fresh)
      else cleared
    val newAudit = if (insert or replaceInPlace) audit.set(a, audit.get(a) + 1) else audit
    all {
      fl.phase == "cleared",
      rows' = newRows,
      flights' = flights.set(f, { ...fl, phase: "sent", err: collision }),
      lastIssued' = if (insert or replaceInPlace) lastIssued.set(b, fl.value) else lastIssued,
      ghost' = { ...ghost,
        badAudit: ghost.badAudit or (insert and not(open.get(a))),
        badOutcome: ghost.badOutcome or collision,
        badFrame: ghost.badFrame or foreignChange(rows, newRows, a) or foreignAudit(audit, newAudit, a) },
      audit' = newAudit,
      cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, exempt' = exempt, open' = open, gflights' = gflights
    }
  }

  // The browser receives the response and stores the cookie value it carries (nothing after an error).
  action receive(f: int): bool = all {
    flights.get(f).phase == "sent",
    cookie' = if (flights.get(f).err) cookie else cookie.set(flights.get(f).b, flights.get(f).value),
    flights' = flights.set(f, idleFlight),
    rows' = rows, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost, lastIssued' = lastIssued, exempt' = exempt, open' = open, gflights' = gflights, audit' = audit
  }

  // A project is closed (by the owner) between a read and the write that relies on it: only a closing in such a gap can change an
  // outcome, and a closing anywhere else only shortens the run (nothing can be issued afterwards).
  action closeProject(a: int): bool = all {
    open.get(a),
    flights.keys().exists(f => flights.get(f).phase != "idle" and flights.get(f).phase != "sent" and flights.get(f).a == a)
      or gflights.keys().exists(g => gflights.get(g).phase == "read" and gflights.get(g).a == a),
    open' = open.set(a, false),
    rows' = rows, cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost, flights' = flights, lastIssued' = lastIssued, exempt' = exempt, gflights' = gflights, audit' = audit
  }

  // ---- Entering a code (session.ts, completeClientCode) ------------------------------------------------------------
  // Browser b sends its pending cookie (if any), the address and the code of row t. A browser can send the right code only if it can
  // read the inbox (browsers 0 and 1); the strangers always send a wrong code. READ: the row of (the browser's value, the address), as
  // it is (present, used, expiry, attempts, which code it holds, whether the address's project is open). Without a cookie nothing is
  // looked up.
  action guessRead(g: int, b: int, a: int, t: int, right: bool): bool = {
    val c = cookie.get(b)
    val r = if (c != 0) rows.get(key(c, a)) else blank
    all {
      gflights.get(g).phase == "idle",
      rows.get(t).issued,
      right implies (b < STRANGER and rows.get(t).delivered),
      gflights' = gflights.set(g, {
        phase: "read", b: b, a: a, t: t, right: right, c: c,
        sPresent: r.present, sUsed: r.used, sExp: r.expires, sAtt: r.attempts, sVer: r.ver, sOpen: open.get(a) }),
      rows' = rows, cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost, flights' = flights, lastIssued' = lastIssued, exempt' = exempt, open' = open, audit' = audit
    }
  }

  // WRITE. The rule (decideComplete) decides from what was read: count the attempt if the code was live with attempts left, and accept
  // if it is also the right code and the project was open. The write is guards re-checking, now, the same facts and that the row still
  // holds the code that was read: the attempt is counted only on that code (the "charge-any-version" mutant counts it on whatever code
  // the row holds now), and the sign-in needs the counted attempt, the same code, and a project still open. Only this address's row
  // changes.
  action guessWrite(g: int): bool = {
    val fl = gflights.get(g)
    val b = fl.b
    val c = fl.c
    val t = fl.t
    val right = fl.right
    val k = key(c, fl.a)
    val r = if (c != 0) rows.get(k) else blank
    val rt = rows.get(t)
    val chargeable = c != 0 and fl.sPresent and (MUTANT == "reuse-used" or not(fl.sUsed)) and (MUTANT == "ignore-expiry" or now < fl.sExp)
      and (MUTANT == "no-attempt-cap" or fl.sAtt < LIMIT)
    val matches = right and t == k
    val sameCode = r.ver == fl.sVer
    val charged = chargeable and accepts(r, now) and hasAttempts(r) and (MUTANT == "charge-any-version" or sameCode)
    val success = charged and matches and fl.sOpen and (MUTANT == "accept-no-open-guard" or open.get(fl.a))
    val shouldSucceed = c != 0 and t == k and right and r.issued and r.present and sameCode and not(r.used) and now < r.expires and r.own < LIMIT
      and open.get(fl.a)
    // cookie-not-required: the address's rows are looked up by the code alone.
    val bare = MUTANT == "cookie-not-required" and c == 0 and right and accepts(rt, now) and hasAttempts(rt)
    // address-attempts: every guess charges the address's live rows.
    val spread = MUTANT == "address-attempts" and c == 0
    // entry-by-cookie: the counted attempt and the sign-in match the row by the cookie value alone, so the browser's row for the
    // other address is charged and signed in too, and its audit entry is written.
    val otherK = key(c, 3 - fl.a)
    val byCookie = MUTANT == "entry-by-cookie" and charged and c != 0 and rows.get(otherK).present and rows.get(otherK).issued
    val rowsCharged = rows.set(k, { ...r, attempts: r.attempts + 1, own: r.own + (if (b == r.owner) 1 else 0),
      compared: r.compared + 1, used: r.used or success })
    val newRows =
      if (charged)
        (if (byCookie) rowsCharged.set(otherK, { ...rows.get(otherK), attempts: rows.get(otherK).attempts + 1, used: rows.get(otherK).used or success })
         else rowsCharged)
      else if (bare)
        rows.set(t, { ...rt, attempts: rt.attempts + 1, compared: rt.compared + 1, used: true })
      else if (spread)
        rows.keys().mapBy(i => if (accepts(rows.get(i), now) and rows.get(i).addr == fl.a) { ...rows.get(i), attempts: rows.get(i).attempts + 1 } else rows.get(i))
      else rows
    // A sign-in writes an audit entry for the address's projects (and, for entry-by-cookie, for the other address's too).
    val newAudit =
      if (success) (if (byCookie) audit.set(fl.a, audit.get(fl.a) + 1).set(3 - fl.a, audit.get(3 - fl.a) + 1) else audit.set(fl.a, audit.get(fl.a) + 1))
      else audit
    all {
      fl.phase == "read",
      rows' = newRows,
      audit' = newAudit,
      gflights' = gflights.set(g, idleGuess),
      ghost' = { ...ghost,
        noCookieSignIn: ghost.noCookieSignIn or bare,
        badSignIn: ghost.badSignIn or (success and (r.used or now >= r.expires)) or (bare and (rt.used or now >= rt.expires)),
        clientRejected: ghost.clientRejected or (b == CLIENT and shouldSucceed and not(success)),
        badCharge: ghost.badCharge or (charged and not(sameCode)) or (success and not(sameCode)),
        badAudit: ghost.badAudit or (success and not(open.get(fl.a))),
        badFrame: ghost.badFrame or bare or foreignChange(rows, newRows, fl.a) or foreignAudit(audit, newAudit, fl.a) },
      cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, flights' = flights, lastIssued' = lastIssued, exempt' = exempt, open' = open
    }
  }

  // ---- Time ----------------------------------------------------------------------------------------------------------
  action tick = all {
    now < MAX_NOW,
    now' = now + 1,
    rows' = rows, cookie' = cookie, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost, flights' = flights, lastIssued' = lastIssued, exempt' = exempt, open' = open, gflights' = gflights, audit' = audit
  }

  // Each step picks only what it can do: an idle slot for a new request, a request in the phase a step needs, a guess that means
  // something (a browser with a cookie enters its own code for an address, or a wrong one; only browsers 0 and 1 can know a code).
  def inPhase(ph: str): Set[int] = flights.keys().filter(f => flights.get(f).phase == ph)

  action step = any {
    nondet f = inPhase("idle").oneOf()
    nondet b = 0.to(3).oneOf()
    nondet a = 1.to(2).oneOf()
    sendRead(f, b, a),
    nondet f = inPhase("read").oneOf()
    sendClear(f),
    nondet f = inPhase("cleared").oneOf()
    sendWrite(f),
    nondet f = inPhase("sent").oneOf()
    receive(f),
    nondet a = 1.to(2).oneOf()
    closeProject(a),
    nondet g = gflights.keys().filter(g => gflights.get(g).phase == "idle").oneOf()
    nondet b = 0.to(3).oneOf()
    nondet a = 1.to(2).oneOf()
    nondet t = (if (cookie.get(b) != 0) Set(key(cookie.get(b), a)) else 2.to(11)).oneOf()
    nondet right = (if (b < STRANGER) Set(true, false) else Set(false)).oneOf()
    guessRead(g, b, a, t, right),
    nondet g = gflights.keys().filter(g => gflights.get(g).phase == "read").oneOf()
    guessWrite(g),
    tick,
  }

  // ---- Properties --------------------------------------------------------------------------------------------------
  def noFlight(b: int): bool =
    flights.keys().forall(f => not(flights.get(f).phase != "idle" and flights.get(f).b == b))
    and gflights.keys().forall(g => not(gflights.get(g).phase != "idle" and gflights.get(g).b == b))

  // 1. A client who asked for a code and enters it correctly from the same browser while it is valid is signed in, unless that
  //    browser used up its own attempts, whatever others do. As states: each of the client's current rows is still there, with
  //    attempts left and its code unchanged, and no correct entry of one was refused. Exempt while the client's own request or entry
  //    is in progress, and once a project is closed.
  val clientNeverLockedOut = and {
    not(ghost.clientRejected),
    1.to(2).forall(a => Set(cookie.get(CLIENT)).forall(c =>
      if (c == 0 or not(noFlight(CLIENT)) or not(open.get(1)) or not(open.get(2))) true
      else {
        val r = rows.get(key(c, a))
        (not(r.used) and now < r.expires and r.own < LIMIT) implies (r.present and r.attempts < LIMIT and not(r.rehashed))
      })),
  }

  // 2. A browser without the matching pending cookie never signs in.
  val cookieRequired = not(ghost.noCookieSignIn)

  // 3. A browser without the matching cookie never changes another requester's code or attempts: a row's stored attempts are exactly
  //    the guesses its own browser made, and no other browser changed its code.
  val othersUntouched = rows.keys().forall(i => {
    val r = rows.get(i)
    not(r.issued) or (r.attempts == r.own and not(r.rehashed))
  })

  // 4. The guesses that can ever be compared with one code are bounded by the per-row limit.
  val attemptsBounded = rows.keys().forall(i => rows.get(i).attempts <= LIMIT and rows.get(i).compared <= LIMIT)

  // 5. Emails asked for an address in one window are bounded (the allowance is kept per address).
  val emailsBounded = 1.to(2).forall(a => winUses.get(a) <= EMAILS)

  // 6. A used or expired code never signs anyone in.
  val deadCodeNeverSignsIn = not(ghost.badSignIn)

  // 7. Live rows for each address are bounded, also when requests overlap.
  val liveRowsBounded = 1.to(2).forall(a => liveAt(a).size() <= CAP)

  // 8. If a code was emailed for a request from this browser, and no later request from it issued another, then once every response to
  //    this browser has arrived its stored cookie names that code. The browser's responses can arrive in any order. Exempt: a browser
  //    that sent two cookie-less requests at once (nothing ties its two responses together; the consequence is that it asks again).
  val cookieOpensEmailedCode = 0.to(3).forall(b =>
    (noFlight(b) and not(exempt.contains(b)) and lastIssued.get(b) != 0) implies cookie.get(b) == lastIssued.get(b))

  // 9. Non-interference (a frame property): no step of a request (read, clean-up, write) or of an entry (read, attempt charge, accept)
  //    for one address changes any row, attempt count or code, or any audit entry, of another address, whatever the first address's
  //    state is (it has a project, none, it is full, the write lost a race).
  val noCrossAddressEffect = not(ghost.badFrame)

  // 10. An attempt is counted on, and a sign-in accepted for, only the code the guess read, never a code issued after it.
  val chargeOnlyTheCodeRead = not(ghost.badCharge)

  // 11. An audit row is never written for a project that has been closed.
  val noAuditForClosedProject = not(ghost.badAudit)

  // 12. A code request's observable outcome (the answer and what happens to the cookie) does not depend on whether the address has an
  //     open project, under any interleaving: no request ends in an error, which only a request that issues can do (the table's key is
  //     (cookie value, address), and a write that cannot replace the browser's row for the address collides on it).
  val outcomeIndependentOfAddress = not(ghost.badOutcome)

  // 13. A code that was emailed and is unexpired, unused and not superseded by a later request from its own browser is never removed by
  //     another request's clean-up: a clean-up deletes the expired rows it read only if each still holds the code it read.
  val liveCodeNeverSwept = not(ghost.badSweep)

  val allProperties = and {
    clientNeverLockedOut, cookieRequired, othersUntouched, attemptsBounded, emailsBounded, deadCodeNeverSignsIn,
    liveRowsBounded, cookieOpensEmailedCode, noCrossAddressEffect, chargeOnlyTheCodeRead, noAuditForClosedProject,
    outcomeIndependentOfAddress, liveCodeNeverSwept,
  }
}

module signin { import signinCodes(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module signinSingleRow { import signinCodes(MUTANT = "single-row").* }
module signinAddressAttempts { import signinCodes(MUTANT = "address-attempts").* }
module signinReplaceLive { import signinCodes(MUTANT = "replace-live").* }
module signinCookieNotRequired { import signinCodes(MUTANT = "cookie-not-required").* }
module signinEvictOldest { import signinCodes(MUTANT = "evict-oldest").* }
module signinNoAttemptCap { import signinCodes(MUTANT = "no-attempt-cap").* }
module signinNoAllowance { import signinCodes(MUTANT = "no-allowance").* }
module signinNoRowCap { import signinCodes(MUTANT = "no-row-cap").* }
module signinIgnoreExpiry { import signinCodes(MUTANT = "ignore-expiry").* }
module signinReuseUsed { import signinCodes(MUTANT = "reuse-used").* }
module signinFreshCookie { import signinCodes(MUTANT = "fresh-cookie").* }
module signinChargeAnyVersion { import signinCodes(MUTANT = "charge-any-version").* }
module signinNoOpenGuard { import signinCodes(MUTANT = "no-open-guard").* }
module signinAcceptNoOpenGuard { import signinCodes(MUTANT = "accept-no-open-guard").* }
module signinNoCapGuard { import signinCodes(MUTANT = "no-cap-guard").* }
module signinNoReplace { import signinCodes(MUTANT = "no-replace").* }
module signinSweepUnguarded { import signinCodes(MUTANT = "sweep-unguarded").* }
module signinDeleteByCookie { import signinCodes(MUTANT = "delete-by-cookie").* }
module signinEntryByCookie { import signinCodes(MUTANT = "entry-by-cookie").* }
