import { describe, expect, it } from "vitest";
import type { DepositInvoice } from "../../src/lib/software-deposit-block";
import type { AgreementTemplate } from "../../src/lib/agreement-templates";
import { OFFER_MOVES } from "../../src/server/machines/offer-version";
import { depositAllowsSend } from "../../src/server/rules/offer-deposit";
import {
	attachmentDigestMatches,
	attachmentObjectSized,
	attachmentRowFound,
	type ContractorConfig,
	packetReady,
	pinContractor,
	pinDetails,
	pinOf,
	pinReusedMsa,
	pinTemplates,
} from "../../src/server/rules/offer-pin";
import {
	afterSendEmail,
	chooseOffer,
	type MailOutcome,
	type OfferChoice,
	offerLink,
	type SendFacts,
	type SendRequest,
	type SendWrite,
	sendOffer,
} from "../../src/server/rules/offer-send";
import {
	agreementDetails,
	attachment,
	contractorValues,
	inOrder,
	NOW,
	offer,
	offerTerms,
	outcome,
	refusalFacts,
	run,
	softwareRequest,
	wrote,
} from "../helpers/offer-rules";

// The send's rules (docs/plans/2026-11-offers-conversion.md, sections 2 and 3, "send"), stage by stage in the route's
// order: the offer it sends, the deposits, the agreement it pins, the link, what only the batch checked before, and the
// answer after the email.

const TERMS = JSON.stringify(offerTerms);

describe("choosing the offer a send sends", () => {
	const draft = offer({
		id: "o2",
		version: 2,
		status: "draft",
		terms_json: TERMS,
		updated_at: "2026-11-15T09:30:00.000Z",
	});

	const sent = offer({
		id: "o1",
		version: 1,
		status: "sent",
		terms_json: TERMS,
		updated_at: "2026-11-14T09:30:00.000Z",
		sent_at: "2026-11-14T09:30:00.000Z",
	});

	const choose = (s: {
		version: number;
		expected: string;
		offers: ReturnType<typeof offer>[];
		sending: boolean;
	}) =>
		run(
			chooseOffer.decide(
				{ version: s.version, expectedUpdatedAt: s.expected, now: NOW },
				{ offers: s.offers, sending: s.sending },
			),
		);

	it("refuses still sending, then no offer at the page's version, then terms that are not JSON, then terms that do not read", () => {
		expect(
			inOrder(
				{
					version: 9,
					expected: draft.updated_at,
					offers: [{ ...draft, terms_json: "" }],
					sending: true,
				},
				choose,
				[
					(s) => ({ ...s, sending: false }),
					(s) => ({ ...s, version: 2 }),
					(s) => ({
						...s,
						offers: [
							{
								...draft,
								terms_json: JSON.stringify({ ...offerTerms, outcome: "" }),
							},
						],
					}),
					(s) => ({ ...s, offers: [draft] }),
				],
			),
		).toEqual([
			"OfferStillSending",
			"NoOfferToSend",
			"StoredTermsUnreadable",
			"StoredTermsInvalid",
			"writes",
		]);
	});

	it("sends the open draft when there is one, even when the page names the sent version", () => {
		expect(
			outcome(
				choose({
					version: 1,
					expected: sent.updated_at,
					offers: [draft, sent],
					sending: false,
				}),
			),
		).toBe("NoOfferToSend");

		const choice = wrote(
			choose({
				version: 2,
				expected: draft.updated_at,
				offers: [draft, sent],
				sending: false,
			}),
		);

		expect(choice.offer).toBe(draft);
		expect(choice.move).toBe("SEND");
		expect(choice.terms).toEqual(offerTerms);
	});

	it("reissues the sent version when no draft is open, at the time as read", () => {
		const late = { ...sent, updated_at: "2026-11-15T12:00:09.000Z" };

		expect(
			wrote(
				choose({
					version: 1,
					expected: late.updated_at,
					offers: [late],
					sending: false,
				}),
			),
		).toMatchObject({ offer: late, move: "REISSUE", at: NOW });
	});

	it("sends neither a superseded nor a withdrawn version", () => {
		for (const status of ["superseded", "withdrawn"] as const)
			expect(
				outcome(
					choose({
						version: 1,
						expected: sent.updated_at,
						offers: [{ ...sent, status }],
						sending: false,
					}),
				),
			).toBe("NoOfferToSend");
	});

	it("writes a draft's send one millisecond past its updated_at when that is not earlier", () => {
		const recent = { ...draft, updated_at: NOW };

		expect(
			wrote(
				choose({
					version: 2,
					expected: NOW,
					offers: [recent],
					sending: false,
				}),
			).at,
		).toBe("2026-11-15T12:00:00.001Z");
	});

	it("refuses empty stored terms as unreadable, and carries the errors of terms that do not read", () => {
		expect(
			outcome(
				choose({
					version: 2,
					expected: draft.updated_at,
					offers: [{ ...draft, terms_json: "" }],
					sending: false,
				}),
			),
		).toBe("StoredTermsUnreadable");
		expect(
			refusalFacts(
				choose({
					version: 2,
					expected: draft.updated_at,
					offers: [{ ...draft, terms_json: "{}" }],
					sending: false,
				}),
			),
		).toMatchObject({
			refused: "StoredTermsInvalid",
			errors: { outcome: "This answer is required." },
		});
	});
});

