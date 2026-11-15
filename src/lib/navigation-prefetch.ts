import inventory from "~/data/navigation-inventory.json";
import { rewritePathForHost } from "./host-routing";

const SOURCE_PATHS = new Set(inventory.sources);
const TARGET_PATHS = new Set(inventory.targets);

export const PREFETCH_LIMIT = 3;

/** Only the main/audio sites and explicit local QA hosts share these route semantics. */
const PREFETCH_HOSTS = new Set([
	"thesuperhuman.us",
	"www.thesuperhuman.us",
	"audio.thesuperhuman.us",
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

/** Set false and redeploy to stop default prediction without changing diagnostics. */
export const DEFAULT_PREFETCH_ENABLED = true;

function routePath(url: URL): string {
	const rewritten =
		rewritePathForHost(url.hostname, url.pathname) ?? url.pathname;

	return rewritten.replace(/\/$/, "") || "/";
}

/** Sources include public forms/no-store pages, never private sessions or endpoints. */
export function isPublicPrefetchSource(href: string): boolean {
	try {
		const source = new URL(href);

		return (
			(source.protocol === "https:" || source.protocol === "http:") &&
			PREFETCH_HOSTS.has(source.hostname) &&
			SOURCE_PATHS.has(routePath(source))
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
			!isPublicPrefetchSource(current) ||
			target.origin !== base.origin ||
			target.search ||
			target.username ||
			target.password ||
			routePath(target) === routePath(base) ||
			!TARGET_PATHS.has(routePath(target))
		)
			return null;

		target.hash = "";

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
