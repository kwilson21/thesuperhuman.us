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

// A failed sheet upload or description update never unlocks merge validation.
module previewReviewGate {
  const EARLY: bool
  var phase: int
  var reviewed: bool
  var validated: bool
  action init = all { phase' = 0, reviewed' = false, validated' = false }
  action step = any {
    all { phase == 0, phase' = 1, reviewed' = reviewed, validated' = validated },
    all { phase == 1, phase' = 2, reviewed' = reviewed, validated' = validated },
    all { phase == 2, phase' = 3, reviewed' = true, validated' = validated },
    all { phase == 3 or (EARLY and phase == 1), phase' = 4,
      reviewed' = reviewed, validated' = true },
    all { phase >= 1 and phase <= 2, phase' = 5, reviewed' = reviewed, validated' = validated },
    all { phase' = phase, reviewed' = reviewed, validated' = validated },
  }
  val reviewBeforeValidation = not(validated) or reviewed
  val allProperties = reviewBeforeValidation
}
module previewReviewCurrent { import previewReviewGate(EARLY=false).* }
module previewReviewEarly { import previewReviewGate(EARLY=true).* }

// Only the trusted finalizer can unlock validation; receipts are not candidate claims.
module previewFinalizer {
  const MUTANT: str
  var tests: bool
  var receipt: bool
  var privateGate: bool
  var current: bool
  var green: bool
  action init = all { tests' = false, receipt' = false, privateGate' = false, current' = true, green' = false }
  action step = any {
    all { tests' = true, receipt' = receipt, privateGate' = privateGate, current' = current, green' = green },
    all { tests' = tests, receipt' = true, privateGate' = privateGate, current' = current, green' = green },
    all { tests' = tests, receipt' = receipt, privateGate' = true, current' = current, green' = green },
    all { not(green), tests' = tests, receipt' = receipt, privateGate' = privateGate, current' = false, green' = green },
    all { tests, (receipt or MUTANT == "forged-receipt"), (privateGate or MUTANT == "private-skipped"), (current or MUTANT == "moved-head"),
      tests' = tests, receipt' = receipt, privateGate' = privateGate, current' = current, green' = true },
    all { tests' = tests, receipt' = receipt, privateGate' = privateGate, current' = current, green' = green },
  }
  val authenticatedReview = not(green) or receipt
  val privateApproved = not(green) or privateGate
  val exactHead = not(green) or current
  val allProperties = and { authenticatedReview, privateApproved, exactHead }
}
module previewFinalizerCurrent { import previewFinalizer(MUTANT="none").* }
module previewFinalizerForged { import previewFinalizer(MUTANT="forged-receipt").* }
module previewFinalizerPrivate { import previewFinalizer(MUTANT="private-skipped").* }
module previewFinalizerMoved { import previewFinalizer(MUTANT="moved-head").* }

// An older successful completion cannot overwrite a newer failure or retry.
module validationAuthority {
  const STALE: bool
  var newer: bool
  var checkedLatest: bool
  var green: bool
  action init = all { newer' = false, checkedLatest' = true, green' = false }
  action step = any {
    all { not(green), newer' = true, checkedLatest' = false, green' = false },
    all { not(newer), checkedLatest' = true, newer' = newer, green' = green },
    all { checkedLatest or STALE, newer' = newer, checkedLatest' = checkedLatest, green' = true },
    all { newer' = newer, checkedLatest' = checkedLatest, green' = green },
  }
  val authoritativeSuccess = not(green) or not(newer)
  val allProperties = authoritativeSuccess
}
module validationAuthorityCurrent { import validationAuthority(STALE=false).* }
module validationAuthorityStale { import validationAuthority(STALE=true).* }

// Editing the PR description cannot replace the immutable evidence linked by validation.
module immutablePreviewEvidence {
  const MUTABLE: bool
  var sheetsVerified: bool
  var immutableCheck: bool
  var bodyChanged: bool
  var green: bool
  action init = all { sheetsVerified' = false, immutableCheck' = false, bodyChanged' = false, green' = false }
  action step = any {
    all { sheetsVerified' = true, immutableCheck' = immutableCheck, bodyChanged' = bodyChanged, green' = green },
    all { sheetsVerified, immutableCheck' = true, sheetsVerified' = sheetsVerified, bodyChanged' = bodyChanged, green' = green },
    all { bodyChanged' = true, sheetsVerified' = sheetsVerified, immutableCheck' = immutableCheck, green' = green },
    all { (sheetsVerified and immutableCheck) or MUTABLE, green' = true, sheetsVerified' = sheetsVerified, immutableCheck' = immutableCheck, bodyChanged' = bodyChanged },
    all { sheetsVerified' = sheetsVerified, immutableCheck' = immutableCheck, bodyChanged' = bodyChanged, green' = green },
  }
  val immutableReviewBound = not(green) or (sheetsVerified and immutableCheck)
  val allProperties = immutableReviewBound
}
module immutablePreviewCurrent { import immutablePreviewEvidence(MUTABLE=false).* }
module immutablePreviewMutable { import immutablePreviewEvidence(MUTABLE=true).* }

// Reruns may resume only at the reproducible generated child, not an unrelated push.
module previewRecovery {
  const ADOPT: bool
  var tip: int
  var resumed: bool
  var lost: bool
  action init = all { tip' = 0, resumed' = false, lost' = false }
  action step = any {
    all { tip == 0, tip' = 1, resumed' = resumed, lost' = lost },
    all { not(resumed), tip' = 2, resumed' = resumed, lost' = lost },
    all { tip == 1 or ADOPT, tip' = tip, resumed' = true, lost' = tip == 2 },
    all { tip' = tip, resumed' = resumed, lost' = lost },
  }
  val recoveryPreservesNewerHead = not(lost)
  val allProperties = recoveryPreservesNewerHead
}
module previewRecoveryCurrent { import previewRecovery(ADOPT=false).* }
module previewRecoveryAdopt { import previewRecovery(ADOPT=true).* }

// A green dispatch certifies the merged tree at the same current base, not just the head.
module validationMergeBase {
  const HEAD_ONLY: bool
  var baseChanged: bool
  var green: bool
  action init = all { baseChanged' = false, green' = false }
  action step = any {
    all { not(green), baseChanged' = true, green' = false },
    all { not(baseChanged) or HEAD_ONLY, baseChanged' = baseChanged, green' = true },
    all { baseChanged' = baseChanged, green' = green },
  }
  val testedCurrentMerge = not(green) or not(baseChanged)
  val allProperties = testedCurrentMerge
}
module validationMergeCurrent { import validationMergeBase(HEAD_ONLY=false).* }
module validationMergeHeadOnly { import validationMergeBase(HEAD_ONLY=true).* }
