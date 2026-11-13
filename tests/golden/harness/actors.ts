// Who sends a request. A corpus reads as a table: each step says `as: asOwner()`, `as: asClient("a@example.test")` or
// `as: asVisitor({ ip: "203.0.113.9" })`.
//
// The routes read only locals.owner (set by middleware after Cloudflare Access verifies the owner), the studio_session
// cookie and, for rate limits, the cf-connecting-ip header. Middleware itself is not run by a corpus.

/** The email the default env treats as the owner. */
export const OWNER_EMAIL = "owner@example.test";

export type Actor =
	| {
			readonly kind: "visitor";
			readonly ip?: string;
			readonly headers: { readonly [name: string]: string };
			readonly cf?: { readonly country: string };
	  }
	| { readonly kind: "owner"; readonly email: string }
	| { readonly kind: "client"; readonly email: string }
	| { readonly kind: "client-cookie"; readonly token: string };

/** An anonymous visitor, optionally from an address (sent as cf-connecting-ip) or with extra headers. */
export function asVisitor(
	options: {
		readonly ip?: string;
		readonly headers?: { readonly [name: string]: string };
		readonly cf?: { readonly country: string };
	} = {},
): Actor {
	return {
		kind: "visitor",
		ip: options.ip,
		headers: options.headers ?? {},
		cf: options.cf,
	};
}

/** The owner, as middleware leaves locals.owner after Access verifies them. */
export function asOwner(email: string = OWNER_EMAIL): Actor {
	return { kind: "owner", email };
}

/**
 * A studio client who has signed in the way the real flow does: a code is issued by POST /api/studio/code (the code
 * is read from the email Resend is asked to send), completed by POST /api/studio/session, and the studio_session cookie
 * it sets is kept and sent. The sign-in happens just before the client's first step, off the record; its database
 * writes stay in the database. The email needs an active project in the seed.
 */
export function asClient(email: string): Actor {
	return { kind: "client", email };
}

/** A request that carries a studio_session cookie with this exact value (a forged, expired or revoked session). */
export function asClientCookie(token: string): Actor {
	return { kind: "client-cookie", token };
}

/** A label for the fixture. */
export function actorLabel(actor: Actor): string {
	switch (actor.kind) {
		case "visitor":
			return actor.ip ? `visitor ${actor.ip}` : "visitor";
		case "owner":
			return `owner ${actor.email}`;
		case "client":
			return `client ${actor.email}`;
		case "client-cookie":
			return "client with a given cookie";
	}
}
