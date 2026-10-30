// Mirrors the /* block in public/_headers, which Cloudflare applies to static assets.
// tests/lib/security-headers.test.ts fails if the two drift.
export const securityHeaders = {
  // Start report-only while production violations are reviewed. Once routes and inline scripts are covered, move this value
  // to Content-Security-Policy; the publication OAuth route keeps its own stricter enforced policy.
  'content-security-policy-report-only': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
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
