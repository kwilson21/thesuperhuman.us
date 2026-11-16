// Minimal stub for astro:middleware used in Vitest tests.
// defineMiddleware is an identity function at runtime; it just types the handler.
import type { MiddlewareHandler } from "astro";

export function defineMiddleware(handler: MiddlewareHandler) {
	return handler;
}
