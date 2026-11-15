// The work feed's bearer token. Two pure decisions: whether the request carries a bearer token at all, and whether its
// SHA-256 digest is the configured token's. Digests are compared, never the tokens, and the comparison reads every byte
// (no early exit), so how long it takes does not say how much matched. The hashing itself is the flow's, because it is an
// asynchronous browser API. Nothing is read or written, so no write-time guard applies.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** The caller did not present the configured token. */
export class Unauthorized extends Data.TaggedError("Unauthorized") {
	readonly say = "Unauthorized.";
}

const LONGEST_HEADER = 4096;

/** The longest header and the scheme the token travels under. */
type PresentsBearerRequest = {
	readonly configured: string | undefined;
	readonly header: string | null;
};

export const presentsBearer = alwaysWrites({
	name: "Present a bearer token",
	given: (request: PresentsBearerRequest, _facts: Record<string, never>) =>
		request,
	refusals: [
		unless(
			term<PresentsBearerRequest>("a token is configured", (g) =>
				Boolean(g.configured),
			),
			() => new Unauthorized(),
		),
		unless(
			term<PresentsBearerRequest>(
				"the header is Bearer followed by a token, within the longest header",
				(g) =>
					g.header !== null &&
					g.header.startsWith("Bearer ") &&
					g.header.length <= LONGEST_HEADER,
			),
			() => new Unauthorized(),
		),
	],
	writes: (g) => g.header?.slice(7) ?? "",
	writesText: "the token the caller presented",
});

/** The digests of the presented and the configured token. */
type SameDigestRequest = {
	readonly presented: Uint8Array;
	readonly configured: Uint8Array;
};

export const sameDigest = alwaysWrites({
	name: "Match the presented token's digest to the configured one",
	given: (request: SameDigestRequest, _facts: Record<string, never>) => request,
	refusals: [
		unless(
			term<SameDigestRequest>("every byte of the two digests is equal", (g) => {
				let difference = g.presented.length ^ g.configured.length;

				for (let i = 0; i < g.presented.length; i++)
					difference |= g.presented[i] ^ (g.configured[i] ?? 0);

				return difference === 0;
			}),
			() => new Unauthorized(),
		),
	],
	writes: () => true,
	writesText: "nothing: the caller is the owner's agent",
});
