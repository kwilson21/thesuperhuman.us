import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	decideDownload,
	intactSignedCopy,
	readySignedCopy,
	verifiedVisitor,
	type DownloadAgreement,
	type DownloadFacts,
	type StudioProject,
} from "../../src/server/rules/agreement-download";

// The download rules as stories: who may download which signed copy, and which copy is intact.

const run = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (value) => ({ kept: value }),
		}),
	);

const agreement = (
	over: Partial<DownloadAgreement> = {},
): DownloadAgreement => ({
	id: "a1",
	offer_id: "o1",
	request_id: "r1",
	recipient_email: "grace@example.test",
	status: "executed",
	archive_closed_at: null,
	...over,
});

const project = (over: Partial<StudioProject> = {}): StudioProject => ({
	request_id: "r1",
	agreement_id: "a1",
	linked_msa_id: null,
	request_status: "open",
	request_email: "grace@example.test",
	revoked_at: null,
	content_deleted_at: null,
	...over,
});

const nobody: DownloadFacts = {
	agreement: agreement(),
	archive: null,
	signing: null,
	studio: null,
	signingReusedMsaId: null,
	studioProjects: [],
};

const decide = (over: Partial<DownloadFacts>, id = "a1") =>
	run(decideDownload.decide({ id }, { ...nobody, ...over }));

const allowed = { kept: { id: "a1" } };
const refused = { refused: "AgreementNotFound", say: "Not found" };

describe("a visitor with no session", () => {
	it("is asked to verify", () => {
		expect(
			run(
				verifiedVisitor.decide(null, {
					archive: null,
					signing: null,
					studio: null,
				}),
			),
		).toEqual({
			refused: "SignInFirst",
			say: "Verify your agreement email first.",
		});
	});

	it.each([
		[
			"an archive session",
			{ archive: { recipient_email: "" }, signing: null, studio: null },
		],
		[
			"a signing session",
			{
				archive: null,
				signing: { recipient_email: "", offer_id: null },
				studio: null,
			},
		],
		[
			"a studio session with an empty email",
			{ archive: null, signing: null, studio: { email: "" } },
		],
	])("is verified with %s", (_name, sessions) => {
		expect(run(verifiedVisitor.decide(null, sessions))).toEqual({
			kept: sessions,
		});
	});
});

describe("the archive session", () => {
	it("downloads an agreement of its own address", () => {
		expect(
			decide({ archive: { recipient_email: "grace@example.test" } }),
		).toEqual(allowed);
	});

	it("is refused another address, with the same answer as an unknown id", () => {
		expect(
			decide({ archive: { recipient_email: "other@example.test" } }),
		).toEqual(refused);
		expect(
			decide({
				agreement: null,
				archive: { recipient_email: "grace@example.test" },
			}),
		).toEqual(refused);
	});

	it("is refused when the agreement is not executed", () => {
		for (const status of ["review", "client_signed", "abandoned"])
			expect(
				decide({
					agreement: agreement({ status }),
					archive: { recipient_email: "grace@example.test" },
				}),
			).toEqual(refused);
	});

	it("is refused when the archive is closed", () => {
		expect(
			decide({
				agreement: agreement({ archive_closed_at: "2026-11-01T00:00:00.000Z" }),
				archive: { recipient_email: "grace@example.test" },
			}),
		).toEqual(refused);
	});
});

describe("the signing session", () => {
	const signing = { recipient_email: "grace@example.test", offer_id: "o1" };

	it("downloads the agreement of its own offer", () => {
		expect(decide({ signing })).toEqual(allowed);
	});

	it("downloads an agreement its offer reuses as the master agreement", () => {
		expect(
			decide({
				signing: { ...signing, offer_id: "o2" },
				signingReusedMsaId: "a1",
			}),
		).toEqual(allowed);
	});

	it("is refused another offer's agreement that its offer does not reuse", () => {
		expect(
			decide({
				signing: { ...signing, offer_id: "o2" },
				signingReusedMsaId: "a9",
			}),
		).toEqual(refused);
	});

	it("is refused another address even for the same offer", () => {
		expect(
			decide({ signing: { ...signing, recipient_email: "x@example.test" } }),
		).toEqual(refused);
	});

	it("matches a missing offer to a missing offer, as the comparison always did", () => {
		expect(
			decide({
				agreement: agreement({ offer_id: null }),
				signing: { ...signing, offer_id: null },
			}),
		).toEqual(allowed);
	});
});

