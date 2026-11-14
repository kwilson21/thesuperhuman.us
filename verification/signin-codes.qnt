// Quint model of the studio sign-in codes kept for one email address, with browsers that know the address and, for some of
// them, the code.
// Code modelled: src/lib/audio-client-access.ts (issueClientCode, completeClientCode, discardUndeliveredCode), the routes
//   src/pages/api/studio/code.ts and session.ts, and the pending sign-in cookie they set and read.
// See docs/verification.md ("The sign-in codes model") for what is and is not covered.
//
// Run (from the repo root):  pnpm run verify:quint   and   pnpm run verify:quint:mutants
//
// The numbers are scaled down from the code so a search can reach the interesting states. Ratios are kept:
//   attempts per code   LIMIT 3   (code: 5)
//   emails per window   EMAILS 2  (code: 3, the "code-email" allowance)
//   window              WINDOW 2 ticks (code: 5 minutes)
//   code lifetime       LIFE 4 ticks   (code: 10 minutes, two windows)
//   pause               THROTTLE 1 tick: the 30 second pause of the code before this fix, kept only by the mutants that model it
//   live codes per address CAP 3 (code: 6 = 2 x 3). The model's cap is lower than 2 x EMAILS so that a random search reaches it;
//   what is checked is that the cap holds and is never made room for by dropping another browser's live code.
//
// Browsers: 0 is the client's own, 1 is the client's other browser (it can read the client's inbox, so it knows every
// delivered code, but it holds no pending sign-in cookie unless it asked for a code itself), 2 is a stranger who knows
// the address and never learns a code; 3 and 4 are more strangers. Any browser can ask for a code (a stranger solves the
// captcha), and each browser holds at most one pending cookie, so up to five rows can be live at once.
module signinCodes {
  // "none" is the code as it is built. Every other value changes one thing so a property must fail (the mutants):
  //   "single-row"           one row per address: a new request replaces the address's row once it is older than the pause
  //                          (the code before this fix, table keyed by email)
  //   "address-attempts"     a guess charges the attempts of the address's live rows, whoever sends it (the code before this fix)
  //   "replace-live"         a request from another browser changes the live code in place (the code before this fix)
  //   "cookie-not-required"  a correct code signs in without the pending sign-in cookie (the code before this fix)
  //   "evict-oldest"         a full address makes room by removing the oldest live row instead of refusing the new request
  //   "sweep-live"           the sweep removes rows that have not expired yet
  //   "no-attempt-cap"       the attempt limit is not enforced
  //   "no-allowance"         the emails-per-window allowance is not enforced
  //   "no-row-cap"           the live-row cap is not enforced
  //   "ignore-expiry"        an expired code still signs in
  //   "reuse-used"           a used code signs in again
  //   "fresh-cookie"         each request answers with a fresh cookie value, a refused one with an unrelated value (the code before this
  //                          fix); with two requests from one browser in flight, the later response can overwrite the cookie of the code
  //                          the earlier one emailed
  const MUTANT: str

  val LIMIT = 3
  val EMAILS = 2
  val WINDOW = 2
  val LIFE = 4
  val THROTTLE = 1
  val CAP = 3
  val MAX_ROWS = 8    // codes asked for in one run (row ids 1..8)
  val MAX_NOW = 10    // ticks in one run
  val CLIENT = 0
  val STRANGER = 2
  val MAX_FLIGHTS = 3 // requests in flight at once, from any browsers

  // issued: the id has been used. owner: the browser whose cookie the row is bound to. delivered: the email reached the
  // inbox, so browsers 0 and 1 know the code. attempts: the stored count. own: guesses its owner made that were charged
  // (a ghost). compared: guesses actually compared with the code (a ghost). rehashed: a browser other than the owner
  // changed the code (a ghost).
  type Row = {
    issued: bool, owner: int, delivered: bool, attempts: int, own: int, compared: int,
    created: int, expires: int, used: bool, present: bool, rehashed: bool,
  }
  // A request is two steps: the server's write (send), then the browser receiving the response and storing the cookie
  // value it carries (receive). Several can be in flight at once, so a later response can arrive before an earlier one.
  // bare: the browser sent no cookie.
  type Flight = { live: bool, b: int, value: int, bare: bool }
  type Ghost = {
    noCookieSignIn: bool,   // a sign-in happened for a browser whose cookie was not the row's
    badSignIn: bool,        // a used or expired code signed someone in
    clientRejected: bool,   // the client entered its own valid code with attempts left and was refused
  }

