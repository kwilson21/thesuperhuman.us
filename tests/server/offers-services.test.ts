import * as Effect from "effect/Effect";
import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { hashBytes } from "../../src/lib/agreement-artifacts";
import type {
	AgreementDetails,
	Contractor,
} from "../../src/lib/agreement-fields";
import type { AgreementTemplate } from "../../src/lib/agreement-templates";
import { PreflightReadFailed } from "../../src/lib/agreement-pdf";
import {
	AgreementPreflight,
	AttachmentReadFailed,
	AttachmentRemoveFailed,
	AttachmentStore,
	AttachmentUnhashable,
	liveAgreementPreflight,
	liveOfferMail,
	OffersStorageMissing,
	offerMailSettings,
	offerPayload,
	PacketNotReady,
	PacketReadFailed,
	type PreflightPacket,
} from "../../src/server/offers-services";
import { declineRequest } from "../../src/server/rules/offer-decline";
import { askQuestion } from "../../src/server/rules/offer-question";
import { sendOffer } from "../../src/server/rules/offer-send";
import {
	type EmailWords,
	offerEmails,
} from "../../src/server/rules/software-request";
import { AudioBucket, Mail, type MailMessage } from "../../src/server/services";
import { double } from "../helpers/doubles";
import { resendBodies } from "../helpers/offers-golden";
import {
	NOW,
	offer,
	offerTerms,
	softwareRequest,
	wrote,
	run,
} from "../helpers/offer-rules";

// The offers route's outside calls (src/server/offers-services.ts): its own live Mail, whose request bodies must be the
// bytes the old route sent (the golden corpus recorded them); the agreement attachments in R2; and the packet's preflight,
// each failure by name.

// ---- mail ----

let fetchMock: Mock<typeof fetch>;
let bodies: string[];

beforeEach(() => {
	bodies = [];
	fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Resend answers each request with the next status, recording the body it was sent. */
function resendAnswers(...statuses: (number | "network-down")[]) {
	let next = 0;

	fetchMock.mockImplementation(async (_url, init) => {
		bodies.push(String(init?.body));

		const status = statuses[next++] ?? 200;

		if (status === "network-down") throw new TypeError("fetch failed");

		return new Response("{}", { status });
	});
}

/** The golden corpus's mail settings. */
const settings = { from: "site@example.test", owner: "owner@example.test" };

/** The request the golden corpus seeds. */
const grace = softwareRequest({
	name: "Grace Hopper",
	email: "grace@example.test",
	status: "reviewed",
});

/** What the live Mail answers for a message: "sent", or the name of its failure. */
const send = (message: MailMessage) =>
	Mail.use((mail) => mail.send(message)).pipe(
		Effect.provideContext(liveOfferMail("key")),
		Effect.match({
			onFailure: (failure) => failure._tag,
			onSuccess: () => "sent",
		}),
		Effect.runPromise,
	);

/** The client email and the owner's copy, as the bridge sends them: the copy only once the client's was accepted. */
async function sendBoth(words: EmailWords) {
	const emails = offerEmails(settings, grace.email, words);

	if ((await send(emails.client)) === "sent") await send(emails.copy);
}

describe("the mail settings", () => {
	const env = {
		RESEND_API_KEY: "key",
		CONTACT_FROM_EMAIL: "site@example.test",
		OWNER_EMAIL: "owner@example.test",
	};

	it("are all three, or none when any is missing or empty", () => {
		expect(offerMailSettings(env)).toEqual({
			apiKey: "key",
			from: "site@example.test",
			owner: "owner@example.test",
		});

		const names: (keyof typeof env)[] = [
			"RESEND_API_KEY",
			"CONTACT_FROM_EMAIL",
			"OWNER_EMAIL",
		];

		for (const name of names) {
			expect(offerMailSettings({ ...env, [name]: "" }), name).toBeNull();
			expect(offerMailSettings({ ...env, [name]: undefined }), name).toBeNull();
		}
	});
});

describe("the live Mail", () => {
	it("sends a question's two emails with the bytes the old route sent", async () => {
		resendAnswers(200, 200);

		const question = wrote(
			run(
				askQuestion.decide(
					{
						text: "Which users will sign in?",
						now: NOW,
						actor: settings.owner,
					},
					{ request: grace, projectStarted: false },
				),
			),
		);

		await sendBoth(question.email);

		expect(bodies).toEqual(
			resendBodies("question", "question: the client and the copy both sent"),
		);
	});

	it("sends a decline's two emails with the bytes the old route sent", async () => {
		resendAnswers(200, 200);

		const decline = wrote(
			run(
				declineRequest.decide(
					{ text: "Not a fit right now.", now: NOW, actor: settings.owner },
					{ request: grace, signedAgreement: false, audioProject: false },
				),
			),
		);

		await sendBoth(decline.email);

		expect(bodies).toEqual(
			resendBodies("decline", "decline: the client and the copy both sent"),
		);
	});

	it("sends an offer's two emails with the bytes the old route sent", async () => {
		resendAnswers(200, 200);

		const terms = { ...offerTerms, outcome: "Client onboarding tracker" };

		const sent = wrote(
			run(
				sendOffer.decide(
					{
						choice: {
							offer: offer({ terms_json: JSON.stringify(terms) }),
							move: "SEND",
							terms,
							at: NOW,
						},
						pin: null,
						link: {
							href: "https://thesuperhuman.us/offer/5bIljgAQHc3Dk5wcD1ZGMt4fStEwTbrOHVjW_H7JK3Y",
							tokenHash: "hash",
						},
						signingEnabled: false,
						actor: settings.owner,
					},
					{
						request: grace,
						signedAgreement: false,
						linkRow: null,
						closed: { keys: [], unreadable: false },
					},
				),
			),
		);

		await sendBoth(sent.email);

		expect(bodies).toEqual(
			resendBodies("offer-send", "send: the client and the copy both sent"),
		);
	});

	it("writes from, reply_to, subject, text, to, in that order, whatever order the message has", () => {
		const message: MailMessage = {
			to: ["grace@example.test"],
			text: "Body",
			subject: "Hello",
			reply_to: "owner@example.test",
			from: "site@example.test",
		};

		expect(Object.keys(offerPayload(message))).toEqual([
			"from",
			"reply_to",
			"subject",
			"text",
			"to",
		]);
	});

	it("names a refused email, and one whose fate is not known", async () => {
		const message = offerEmails(settings, grace.email, {
			subject: "S",
			text: "T",
		}).client;

		resendAnswers(200, 422, 503, "network-down");

		expect(await send(message)).toBe("sent");
		expect(await send(message)).toBe("MailRefused");
		expect(await send(message)).toBe("MailUncertain");
		expect(await send(message)).toBe("MailUncertain");
	});

	it("sends an idempotency key as the header sendAudioMessage sends it in", async () => {
		resendAnswers(200);

		await send({
			...offerEmails(settings, grace.email, { subject: "S", text: "T" }).client,
			idempotencyKey: "once",
		});

		expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
			Authorization: "Bearer key",
			"Content-Type": "application/json",
			"Idempotency-Key": "once",
		});
	});
});

