// Minimal stub for astro:middleware used in Vitest tests.
// defineMiddleware is an identity function at runtime; it just types the handler.
export function defineMiddleware(handler: (ctx: any, next: () => Promise<Response>) => Promise<Response>) {
  return handler;
}
