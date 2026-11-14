// The archive link: a client asks for a link to the signed agreements kept for their address. The order is the one the
// route has always kept, and the order matters because each step is a write or an outside call: the address is counted
// coarsely first, then the captcha is checked, then the address is counted for the email, then the 30-second cooldown is
// taken. Only then is the address looked up. The receipt is the same for every address; an address with no executed
// agreement gets it without a link or a mail. A failed guard in the link batch is a refusal (the same 429 sentence as the
// cooldown); any other failure is a defect.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { normalizeClientEmail } from "../../lib/audio-client-access";
import { hashOfferToken } from "../../lib/software-offers";
import {
	hasExecutedAgreement,
	markLinkUsed,
	consumeOlderArchiveLinks,
	signerName,
	storeArchiveLink,
	takeCooldown,
} from "../agreement-store";
import { AgreementAllowance, AgreementMail } from "../agreement-services";
import { MusicDb, Turnstile } from "../services";
import {
	archiveMail,
	COOLDOWN,
	CROWDED,
	INVALID_EMAIL,
	SECURITY_AGAIN,
	issueArchiveLink,
} from "../rules/agreement-link";

export class InvalidEmail extends Data.TaggedError("InvalidEmail") {
	readonly say = INVALID_EMAIL;
}

/** The per-address or per-client-address allowance is used up: a few minutes' wait. */
export class TooManyLinks extends Data.TaggedError("TooManyLinks") {
	readonly say = CROWDED;
}

export class SecurityCheckFailed extends Data.TaggedError(
	"SecurityCheckFailed",
) {
	readonly say = SECURITY_AGAIN;
}

/** The cooldown is running: the last link for this address is under 30 seconds old. */
export class CooldownRunning extends Data.TaggedError("CooldownRunning") {
	readonly say = COOLDOWN;
}

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

const hashed = (value: string) =>
	Effect.tryPromise({
		try: () => hashOfferToken(value),
		catch: (cause) => cause,
	}).pipe(Effect.orDie);

export const requestArchiveLink = (request: ArchiveLinkRequest) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const allowances = yield* AgreementAllowance;
		const { ip } = request;

		const email = normalizeClientEmail(request.email);

		if (!email) return yield* Effect.fail(new InvalidEmail());

		if (!(yield* allowances.reserve("archive-link-ip", ip, 20)))
			return yield* Effect.fail(new TooManyLinks());

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(request.turnstileToken, ip)
			.pipe(Effect.mapError(() => new SecurityCheckFailed()));

		if (!(yield* allowances.reserve("archive-link-email", email, 3)))
			return yield* Effect.fail(new TooManyLinks());

		const cooling = request.now();

		const cooldownKey = yield* allowances.keyed(
			`archive-link-cooldown:${email}`,
		);

		const taken = yield* takeCooldown(
			db,
			cooldownKey,
			cooling.toISOString(),
			new Date(cooling.getTime() - 30000).toISOString(),
		);

		if (!taken) return yield* Effect.fail(new CooldownRunning());

		const found = yield* hasExecutedAgreement(db, email);

		const decision = yield* issueArchiveLink.decide(null, {
			hasExecutedAgreement: found,
		});

		// Nothing to do: the address has no executed agreement, so the receipt is given with no link and no mail.
		if (Option.isNone(decision))
			return { sent: false } satisfies ArchiveLinkAnswer;

		const at = request.now(),
			id = request.newId(),
			key = request.newToken(),
			hash = yield* hashed(key),
			actorHash = yield* hashed(id);

		yield* storeArchiveLink({
			db,
			id,
			hash,
			email,
			at: at.toISOString(),
			actorHash,
			expiresAt: new Date(at.getTime() + 3600000).toISOString(),
			since: new Date(at.getTime() - 30000).toISOString(),
		}).pipe(Effect.mapError(() => new CooldownRunning()));

		const url = new URL("/agreements/verify", request.origin);

		url.searchParams.set("key", key);

		const name = yield* signerName(db, email);
		const mail = archiveMail({ name, url: url.href });
		const sender = yield* AgreementMail;

		const outcome = yield* sender.send({
			from: request.from,
			to: [email],
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		});

		if (outcome === "refused") yield* markLinkUsed(db, id, at.toISOString());
		else yield* consumeOlderArchiveLinks(db, email, id, at.toISOString());

		return { sent: true } satisfies ArchiveLinkAnswer;
	});
