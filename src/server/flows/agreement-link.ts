// The archive link: a client asks for a link to the signed agreements kept for their address. The order is the one the
// route has always kept, and it matters because each step is a write or an outside call: the address is counted coarsely
// first, then the captcha is checked, then the address is counted for the email, then the 30-second cooldown is taken. Only
// then is the address looked up. The receipt is the same for every address; an address with no executed agreement gets it
// without a link or a mail. Every decision is a rule in src/server/rules/agreement-link.ts: the limits, the cooldown, the
// 30-second guard, which older links are consumed. The two writes with a guard (the cooldown row, the link batch) use
// `decideAndSave`: the rule judges from a read, the guard re-checks at write time, and a lost guard reads and judges
// again (three tries), then answers the cooldown's sentence. The clock is read where the route has always read it: once
// for the cooldown (kept across its retries), and once per attempt after the address is read for the link.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { normalizeClientEmail } from "../../lib/audio-client-access";
import { hashOfferToken } from "../../lib/software-offers";
import {
	AgreementAllowance,
	AgreementMail,
	hashing,
} from "../agreement-services";
import {
	consumeLinks,
	markLinkUsed,
	readArchiveLinks,
	readCooldown,
	readLinkFacts,
	readSignatures,
	saveCooldown,
	storeArchiveLink,
} from "../agreement-store";
import { decideAndSave } from "../guarded-save";
import {
	ADDRESS_ALLOWANCE,
	afterMail,
	archiveMail,
	consumeOlderLinks,
	CooldownRunning,
	EMAIL_ALLOWANCE,
	InvalidEmail,
	issueArchiveLink,
	SecurityCheckFailed,
	signerName,
	takeCooldown,
	withinAllowance,
} from "../rules/agreement-link";
import { Turnstile } from "../services";

export type ArchiveLinkRequest = {
	readonly email: string;
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

export type ArchiveLinkAnswer = { readonly sent: boolean };

export const requestArchiveLink = (request: ArchiveLinkRequest) =>
	Effect.gen(function* () {
		const allowances = yield* AgreementAllowance;
		const { ip } = request;

		const email = yield* Effect.fromNullishOr(
			normalizeClientEmail(request.email),
		).pipe(Effect.mapError(() => new InvalidEmail()));

		yield* withinAllowance.decide(null, {
			allowed: yield* allowances.reserve(
				ADDRESS_ALLOWANCE.scope,
				ip,
				ADDRESS_ALLOWANCE.limit,
			),
		});

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(request.turnstileToken, ip)
			.pipe(Effect.mapError(() => new SecurityCheckFailed()));

		yield* withinAllowance.decide(null, {
			allowed: yield* allowances.reserve(
				EMAIL_ALLOWANCE.scope,
				email,
				EMAIL_ALLOWANCE.limit,
			),
		});

		const cooling = request.now();

		const cooldownKey = yield* allowances.keyed(
			`archive-link-cooldown:${email}`,
		);

		yield* decideAndSave({
			facts: readCooldown(cooldownKey),
			decide: (facts) =>
				takeCooldown
					.decide({ at: cooling }, facts)
					.pipe(Effect.map(Option.some)),
			save: (write) => saveCooldown(cooldownKey, write.at, write.since),
		}).pipe(
			Effect.catchTag("SaveKeptChanging", () =>
				Effect.fail(new CooldownRunning()),
			),
		);

		// The link's instant is read once, after the first read of the address, and kept by every retry (as `cooling` is):
		// a retry that read the clock again could find the window free where the first attempt found it taken.
		const linkAt = yield* Effect.cached(Effect.sync(() => request.now()));

		const issued = yield* decideAndSave({
			facts: Effect.gen(function* () {
				const read = yield* readLinkFacts(email);

				return { ...read, at: yield* linkAt };
			}),
			decide: (facts) => issueArchiveLink.decide(null, facts),
			save: (write) =>
				Effect.gen(function* () {
					const id = request.newId();
					const key = request.newToken();
					const hash = yield* hashing(() => hashOfferToken(key));
					const actorHash = yield* hashing(() => hashOfferToken(id));

					yield* storeArchiveLink({
						id,
						hash,
						email,
						at: write.at,
						actorHash,
						expiresAt: write.expiresAt,
						since: write.since,
					});

					return { id, key, at: write.at };
				}),
		}).pipe(
			Effect.catchTag("SaveKeptChanging", () =>
				Effect.fail(new CooldownRunning()),
			),
		);

		// A link was stored only when the rule had something to do; otherwise the receipt is given with no link and no mail.
		if (issued.saved === undefined)
			return { sent: false } satisfies ArchiveLinkAnswer;

		const { id, key, at } = issued.saved;

		const url = new URL("/agreements/verify", request.origin);

		url.searchParams.set("key", key);

		const name = yield* readSignatures(email).pipe(
			Effect.flatMap((rows) => signerName.decide(null, rows)),
		);

		const mail = archiveMail({ name, url: url.href });
		const sender = yield* AgreementMail;

		const outcome = yield* sender.send({
			from: request.from,
			to: [email],
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		});

		const next = yield* afterMail.decide(null, { outcome });

		if (next === "mark-used") yield* markLinkUsed(id, at);
		else {
			const older = yield* readArchiveLinks(email).pipe(
				Effect.flatMap((links) => consumeOlderLinks.decide({ id, at }, links)),
			);

			yield* consumeLinks(older.ids, at);
		}

		return { sent: true } satisfies ArchiveLinkAnswer;
	});
