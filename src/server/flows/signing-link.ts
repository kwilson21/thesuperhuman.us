// The signing link: a visitor on an offer's page asks for the link that opens its agreement, and it is mailed to the
// offer's recipient (POST /api/offer/[token]/link; docs/plans/2026-11-signing-conversion.md, section 3). The order is the
// one the route has always kept, because each step after the reads is a write or an outside call: the signing setting,
// the offer the token names and its recipient; the client address counted, the captcha, the recipient counted; the
// visitor's own session (only for the receipt's address); the instant; then the link, decided from what A4 and A1
// re-check, read just before its batch; the brief's name and the terms' outcome for the mail; the mail; and after it,
// either the link taken back with the uses it counted (a refused mail) or the recipient's older links consumed. Every
// decision is a rule in src/server/rules/signing-offer.ts, signing-link.ts and agreement-link.ts (the allowance and the
// older links, shared with the archive link). The link batch's guards (A4, A1) re-check at write time, and a guard that
// raised reads and decides again, three tries in all (`alwaysDecideAndSave`), each with the first instant and its own
// link id, key and event id, drawn in the order the route has always drawn them; a third raise is the cooldown's 429.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { hashOfferToken } from "../../lib/software-offers";
import {
	AgreementAllowance,
	AgreementMail,
	hashing,
} from "../agreement-services";
import {
	consumeLinks,
	readBriefName,
	readLinkedOffer,
	readRecentSigningLinks,
	readSigningEnabled,
	readSigningFacts,
	readSigningLinks,
	removeRefusedLink,
	storeSigningLink,
} from "../agreement-store";
import { alwaysDecideAndSave } from "../guarded-save";
import {
	COOLDOWN_MS,
	CooldownRunning,
	consumeOlderLinks,
	SecurityCheckFailed,
	withinAllowance,
} from "../rules/agreement-link";
import {
	linkRecipient,
	MailRefused,
	issueSigningLink,
	refundAllowances,
	SIGNING_ADDRESS_ALLOWANCE,
	SIGNING_EMAIL_ALLOWANCE,
	signingMail,
	signingOn,
} from "../rules/signing-link";
import { linkedOffer, OfferUnavailable } from "../rules/signing-offer";
import { Turnstile } from "../services";
import { visitorSession } from "./agreement-session";

/** An offer token's shape: 43 URL-safe characters. A token of another shape names no offer and is never read. */
const OFFER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type SigningLinkRequest = {
	/** The offer token from the path, as it arrived. */
	readonly token: string;
	/** The visitor's request, for the signing session its cookie may name. */
	readonly request: Request;
	readonly turnstileToken: string;
	/** The address Cloudflare saw. */
	readonly ip: string;
	/** The sender of the mail (env.CONTACT_FROM_EMAIL). */
	readonly from: string;
	/** The site origin the link points at. */
	readonly origin: string;
	/** The time, read at each point the flow needs it, as the route always has. */
	readonly now: () => Date;
	readonly newId: () => string;
	readonly newToken: () => string;
};

/** The link was mailed (or its mail's outcome is not known): the address the receipt names, in full or masked. */
export type SigningLinkAnswer = { readonly receiptAddress: string };

/** The sent offer the token names, or OfferUnavailable; a token of another shape is refused without a read. */
const offerNamedBy = (token: string) =>
	Effect.gen(function* () {
		if (!OFFER_TOKEN.test(token))
			return yield* Effect.fail(new OfferUnavailable());

		const tokenHash = yield* hashing(() => hashOfferToken(token));
		const rows = yield* readLinkedOffer(tokenHash);
		const offer = yield* linkedOffer.decide(null, rows);

		return { offer, tokenHash };
	});

