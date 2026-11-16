// Publisher protocol: render immutable A, check A is current, check out A,
// commit generated output on A, and fast-forward push. A user push may interleave.
module linkPreviewsProtocol {
  const MUTANT: str
  var branchTip: int
  var phase: int
  var target: int
  var published: bool
  var badTree: bool
  var lostUpdate: bool

  action init = all {
    branchTip' = 0, phase' = 0, target' = 0, published' = false,
    badTree' = false, lostUpdate' = false,
  }
  action step = any {
    all { branchTip == 0, branchTip' = 1, phase' = phase, target' = target,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 0, branchTip == 0, phase' = 1, branchTip' = branchTip, target' = target,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 1, phase' = 2, branchTip' = branchTip,
      target' = if (MUTANT == "moving-checkout") branchTip else 0,
      published' = published, badTree' = badTree, lostUpdate' = lostUpdate },
    all { phase == 2, branchTip == target or MUTANT == "force-push",
      phase' = 3, target' = target, branchTip' = 2, published' = true,
      badTree' = target != 0, lostUpdate' = branchTip != target },
  }
  action stepOrEnd = any { step, all { branchTip' = branchTip, phase' = phase, target' = target,
    published' = published, badTree' = badTree, lostUpdate' = lostUpdate } }
  val renderedTreeMatches = not(badTree)
  val newerCommitPreserved = not(lostUpdate)
  val allProperties = and { renderedTreeMatches, newerCommitPreserved }
}
module linkPreviewsCurrent { import linkPreviewsProtocol(MUTANT="none").* }
module linkPreviewsMovingCheckout { import linkPreviewsProtocol(MUTANT="moving-checkout").* }
module linkPreviewsForcePush { import linkPreviewsProtocol(MUTANT="force-push").* }