describe("the studio session", () => {
	const studio = { email: "grace@example.test" };

	it("downloads the agreement its project names", () => {
		expect(decide({ studio, studioProjects: [project()] })).toEqual(allowed);
	});

	it("downloads the master agreement its project's agreement is linked to", () => {
		expect(
			decide({
				studio,
				studioProjects: [
					project({ agreement_id: "a-sow", linked_msa_id: "a1" }),
				],
			}),
		).toEqual(allowed);
	});

	it("is refused when the project names another agreement", () => {
		expect(
			decide({ studio, studioProjects: [project({ agreement_id: "a9" })] }),
		).toEqual(refused);
	});

	it("is refused when the project is for another request", () => {
		expect(
			decide({ studio, studioProjects: [project({ request_id: "r9" })] }),
		).toEqual(refused);
	});

	it("is refused when the project has no agreement", () => {
		expect(
			decide({ studio, studioProjects: [project({ agreement_id: null })] }),
		).toEqual(refused);
	});

	it.each([
		["the brief is withdrawn", { request_status: "withdrawn" }],
		["the brief has no email", { request_email: "" }],
		["the project was revoked", { revoked_at: "2026-11-01T00:00:00.000Z" }],
		[
			"the project's content was deleted",
			{ content_deleted_at: "2026-11-01T00:00:00.000Z" },
		],
	])("is refused when %s", (_name, over) => {
		expect(decide({ studio, studioProjects: [project(over)] })).toEqual(
			refused,
		);
	});

	it("is refused another address", () => {
		expect(
			decide({
				studio: { email: "x@example.test" },
				studioProjects: [project()],
			}),
		).toEqual(refused);
	});

	it("with an empty email matches nothing but an empty address, and never a project with no email", () => {
		expect(
			decide({
				studio: { email: "" },
				studioProjects: [project({ request_email: "" })],
			}),
		).toEqual(refused);
		expect(
			decide({ studio: { email: "" }, studioProjects: [project()] }),
		).toEqual(refused);
	});
});

describe("no session at all", () => {
	it("is refused with the same answer as everything else", () => {
		expect(decide({})).toEqual(refused);
	});
});

describe("the signed copy", () => {
	it("is read when it is ready and names an object", () => {
		expect(
			run(
				readySignedCopy.decide(null, {
					status: "ready",
					pdf_key: "k",
					pdf_sha256: "d",
				}),
			),
		).toEqual({ kept: { pdf_key: "k", pdf_sha256: "d" } });
	});

	it.each([
		["there is no row", null],
		["it is pending", { status: "pending", pdf_key: "k", pdf_sha256: "d" }],
		["it failed", { status: "failed", pdf_key: "k", pdf_sha256: "d" }],
		[
			"it is ready but names no object",
			{ status: "ready", pdf_key: null, pdf_sha256: "d" },
		],
		[
			"it is ready with an empty key",
			{ status: "ready", pdf_key: "", pdf_sha256: "d" },
		],
	])("is not ready when %s", (_name, stored) => {
		expect(run(readySignedCopy.decide(null, stored))).toEqual({
			refused: "CopyNotReady",
			say: "Signed by both parties. Copy preparation needs attention.",
		});
	});

	it("is intact only when the stored digest is there and the bytes have it", () => {
		expect(
			run(intactSignedCopy.decide({ bytesSha256: "d" }, { pdf_sha256: "d" })),
		).toEqual({ kept: {} });

		for (const stored of [null, "", "other"])
			expect(
				run(
					intactSignedCopy.decide({ bytesSha256: "d" }, { pdf_sha256: stored }),
				),
			).toEqual({
				refused: "CopyIntegrity",
				say: "Signed copy failed its integrity check. Contact Kazon.",
			});
	});
});