export const requestSigningLink = (request: SigningLinkRequest) =>
	Effect.gen(function* () {
		yield* readSigningEnabled().pipe(
			Effect.flatMap((setting) => signingOn.decide(null, setting)),
		);

		const { offer, tokenHash } = yield* offerNamedBy(request.token);
		const recipient = yield* linkRecipient.decide(null, offer);
		const allowances = yield* AgreementAllowance;
		const { ip } = request;

		// The client address is counted first and coarsely, so the captcha service is not asked without bound; the
		// recipient is counted only once the captcha passed, so bots cannot spend a recipient's allowance.
		const addressUse = yield* allowances.reserve(
			SIGNING_ADDRESS_ALLOWANCE.scope,
			ip,
			SIGNING_ADDRESS_ALLOWANCE.limit,
		);

		yield* withinAllowance.decide(null, addressUse);

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(request.turnstileToken, ip)
			.pipe(Effect.mapError(() => new SecurityCheckFailed()));

		const recipientUse = yield* allowances.reserve(
			SIGNING_EMAIL_ALLOWANCE.scope,
			recipient,
			SIGNING_EMAIL_ALLOWANCE.limit,
		);

		yield* withinAllowance.decide(null, recipientUse);

		const session = yield* visitorSession(
			request.request,
			"agreement",
			request.now,
		);

		// The link's instant is read once, after the session, and kept by every try: a retry that read the clock again
		// could find the 30-second window free where the first try found it taken.
		const at = request.now();

		const linkRequest = {
			at,
			offerId: offer.id,
			recipient,
			session,
		};

		const issued = yield* alwaysDecideAndSave({
			facts: Effect.gen(function* () {
				const signing = yield* readSigningFacts({
					offerId: offer.id,
					linkHash: tokenHash,
				});

				// Only the links A4 counts: those issued in the 30 seconds before the instant (#393, item 2).
				const since = new Date(at.getTime() - COOLDOWN_MS).toISOString();
				const links = yield* readRecentSigningLinks(recipient, offer.id, since);

				return { signing, links };
			}),
			decide: (facts) => issueSigningLink.decide(linkRequest, facts),
			save: (write) =>
				Effect.gen(function* () {
					// Drawn for each try in the order the route has always drawn them: the link id, its key, and (as the store
					// builds the batch) the event id.
					const id = request.newId();
					const key = request.newToken();
					const hash = yield* hashing(() => hashOfferToken(key));
					const actorHash = yield* hashing(() => hashOfferToken(id));

					yield* storeSigningLink({
						id,
						hash,
						actorHash,
						offerId: offer.id,
						linkHash: tokenHash,
						recipient,
						at: write.at,
						since: write.since,
						expiresAt: write.expiresAt,
					});

					return { id, key };
				}),
		}).pipe(
			Effect.catchTag("SaveKeptChanging", () =>
				Effect.fail(new CooldownRunning()),
			),
		);

		const { id, key } = issued.saved;
		const { at: issuedAt, receiptAddress } = issued.decided;
		const url = new URL(`/offer/${request.token}/verify`, request.origin);

		url.searchParams.set("key", key);

		const name = yield* readBriefName(offer.request_id);

		// The terms are the offer's as stored and are read here only for their outcome, as text in the mail, as the route
		// has always read them: terms that are not JSON throw, which is a defect by design (the route's fixed 500, logged
		// once), after the link is stored and before any mail.
		const outcome = yield* Effect.sync(
			(): string => `${JSON.parse(offer.terms_json).outcome}`,
		);

		const mail = signingMail({ name, outcome, url: url.href });
		const sender = yield* AgreementMail;

		const sent = yield* sender.send({
			from: request.from,
			to: [recipient],
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		});

		const refund = yield* refundAllowances.decide(
			{ linkId: id },
			{
				outcome: sent,
				uses: [addressUse, recipientUse].map((use) => ({
					key: use.key,
					window_start: use.window_start,
				})),
			},
		);

		if (Option.isSome(refund)) {
			yield* removeRefusedLink(refund.value);

			return yield* Effect.fail(new MailRefused());
		}

		const older = yield* readSigningLinks(recipient, offer.id).pipe(
			Effect.flatMap((links) =>
				consumeOlderLinks.decide({ id, at: issuedAt }, links),
			),
		);

		yield* consumeLinks(older.ids, issuedAt);

		return { receiptAddress } satisfies SigningLinkAnswer;
	});