// ---- the attachments in R2 ----

/** Runs the effect with this bucket bound, or none. */
const withBucket = <A, E>(
	effect: Effect.Effect<A, E>,
	bucket: R2Bucket | null,
) =>
	Effect.runPromise(
		Effect.result(
			bucket === null
				? effect
				: effect.pipe(Effect.provideService(AudioBucket, bucket)),
		),
	);

const KEY = "agreements/attachments/123e4567-e89b-42d3-a456-426614174000.pdf";

/** An R2 object of these bytes; `arrayBuffer` counts its reads. */
function stored(bytes: Uint8Array) {
	const reads = { count: 0 };

	const object = double<R2ObjectBody>({
		size: bytes.byteLength,
		arrayBuffer: async () => {
			reads.count += 1;

			return bytes.slice().buffer;
		},
	});

	return { object, reads };
}

describe("AttachmentStore.remove", () => {
	it("deletes the key", async () => {
		const deleted: string[] = [];

		const answer = await withBucket(
			AttachmentStore.remove(KEY),
			double<R2Bucket>({
				delete: async (key: string | string[]) => {
					deleted.push(String(key));
				},
			}),
		);

		expect(answer._tag).toBe("Success");
		expect(deleted).toEqual([KEY]);
	});

	it("fails as a failed delete when the delete rejects, or there is no binding", async () => {
		const rejected = await withBucket(
			AttachmentStore.remove(KEY),
			double<R2Bucket>({
				delete: async () => {
					throw new Error("R2 is down");
				},
			}),
		);

		expect(rejected).toMatchObject({ failure: new AttachmentRemoveFailed() });
		expect(await withBucket(AttachmentStore.remove(KEY), null)).toMatchObject({
			failure: new AttachmentRemoveFailed(),
		});
	});
});

