// Mirrors the /* block in public/_headers, which Cloudflare applies only to static assets.
// tests/lib/security-headers.test.ts fails if the two drift.
export const securityHeaders = {
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

function addMissing(headers: Headers) {
  for (const [name, value] of Object.entries(securityHeaders)) if (!headers.has(name)) headers.set(name, value);
}

export function withSecurityHeaders(response: Response) {
  try {
    addMissing(response.headers);
    return response;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Response.redirect() and fetched responses have immutable headers.
    const copy = new Response(response.body, response);
    addMissing(copy.headers);
    return copy;
  }
}