  var rows: int -> Row
  var cookie: int -> int    // browser -> id of the row its pending cookie names, 0 none
  var now: int
  var nextId: int
  var winStart: int
  var winUses: int          // emails allowed in the current window
  var ghost: Ghost
  var flights: int -> Flight
  var lastIssued: int -> int  // browser -> the row of its latest request that issued a code (a ghost), 0 none
  var exempt: Set[int]        // browsers that sent two cookie-less requests at once (a ghost; see property 8)

  val blank: Row = {
    issued: false, owner: 0, delivered: false, attempts: 0, own: 0, compared: 0,
    created: 0, expires: 0, used: false, present: false, rehashed: false,
  }

  pure def isLive(r: Row, t: int): bool = r.issued and r.present and not(r.used) and t < r.expires

  // What the completing query accepts. The mutants relax it.
  pure def accepts(r: Row, t: int): bool =
    r.issued and r.present and (MUTANT == "reuse-used" or not(r.used)) and (MUTANT == "ignore-expiry" or t < r.expires)

  pure def hasAttempts(r: Row): bool = MUTANT == "no-attempt-cap" or r.attempts < LIMIT

  pure def minOf(ids: Set[int]): int = ids.fold(MAX_ROWS + 1, (m, i) => if (i < m) i else m)

  action init = all {
    rows' = 1.to(MAX_ROWS).mapBy(_ => blank),
    cookie' = 0.to(4).mapBy(_ => 0),
    now' = 0, nextId' = 1, winStart' = 0, winUses' = 0,
    ghost' = { noCookieSignIn: false, badSignIn: false, clientRejected: false },
    flights' = 1.to(MAX_FLIGHTS).mapBy(_ => { live: false, b: 0, value: 0, bare: false }),
    lastIssued' = 0.to(4).mapBy(_ => 0),
    exempt' = Set(),
  }

  // ---- Asking for a code (code.ts, issueClientCode) ----------------------------------------------------------------
  // The browser sends its pending cookie, if any. The allowance counts first (a fixed window opened by its first use). The
  // address's room is decided on the live codes other than the browser's own. If there is room, the code is issued under the
  // browser's own cookie value when it sent one (its earlier code is replaced in place), or under a newly allocated value
  // when it sent none; the response carries that value whether or not a code was issued, so a refused request does not
  // change the browser's cookie. The "fresh-cookie" mutant is the code before this fix: every response carries a fresh
  // value, and a refused one an unrelated value.
  action send(f: int, b: int): bool = {
    val c = cookie.get(b)
    val windowOpen = winUses > 0 and now - winStart < WINDOW
    val usesNow = if (windowOpen) winUses else 0
    val allowed = MUTANT == "no-allowance" or usesNow < EMAILS
    val liveIds = rows.keys().filter(i => isLive(rows.get(i), now))
    val liveOthers = liveIds.filter(i => i != c).size()
    val anyYoung = liveIds.exists(i => rows.get(i).created + THROTTLE > now)
    // The code before this fix answered "sent" without a new code when the address's row was under 30 seconds old. The
    // fixed code has no pause: a browser that asks again replaces its own row, and the email allowance bounds the mail.
    val throttled = (MUTANT == "single-row" or MUTANT == "replace-live") and anyYoung
    val room = MUTANT == "no-row-cap" or MUTANT == "evict-oldest" or liveOthers < CAP
    val oldest = minOf(liveIds.filter(i => i != c))
    val fresh: Row = {
      issued: true, owner: b, delivered: false, attempts: 0, own: 0, compared: 0,
      created: now, expires: now + LIFE, used: false, present: true, rehashed: false,
    }
    // replace-live: the code of the oldest live row is changed in place and the requester's cookie now names it.
    val target = minOf(liveIds)
    val replaceInPlace = MUTANT == "replace-live" and liveIds.size() > 0 and not(throttled)
    val alloc = (MUTANT == "fresh-cookie" or c == 0) and not(replaceInPlace)
    val value = if (replaceInPlace) target else if (alloc) nextId else c
    val removed: Set[int] =
      if (MUTANT == "single-row") rows.keys()
      else if (MUTANT == "evict-oldest" and liveOthers >= CAP) Set(c, oldest)
      else if (MUTANT == "fresh-cookie") Set(c)
      else Set()
    val cleared = rows.keys().mapBy(i => if (removed.contains(i)) { ...rows.get(i), present: false } else rows.get(i))
    val insert = not(throttled) and not(replaceInPlace) and room
    val bareFlight = flights.keys().exists(g => flights.get(g).live and flights.get(g).b == b and flights.get(g).bare)
    all {
      allowed,
      not(flights.get(f).live),
      not(alloc) or nextId <= MAX_ROWS,
      winStart' = if (windowOpen) winStart else now,
      winUses' = usesNow + 1,
      rows' =
        if (replaceInPlace)
          rows.set(target, { ...rows.get(target), delivered: false, attempts: 0, created: now, expires: now + LIFE,
            rehashed: rows.get(target).rehashed or rows.get(target).owner != b })
        else if (insert) cleared.set(value, fresh)
        else rows,
      nextId' = if (alloc) nextId + 1 else nextId,
      flights' = flights.set(f, { live: true, b: b, value: value, bare: c == 0 }),
      lastIssued' = if (insert or replaceInPlace) lastIssued.set(b, value) else lastIssued,
      exempt' = if (c == 0 and bareFlight) exempt.union(Set(b)) else exempt,
      cookie' = cookie, now' = now, ghost' = ghost,
    }
  }