describe("AttachmentStore.read", () => {
	it("is OffersStorageMissing with no binding", async () => {
		expect(await withBucket(AttachmentStore.read(KEY), null)).toMatchObject({
			failure: new OffersStorageMissing(),
		});
	});

	it("carries a rejected get in AttachmentReadFailed", async () => {
		const failure = new Error("R2 is down");

		expect(
			await withBucket(
				AttachmentStore.read(KEY),
				double<R2Bucket>({
					get: async () => {
						throw failure;
					},
				}),
			),
		).toMatchObject({ failure: new AttachmentReadFailed({ failure }) });
	});

	it("answers null for no object, and the size without reading the bytes", async () => {
		expect(
			await withBucket(
				AttachmentStore.read(KEY),
				double<R2Bucket>({ get: async () => null }),
			),
		).toMatchObject({ success: null });

		const bytes = new TextEncoder().encode("%PDF-1.7 attachment");
		const { object, reads } = stored(bytes);

		const read = await Effect.runPromise(
			AttachmentStore.read(KEY).pipe(
				Effect.provideService(
					AudioBucket,
					double<R2Bucket>({ get: async () => object }),
				),
			),
		);

		expect(read?.size).toBe(bytes.byteLength);
		expect(reads.count).toBe(0);
		expect(await Effect.runPromise(read!.sha256())).toBe(
			await hashBytes(bytes),
		);
		expect(reads.count).toBe(1);
	});

	it("names a body that cannot be read, and bytes that cannot be hashed", async () => {
		const failure = new Error("stream reset");

		const unreadable = double<R2ObjectBody>({
			size: 3,
			arrayBuffer: async () => {
				throw failure;
			},
		});

		const read = await Effect.runPromise(
			AttachmentStore.read(KEY).pipe(
				Effect.provideService(
					AudioBucket,
					double<R2Bucket>({ get: async () => unreadable }),
				),
			),
		);

		expect(
			await Effect.runPromise(Effect.result(read!.sha256())),
		).toMatchObject({
			failure: new AttachmentReadFailed({ failure }),
		});

		const { object } = stored(new Uint8Array([1, 2, 3]));

		vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(
			new Error("no digest"),
		);

		const hashed = await Effect.runPromise(
			AttachmentStore.read(KEY).pipe(
				Effect.provideService(
					AudioBucket,
					double<R2Bucket>({ get: async () => object }),
				),
			),
		);

		expect(
			await Effect.runPromise(Effect.result(hashed!.sha256())),
		).toMatchObject({
			failure: new AttachmentUnhashable(),
		});
	});
});

// ---- the preflight ----

const template = (kind: "msa" | "sow"): AgreementTemplate => ({
	id: `template-${kind}`,
	kind,
	version: 1,
	text: kind.toUpperCase(),
	sha256: "0".repeat(64),
	version_label: null,
	source_revision: null,
	published_at: NOW,
});

const packet = (reusedMsaId: string | null = null): PreflightPacket => ({
	terms: offerTerms,
	// SAFETY: the preflight double below never reads the details or the contractor; it only receives them.
	details: {} as AgreementDetails,
	// SAFETY: as above.
	contractor: {} as Contractor,
	templates: [template("msa"), template("sow")],
	reusedMsaId,
});

/** What the live preflight answers for a packet, with this env and module. */
const preflight = (
	env: Partial<Env>,
	preflightAgreementPacket: (...args: unknown[]) => Promise<void>,
	load?: () => Promise<never>,
) =>
	Effect.runPromise(
		Effect.result(
			AgreementPreflight.use((service) => service.check(packet("a1"))).pipe(
				Effect.provideContext(
					liveAgreementPreflight(
						double<Env>(env),
						load ??
							(async () => ({ preflightAgreementPacket, PreflightReadFailed })),
					),
				),
			),
		),
	);

describe("AgreementPreflight", () => {
	const bucket = double<R2Bucket>({});

	it("checks the packet with the env, the inputs and the two templates in order", async () => {
		const calls: unknown[][] = [];

		const answer = await preflight({ AUDIO: bucket }, async (...args) => {
			calls.push(args);
		});

		expect(answer._tag).toBe("Success");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.slice(1)).toEqual([
			offerTerms,
			{},
			{},
			[template("msa"), template("sow")],
			"a1",
		]);
	});

	it("is OffersStorageMissing before the module loads when a reused MSA's copy is in R2 and there is no binding", async () => {
		const load = vi.fn(async () => {
			throw new Error("not loaded");
		});

		expect(await preflight({}, async () => {}, load)).toMatchObject({
			failure: new OffersStorageMissing(),
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("is PacketReadFailed, with the read's failure, when a read the preflight marks failed", async () => {
		const failure = new Error("D1 is down");

		expect(
			await preflight({ AUDIO: bucket }, async () => {
				throw new PreflightReadFailed(failure);
			}),
		).toMatchObject({ failure: new PacketReadFailed({ failure }) });
	});

	it("is PacketNotReady for anything else the preflight throws, or a module that does not load", async () => {
		expect(
			await preflight({ AUDIO: bucket }, async () => {
				throw new Error("Original MSA unavailable.");
			}),
		).toMatchObject({ failure: new PacketNotReady() });

		expect(
			await preflight(
				{ AUDIO: bucket },
				async () => {},
				async () => {
					throw new Error("chunk failed");
				},
			),
		).toMatchObject({ failure: new PacketNotReady() });
	});
});