describe("the deposits a send of the open draft reads", () => {
	const deposit = (status: string, offerStatus = "sent"): DepositInvoice => ({
		milestoneIndex: 0,
		kind: "deposit",
		status,
		refunded: false,
		offerStatus,
	});

	const allow = (invoices: DepositInvoice[]) =>
		run(depositAllowsSend.decide(null, { invoices }));

	it("refuses an open deposit first, then one paid on the sent offer, then one paid earlier", () => {
		expect(
			inOrder(
				[deposit("open"), deposit("paid"), deposit("paid", "withdrawn")],
				allow,
				[
					(invoices) => invoices.slice(1),
					(invoices) => invoices.slice(1),
					() => [deposit("void")],
				],
			),
		).toEqual([
			"DepositOpen",
			"DepositPaidOnSentOffer",
			"DepositPaidEarlier",
			"writes",
		]);
	});
});

describe("pinning the agreement", () => {
	it("refuses details that are not JSON or do not match the terms without errors, and a reader's refusal with them", () => {
		const pin = (stored: string | null) =>
			run(pinDetails.decide({ terms: offerTerms }, { stored }));

		// No details read as null, which the details reader refuses at the top, as the route always answered it.
		expect(refusalFacts(pin(null))).toEqual({
			refused: "DetailsIncomplete",
			errors: { "agreement.": "Expected object, received null" },
		});
		expect(refusalFacts(pin("not json"))).toEqual({
			refused: "DetailsIncomplete",
			errors: undefined,
		});
		expect(
			refusalFacts(
				// Details for two milestones, where the terms have one: the check against the terms, which gives no errors.
				pin(
					JSON.stringify({
						...agreementDetails,
						milestones: [
							{ start: "2026-10-01", target: "2026-10-10", handoff: "One" },
							{ start: "2026-10-11", target: "2026-10-20", handoff: "Two" },
						],
					}),
				),
			),
		).toEqual({ refused: "DetailsIncomplete", errors: undefined });
		expect(
			refusalFacts(
				pin(JSON.stringify({ ...agreementDetails, environment: "" })),
			),
		).toEqual({
			refused: "DetailsIncomplete",
			errors: { "agreement.environment": "This answer is required." },
		});
		expect(wrote(pin(JSON.stringify(agreementDetails)))).toMatchObject({
			environment: "Browser",
			attachments: [attachment],
		});
	});

	const template = (kind: "msa" | "sow"): AgreementTemplate => ({
		id: `${kind}-1`,
		kind,
		version: 1,
		text: "",
		sha256: "",
		version_label: null,
		source_revision: null,
		published_at: NOW,
	});

	const config: ContractorConfig = {
		version: 3,
		values_json: JSON.stringify(contractorValues),
	};

	it("refuses a missing template or contractor config", () => {
		const facts = { msa: template("msa"), sow: template("sow"), config };

		for (const missing of ["msa", "sow", "config"] as const)
			expect(
				outcome(run(pinTemplates.decide(null, { ...facts, [missing]: null }))),
			).toBe("TemplatesMissing");
		expect(wrote(run(pinTemplates.decide(null, facts)))).toEqual(facts);
	});

	it("refuses contractor details that are not JSON without errors, and a reader's refusal with them", () => {
		expect(
			refusalFacts(
				run(
					pinContractor.decide(null, {
						config: { ...config, values_json: "{" },
					}),
				),
			),
		).toEqual({ refused: "DetailsIncomplete", errors: undefined });
		expect(
			refusalFacts(
				run(
					pinContractor.decide(null, {
						config: {
							...config,
							values_json: JSON.stringify({
								...contractorValues,
								legal_name: "",
							}),
						},
					}),
				),
			),
		).toMatchObject({
			refused: "DetailsIncomplete",
			errors: { "agreement.legal_name": "This answer is required." },
		});
	});

	it("refuses an unusable reused MSA, and each attachment by its row, its object and size, then its digest", () => {
		expect(outcome(run(pinReusedMsa.decide(null, { reusable: false })))).toBe(
			"MsaUnavailable",
		);
		expect(
			outcome(run(attachmentRowFound.decide(null, { found: false }))),
		).toBe("DetailsIncomplete");

		for (const object of [null, { size: attachment.bytes + 1 }])
			expect(
				outcome(run(attachmentObjectSized.decide(attachment, { object }))),
			).toBe("DetailsIncomplete");
		expect(
			outcome(
				run(
					attachmentObjectSized.decide(attachment, {
						object: { size: attachment.bytes },
					}),
				),
			),
		).toBe("writes");
		expect(
			outcome(
				run(
					attachmentDigestMatches.decide(attachment, {
						sha256: "b".repeat(64),
					}),
				),
			),
		).toBe("DetailsIncomplete");
		expect(outcome(run(packetReady.decide(null, { ready: false })))).toBe(
			"DetailsIncomplete",
		);
	});

	it("pins the details, the template ids, the contractor with the config's version and the address", () => {
		const details = wrote(
			run(
				pinDetails.decide(
					{ terms: offerTerms },
					{ stored: JSON.stringify(agreementDetails) },
				),
			),
		);

		const contractor = wrote(run(pinContractor.decide(null, { config })));

		expect(
			wrote(
				run(
					pinOf.decide(null, {
						details,
						templates: { msa: template("msa"), sow: template("sow"), config },
						contractor,
						email: "  Ada@Example.TEST ",
					}),
				),
			),
		).toEqual({
			details: JSON.stringify(details),
			msa: "msa-1",
			sow: "sow-1",
			contractor: JSON.stringify({ ...contractor, config_version: 3 }),
			email: "ada@example.test",
			attachments: [attachment],
		});
	});
});

