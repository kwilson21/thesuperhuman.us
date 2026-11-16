// Publisher protocol: render immutable A, check A is current, check out A,
// commit generated output on A, and fast-forward push. A user push may interleave.
module linkPreviewsProtocol {
  const MUTANT: str
  var head: int
  var phase: int
  var target: int
  var published: bool
  var badTree: bool
  var lostUpdate: bool

  action init = all {
    head' = 0, phase' = 0, target' = 0, published' = false,
    badTree' = false, lostUpdate' = false,
  }
  action step = any {
    all { head == 0, head' = 1, phase' = phase, target' = target,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 0, head == 0, phase' = 1, head' = head, target' = target,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 1, phase' = 2, head' = head,
      target' = if (MUTANT == "moving-checkout") head else 0,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 2, head == target or MUTANT == "force-push",
      phase' = 3, target' = target, head' = 2, published' = true,
      badTree' = target != 0, lostUpdate' = head != target },
  }
  action stepOrEnd = any { step, all { head' = head, phase' = phase, target' = target,
    published' = published, badTree' = badTree, lostUpdate' = lostUpdate } }
  val renderedTreeMatches = not(badTree)
  val newerCommitPreserved = not(lostUpdate)
  val allProperties = renderedTreeMatches and newerCommitPreserved
}
module linkPreviewsCurrent { import linkPreviewsProtocol(MUTANT="none").* }
module linkPreviewsMovingCheckout { import linkPreviewsProtocol(MUTANT="moving-checkout").* }
module linkPreviewsForcePush { import linkPreviewsProtocol(MUTANT="force-push").* }
