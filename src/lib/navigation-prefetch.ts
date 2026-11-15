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

/** Only the main site and explicit local QA hosts share these route semantics. */
const PREFETCH_HOSTS = new Set([
	"thesuperhuman.us",
	"www.thesuperhuman.us",
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

/** Set false and redeploy to stop default prediction without changing diagnostics. */
export const DEFAULT_PREFETCH_ENABLED = true;

/** No prediction package is loaded on private, intake, API, or unreviewed pages. */
export function isPublicPrefetchSource(href: string): boolean {
	try {
		const source = new URL(href);

		return (
			(source.protocol === "https:" || source.protocol === "http:") &&
			PREFETCH_HOSTS.has(source.hostname) &&
			(source.pathname === "/" || PREFETCH_PATHS.has(source.pathname))
		);
	} catch {
		return false;
	}
}

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