describe("the offer link", () => {
	const link = (siteOrigin: string | undefined) =>
		run(offerLink.decide({ token: "t".repeat(43) }, { siteOrigin }));

	it("is built on SITE_ORIGIN's origin, or the site's own when it is not set", () => {
		expect(wrote(link(undefined))).toBe(
			`https://thesuperhuman.us/offer/${"t".repeat(43)}`,
		);
		expect(wrote(link("https://staging.example.test/path"))).toBe(
			`https://staging.example.test/offer/${"t".repeat(43)}`,
		);
	});

	it("is refused for a SITE_ORIGIN that is not a URL, or empty", () => {
		expect(outcome(link("not a url"))).toBe("LinkNotBuilt");
		expect(outcome(link(""))).toBe("LinkNotBuilt");
	});
});

describe("sending the offer", () => {
	const draftChoice: OfferChoice = {
		offer: offer({ id: "o2", version: 2, status: "draft", terms_json: TERMS }),
		move: "SEND",
		terms: offerTerms,
		at: NOW,
	};

	const reissueChoice: OfferChoice = {
		offer: offer({
			id: "o1",
			version: 1,
			status: "sent",
			terms_json: TERMS,
			sent_at: "2026-11-14T09:30:00.000Z",
			msa_template_id: "msa-1",
		}),
		move: "REISSUE",
		terms: offerTerms,
		at: NOW,
	};

	const pin = {
		details: "{}",
		msa: "msa-1",
		sow: "sow-1",
		contractor: "{}",
		email: "ada@example.test",
		attachments: [attachment],
	};

	const command = (over: Partial<SendRequest> = {}): SendRequest => ({
		choice: draftChoice,
		pin: null,
		link: { href: "https://thesuperhuman.us/offer/t", tokenHash: "h" },
		signingEnabled: false,
		actor: "owner@example.test",
		...over,
	});

	const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
		request: softwareRequest(),
		signedAgreement: false,
		linkRow: null,
		closedKeys: [],
		...over,
	});

	const send = (c: SendRequest, f: SendFacts) => run(sendOffer.decide(c, f));

	it("refuses a signed agreement, then a reissue whose link is not revoked, then a pinned attachment in a closed archive", () => {
		expect(
			inOrder(
				{
					c: command({ choice: reissueChoice }),
					f: facts({ signedAgreement: true }),
				},
				(s) => send(s.c, s.f),
				[
					(s) => ({ ...s, f: { ...s.f, signedAgreement: false } }),
					(s) => ({
						...s,
						f: {
							...s.f,
							linkRow: { created_at: NOW, revoked_at: NOW },
						},
					}),
				],
			),
		).toEqual(["AgreementSigned", "LinkNotRevoked", "writes"]);
		expect(
			inOrder(
				{
					c: command({ pin }),
					f: facts({ signedAgreement: true, closedKeys: [attachment.key] }),
				},
				(s) => send(s.c, s.f),
				[
					(s) => ({ ...s, f: { ...s.f, signedAgreement: false } }),
					(s) => ({ ...s, f: { ...s.f, closedKeys: [] } }),
				],
			),
		).toEqual(["AgreementSigned", "AttachmentNotUsable", "writes"]);
	});

	it("refuses a reissue when the request has no link, or a live one", () => {
		for (const linkRow of [null, { created_at: NOW, revoked_at: null }])
			expect(
				outcome(send(command({ choice: reissueChoice }), facts({ linkRow }))),
			).toBe("LinkNotRevoked");
	});

	it("sends the draft, superseding the sent version, or reissues, by the machine's moves", () => {
		expect(wrote(send(command(), facts())).move).toEqual({
			kind: "send",
			supersede: OFFER_MOVES.SUPERSEDE,
			markSent: OFFER_MOVES.SEND,
		});
		expect(
			wrote(
				send(
					command({ choice: reissueChoice }),
					facts({ linkRow: { created_at: NOW, revoked_at: NOW } }),
				),
			).move,
		).toEqual({ kind: "reissue", move: OFFER_MOVES.REISSUE });
	});

	it("writes the batch with the offer as read, the link, the pin, signing retired and the audit", () => {
		expect(wrote(send(command({ pin }), facts()))).toMatchObject({
			request: { id: "r1", updatedAt: "2026-11-15T10:00:00.000Z" },
			at: NOW,
			offer: {
				id: "o2",
				version: 2,
				status: "draft",
				updatedAt: "2026-11-15T09:30:00.000Z",
				sentAt: null,
			},
			link: { href: "https://thesuperhuman.us/offer/t", tokenHash: "h" },
			pin,
			audit: { action: "offer-sent", note: "Offer v2 sent" },
			to: "ada@example.test",
		});
	});

	it("tells the client to sign on the website only with signing on and an MSA template pinned", () => {
		const text = (c: SendRequest, f = facts()) => wrote(send(c, f)).email.text;

		const website = "Review and sign on the website.";
		const outside = "We will arrange for you to sign outside the website.";

		expect(text(command({ signingEnabled: true, pin }))).toContain(website);
		expect(text(command({ signingEnabled: false, pin }))).toContain(outside);
		expect(text(command({ signingEnabled: true }))).toContain(outside);
		expect(
			text(
				command({ signingEnabled: true, choice: reissueChoice }),
				facts({ linkRow: { created_at: NOW, revoked_at: NOW } }),
			),
		).toContain(website);
	});

	it("writes the email the route always wrote, greeting by first name or 'there'", () => {
		expect(wrote(send(command(), facts())).email).toEqual({
			subject: "Your project offer: Onboarding",
			text: "Hi Ada,\n\nHere’s the offer for Onboarding: https://thesuperhuman.us/offer/t\n\nWe will arrange for you to sign outside the website.\n\nThe link is private to you. You can forward it to whoever approves the budget. Reply to this email with any questions.\n\nKazon",
		});
		expect(
			wrote(
				send(command(), facts({ request: softwareRequest({ name: "   " }) })),
			).email.text,
		).toMatch(/^Hi there,/);
	});
});

