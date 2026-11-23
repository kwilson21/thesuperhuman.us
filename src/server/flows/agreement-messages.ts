// The signing area's emails, sent once a legal write has committed (docs/plans/2026-11-signing-conversion.md, section 3,
// "agreement-messages.ts"). Best effort: a failure here never changes what the write answered, and the caller ignores
// each by name. `deliverNotices` sends an agreement's two signing notices, as today's `deliverAgreementNotifications`
// (src/lib/agreement-artifacts.ts) does: nothing when the mail is not configured (no Resend key or sender), before any
// read; then the agreement's request and receipt (`noticeAgreementFound`: nothing when the agreement is gone); then for
// each kind in order, an attempt id and the time drawn, the notice and its agreement read (`noticeClaimable`), the claim
// (A19, a compare-and-set answering the address), the mail with its idempotency key, and the outcome by attempt
// (`messageOutcome`: an uncertain answer writes nothing). The rules are in src/server/rules/agreement-messages.ts.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AgreementMail } from "../agreement-services";
import {
	claimNotice,
	readNoticeAgreement,
	readNoticeClaim,
	recordNoticeOutcome,
} from "../agreement-store";
import {
	messageOutcome,
	NOTICE_KINDS,
	noticeAgreementFound,
	noticeClaimable,
	noticeMessage,
} from "../rules/agreement-messages";

export type NoticesRequest = {
	/** The agreement the notices are about (the SOW). */
	readonly agreementId: string;
	/** The sender (env.CONTACT_FROM_EMAIL). */
	readonly from: string;
	/** The site origin the owner's link points at. */
	readonly origin: string;
	/** The time, read at each point the delivery needs it. */
	readonly now: () => Date;
	/** A new attempt id, one per kind, drawn before its claim. */
	readonly newId: () => string;
};

/** Sends the agreement's signing notices that are pending and current; the mail service is optional (see above). */
export const deliverNotices = (request: NoticesRequest) =>
	Effect.gen(function* () {
		const configured = yield* Effect.serviceOption(AgreementMail);

		if (Option.isNone(configured)) return;

		const id = request.agreementId;

		const found = yield* readNoticeAgreement(id).pipe(
			Effect.flatMap((row) => noticeAgreementFound.decide(null, row)),
		);

		if (Option.isNone(found)) return;

		for (const kind of NOTICE_KINDS) {
			const attempt = request.newId();
			const at = request.now();

			const claim = yield* readNoticeClaim(id, kind).pipe(
				Effect.flatMap((facts) =>
					noticeClaimable.decide({ attempt, at }, facts),
				),
			);

			if (Option.isNone(claim)) continue;

			const email = yield* claimNotice(id, kind, claim.value);

			if (email === null) continue;

			const words = noticeMessage(kind, found.value, request.origin);

			const outcome = yield* configured.value.send(
				{
					from: request.from,
					to: [email],
					subject: words.subject,
					text: words.text,
				},
				`agreement-${id}-${kind}`,
			);

			const settled = yield* messageOutcome.decide(
				{ mail: outcome, at: request.now() },
				null,
			);

			if (Option.isSome(settled))
				yield* recordNoticeOutcome(id, kind, attempt, settled.value);
		}
	});
