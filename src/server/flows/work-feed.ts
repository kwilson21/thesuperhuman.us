// The work feed's flows. Reading a token's digest and comparing it (the caller's own agent presents the bearer token), and
// receiving a delivery: the body is read to a limit, read as UTF-8 and JSON, read as a publication envelope, its project
// is checked against the allowlist, and the journal commits it (src/server/flows/publication-commit.ts). The order is the
// route's contract: a caller without the token is refused before anything is read, and a body is read only after the
// database is known to be bound. It builds no response text; each refusal and failure is a named error the route maps.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { parsePublication } from "../../lib/publication/contract";
import { readBounded } from "../bounded-body";
import { allowProject } from "../rules/publication-access";
import { presentsBearer, sameDigest } from "../rules/publication-token";
import { commit } from "./publication-commit";

/** The request has no body. */
export class MissingPublication extends Data.TaggedError(
	"MissingPublication",
) {}

/** The body is not UTF-8 JSON, or it is JSON that is not a publication envelope. */
export class InvalidPublication extends Data.TaggedError(
	"InvalidPublication",
) {}

/** The largest envelope read, in bytes. */
export const LARGEST_ENVELOPE = 32768;

/** The SHA-256 of a token. `Effect.promise`: a digest of bytes cannot reject, so there is no failure to name. */
const digestOf = (token: string) =>
	Effect.promise(
		async () =>
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
			),
	);

/** Succeeds when the request presents the configured token; fails with Unauthorized otherwise. */
export const authorizeFeed = (
	header: string | null,
	configured: string | undefined,
) =>
	Effect.gen(function* () {
		const presented = yield* presentsBearer.decide({ configured, header }, {});

		// presentsBearer refused an unset token, so `configured` is text here; the digests are compared byte for byte.
		const [a, b] = yield* Effect.all([
			digestOf(presented),
			digestOf(configured ?? ""),
		]);

		yield* sameDigest.decide({ presented: a, configured: b }, {});
	});

export const receivePublication = (
	body: ReadableStream<Uint8Array> | null,
	allowlist: string | undefined,
) =>
	Effect.gen(function* () {
		if (body === null) return yield* Effect.fail(new MissingPublication());

		const bytes = yield* readBounded(body, LARGEST_ENVELOPE).pipe(
			Effect.catchTag("BodyUnreadable", () =>
				Effect.fail(new InvalidPublication()),
			),
		);

		const input = yield* Effect.try({
			try: () =>
				JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
			catch: () => new InvalidPublication(),
		});

		const publication = parsePublication(input);

		if (!publication) return yield* Effect.fail(new InvalidPublication());
		yield* allowProject.decide(
			{ allowlist, project: publication.projectId },
			{},
		);

		return yield* commit(publication);
	});