describe("the send's answer after its email", () => {
	const write: SendWrite = {
		request: {
			id: "r1",
			updatedAt: "2026-11-15T10:00:00.000Z",
			status: "new",
			email: "ada@example.test",
		},
		at: NOW,
		actor: "owner@example.test",
		offer: {
			id: "o1",
			version: 1,
			status: "sent",
			updatedAt: "2026-11-14T09:30:00.000Z",
			sentAt: "2026-11-14T09:30:00.000Z",
		},
		move: { kind: "reissue", move: OFFER_MOVES.REISSUE },
		link: { href: "https://thesuperhuman.us/offer/t", tokenHash: "h" },
		pin: null,
		signing: { at: NOW, retainUntil: NOW },
		audit: { action: "offer-sent", note: "Offer v1 sent" },
		to: "ada@example.test",
		email: { subject: "s", text: "t" },
	};

	const after = (mail: MailOutcome, live: boolean, w = write) =>
		run(afterSendEmail.decide({ write: w, mail }, { live }));

	it("refuses a closed link, saying the email went out only when it was accepted (F9)", () => {
		expect(outcome(after({ sent: "accepted", copySent: true }, false))).toBe(
			"LinkClosedWhileSending",
		);

		for (const sent of ["refused", "uncertain", "not-configured"] as const)
			expect(outcome(after({ sent, copySent: false }, false))).toBe(
				"LinkClosedAfterFailedEmail",
			);
	});

	it("answers a reissue with the offer's own sent and updated times, and a send with the write time", () => {
		expect(wrote(after({ sent: "accepted", copySent: true }, true))).toEqual({
			version: 1,
			link: "https://thesuperhuman.us/offer/t",
			linkCreatedAt: NOW,
			sentAt: "2026-11-14T09:30:00.000Z",
			updatedAt: "2026-11-14T09:30:00.000Z",
			emailSent: true,
			uncertain: undefined,
			copySent: true,
		});
		expect(
			wrote(
				after({ sent: "accepted", copySent: false }, true, {
					...write,
					move: {
						kind: "send",
						supersede: OFFER_MOVES.SUPERSEDE,
						markSent: OFFER_MOVES.SEND,
					},
				}),
			),
		).toMatchObject({ sentAt: NOW, updatedAt: NOW, copySent: false });
	});

	it("says uncertain only for a client email that failed, as the route always did", () => {
		const uncertain = (sent: MailOutcome["sent"]) =>
			wrote(after({ sent, copySent: false }, true)).uncertain;

		expect(uncertain("refused")).toBe(false);
		expect(uncertain("uncertain")).toBe(true);
		expect(uncertain("not-configured")).toBeUndefined();
		expect(uncertain("accepted")).toBeUndefined();
	});
});
