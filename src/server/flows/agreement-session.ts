// A visitor's signing or archive session: the cookie's token, hashed, finds the stored row; the rules in
// src/server/rules/agreement-session.ts say whether it still counts. The two reads (the session, and for a signing session
// the offer it names) are plain; no statement decides. Shared by the download and attachment routes. The shared function
// in src/lib/agreement-access.ts (`agreementSession`) stays in place for the offer routes, which are a later area.
import * as Effect from "effect/Effect";
import { studioSessionFromRequest } from "../../lib/audio-client-access";
import { hashValue } from "../../lib/client-portal";
import { hashOfferToken } from "../../lib/software-offers";
import { sessionTokenOf } from "../agreement-input";
import { hashing } from "../agreement-services";
import {
	readSession,
	readSigningOffer,
	readStudioSession,
} from "../agreement-store";
import {
	openSession,
	openStudioSession,
	signingIsLive,
	type StoredAgreementSession,
} from "../rules/agreement-session";

/** The visitor's open session of this purpose, or null when they have none (no cookie, not found, expired, or not live). */
export const visitorSession = (
	request: Request,
	purpose: "agreement" | "archive",
	now: () => Date,
) =>
	Effect.gen(function* () {
		const token = sessionTokenOf(request, purpose);

		if (token === null) return null;

		const hash = yield* hashing(() => hashOfferToken(token));
		const row = yield* readSession(hash, purpose);

		if (row === null) return null;

		const open = yield* openSession.decide({ now: now() }, row);

		const offer = purpose === "agreement" ? yield* readSigningOffer(open) : [];

		return yield* signingIsLive.decide({ session: open }, offer);
	}).pipe(
		Effect.catchTag("SessionNotOpen", () =>
			Effect.succeed<StoredAgreementSession | null>(null),
		),
	);

/** The visitor's open studio session (its email, even when empty), or null when they have none. */
export const studioIdentity = (request: Request, now: () => Date) =>
	Effect.gen(function* () {
		const token = studioSessionFromRequest(request);

		if (!token) return null;

		const hash = yield* hashing(() => hashValue(token));
		const row = yield* readStudioSession(hash);

		if (row === null) return null;

		return yield* openStudioSession.decide({ now: now() }, row);
	}).pipe(
		Effect.catchTag("StudioSessionNotOpen", () =>
			Effect.succeed<{ readonly email: string } | null>(null),
		),
	);
