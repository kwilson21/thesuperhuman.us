# Coding approach

Default: Ponytail's reuse-first approach, requested by the owner.

1. Read the real caller-to-result flow before changing it.
2. Question whether the new component is needed.
3. Reuse existing code, standard library, native platform features, and installed dependencies, in that order.
4. Add only the smallest maintainable implementation for the current requirement.
5. Avoid speculative services, queues, interfaces, configuration, and new dependencies. One owner-approved exception (2026-11-12): the back end uses `effect` 4.1.4, `@xstate/effect` 1.0.0-alpha.12 and `xstate` 6.0.0-beta.1, pinned exactly, in the form set out under "Back-end rules" in [CLAUDE.md](../CLAUDE.md).
6. Keep trust-boundary validation, data-loss handling, security, accessibility, and required checks.
7. Before opening a PR, identify what can be removed or reused. Keep the diff independently reviewable.
8. Do not shorten code by making it clever or harder to understand.

This rule changes implementation judgment, not permission boundaries or required
reviews. It is an instruction policy, not a claim that the Ponytail plugin is installed.
New projects can reference this document from their existing agent instructions.
