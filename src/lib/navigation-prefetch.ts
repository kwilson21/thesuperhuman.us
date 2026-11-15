/** Public, static, read-only destinations reviewed for this opt-in experiment. */
export const PREFETCH_PATHS = new Set([
	"/work",
	"/building",
	"/writing",
	"/about",
	"/services",
	"/building/tally",
	"/building/kaillera-next",
]);

export const PREFETCH_LIMIT = 3;

export function prefetchTarget(href: string, current: string): string | null {
	try {
		const base = new URL(current);
		const target = new URL(href, base);

		if (
			target.origin !== base.origin ||
			target.search ||
			target.hash ||
			target.username ||
			target.password ||
			target.pathname === base.pathname ||
			!PREFETCH_PATHS.has(target.pathname)
		)
			return null;

		return target.href;
	} catch {
		return null;
	}
}

export function reservePrefetch(
	target: string | null,
	seen: Set<string>,
	permitted: boolean,
): boolean {
	if (!permitted || !target || seen.has(target) || seen.size >= PREFETCH_LIMIT)
		return false;
	seen.add(target);

	return true;
}