  // The browser receives the response and stores the cookie value it carries.
  action receive(f: int): bool = all {
    flights.get(f).live,
    cookie' = cookie.set(flights.get(f).b, flights.get(f).value),
    flights' = flights.set(f, { ...flights.get(f), live: false }),
    rows' = rows, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost,
    lastIssued' = lastIssued, exempt' = exempt,
  }

  // The email reaches the inbox.
  action deliver(t: int): bool = all {
    rows.get(t).issued, rows.get(t).present, not(rows.get(t).delivered),
    rows' = rows.set(t, { ...rows.get(t), delivered: true }),
    cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost,
    flights' = flights, lastIssued' = lastIssued, exempt' = exempt,
  }

  // ---- Entering a code (session.ts, completeClientCode) ------------------------------------------------------------
  // Browser b sends its pending cookie (if any) and the code of row t. A browser can send the right code only if it can
  // read the inbox (browsers 0 and 1) and the email was delivered; the stranger always sends a wrong code.
  // With a cookie: the row the cookie names is charged one attempt (while it is unused, unexpired and under the limit) and
  // accepts the code only when the code is its own (the code's hash covers the cookie's nonce, so another row's code never
  // matches). Without a cookie nothing is looked up and nothing changes.
  action guess(b: int, t: int, right: bool): bool = {
    val c = cookie.get(b)
    val r = if (c != 0) rows.get(c) else blank
    val rt = rows.get(t)
    val charged = c != 0 and accepts(r, now) and hasAttempts(r)
    val success = charged and right and t == c
    val shouldSucceed = c != 0 and t == c and r.issued and not(r.used) and now < r.expires and r.own < LIMIT
    // cookie-not-required: the address is looked up by the code alone.
    val bare = MUTANT == "cookie-not-required" and c == 0 and right and accepts(rt, now) and hasAttempts(rt)
    // address-attempts: every guess charges the address's live rows.
    val spread = MUTANT == "address-attempts" and c == 0
    all {
      rt.issued,
      right implies (b < STRANGER and rt.delivered),
      rows' =
        if (charged)
          rows.set(c, { ...r, attempts: r.attempts + 1, own: r.own + (if (b == r.owner) 1 else 0),
            compared: r.compared + 1, used: r.used or success })
        else if (bare)
          rows.set(t, { ...rt, attempts: rt.attempts + 1, compared: rt.compared + 1, used: true })
        else if (spread)
          rows.keys().mapBy(i => if (accepts(rows.get(i), now)) { ...rows.get(i), attempts: rows.get(i).attempts + 1 } else rows.get(i))
        else rows,
      ghost' = {
        noCookieSignIn: ghost.noCookieSignIn or bare,
        badSignIn: ghost.badSignIn or (success and (r.used or now >= r.expires)) or (bare and (rt.used or now >= rt.expires)),
        clientRejected: ghost.clientRejected or (b == CLIENT and right and shouldSucceed and not(success)),
      },
      cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses,
      flights' = flights, lastIssued' = lastIssued, exempt' = exempt,
    }
  }

  // ---- Time and the sweep ------------------------------------------------------------------------------------------
  action tick = all {
    now < MAX_NOW,
    now' = now + 1,
    rows' = rows, cookie' = cookie, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost,
    flights' = flights, lastIssued' = lastIssued, exempt' = exempt,
  }

  // The sweep removes expired rows (the issue transaction deletes them). The "sweep-live" mutant keys it on the wrong
  // column and also removes live rows.
  action sweep = all {
    rows' = rows.keys().mapBy(i => {
      val r = rows.get(i)
      if (r.issued and (now >= r.expires or (MUTANT == "sweep-live" and r.created < now))) { ...r, present: false } else r
    }),
    cookie' = cookie, now' = now, nextId' = nextId, winStart' = winStart, winUses' = winUses, ghost' = ghost,
    flights' = flights, lastIssued' = lastIssued, exempt' = exempt,
  }

  action step = any {
    nondet f = 1.to(MAX_FLIGHTS).oneOf()
    nondet b = 0.to(4).oneOf()
    send(f, b),
    nondet f = 1.to(MAX_FLIGHTS).oneOf()
    receive(f),
    nondet t = 1.to(MAX_ROWS).oneOf()
    deliver(t),
    nondet b = 0.to(4).oneOf()
    nondet t = 1.to(MAX_ROWS).oneOf()
    nondet right = Set(true, false).oneOf()
    guess(b, t, right),
    tick,
    sweep,
  }

  // ---- Properties --------------------------------------------------------------------------------------------------
  // 1. A client who asked for a code and enters it correctly from the same browser while it is valid is signed in, unless
  //    that browser used up its own attempts, whatever other browsers do. As states: the client's current row is still
  //    there, with attempts left and its code unchanged, and no correct entry of it was refused.
  def noFlight(b: int): bool = flights.keys().forall(f => not(flights.get(f).live and flights.get(f).b == b))

  val clientNeverLockedOut = and {
    not(ghost.clientRejected),
    // While the client's own request is in flight its earlier code may already be replaced; that is what it asked for.
    Set(cookie.get(CLIENT)).forall(c =>
      if (c == 0 or not(noFlight(CLIENT))) true
      else {
        val r = rows.get(c)
        (not(r.used) and now < r.expires and r.own < LIMIT) implies (r.present and r.attempts < LIMIT and not(r.rehashed))
      }),
  }

  // 2. A browser without the matching pending cookie never signs in.
  val cookieRequired = not(ghost.noCookieSignIn)

  // 3. A browser without the matching cookie never changes another requester's code or attempts: a row's stored attempts
  //    are exactly the guesses its own browser made, and no other browser changed its code.
  val othersUntouched = rows.keys().forall(i => {
    val r = rows.get(i)
    not(r.issued) or (r.attempts == r.own and not(r.rehashed))
  })

  // 4. The guesses that can ever be compared with one code are bounded by the per-row limit.
  val attemptsBounded = rows.keys().forall(i => rows.get(i).attempts <= LIMIT and rows.get(i).compared <= LIMIT)

  // 5. Emails asked for an address in one window are bounded.
  val emailsBounded = winUses <= EMAILS

  // 6. A used or expired code never signs anyone in.
  val deadCodeNeverSignsIn = not(ghost.badSignIn)

  // 7. Live rows for the address are bounded.
  val liveRowsBounded = rows.keys().filter(i => isLive(rows.get(i), now)).size() <= CAP

  // 8. If a code was emailed for a request from this browser, and no later request from it issued another, then once every
  //    response to this browser has arrived its stored cookie names that code. The browser's responses can arrive in any
  //    order. Exempt: a browser that sent two cookie-less requests at once (nothing ties its two responses together; the
  //    consequence is that it asks again).
  val cookieOpensEmailedCode = 0.to(4).forall(b =>
    (noFlight(b) and not(exempt.contains(b)) and lastIssued.get(b) != 0) implies cookie.get(b) == lastIssued.get(b))

  val allProperties = and {
    clientNeverLockedOut, cookieRequired, othersUntouched, attemptsBounded, emailsBounded, deadCodeNeverSignsIn,
    liveRowsBounded, cookieOpensEmailedCode,
  }
}

module signin { import signinCodes(MUTANT = "none").* }

// Mutants. Each must produce a counterexample to the property named in scripts/lib/quint-mutants.mjs.
module signinSingleRow { import signinCodes(MUTANT = "single-row").* }
module signinAddressAttempts { import signinCodes(MUTANT = "address-attempts").* }
module signinReplaceLive { import signinCodes(MUTANT = "replace-live").* }
module signinCookieNotRequired { import signinCodes(MUTANT = "cookie-not-required").* }
module signinEvictOldest { import signinCodes(MUTANT = "evict-oldest").* }
module signinSweepLive { import signinCodes(MUTANT = "sweep-live").* }
module signinNoAttemptCap { import signinCodes(MUTANT = "no-attempt-cap").* }
module signinNoAllowance { import signinCodes(MUTANT = "no-allowance").* }
module signinNoRowCap { import signinCodes(MUTANT = "no-row-cap").* }
module signinIgnoreExpiry { import signinCodes(MUTANT = "ignore-expiry").* }
module signinReuseUsed { import signinCodes(MUTANT = "reuse-used").* }
module signinFreshCookie { import signinCodes(MUTANT = "fresh-cookie").* }
