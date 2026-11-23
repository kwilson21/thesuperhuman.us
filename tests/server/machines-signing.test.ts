import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AGREEMENT_EVENTS,
	AGREEMENT_MOVES,
	AGREEMENT_SIGNED,
	AGREEMENT_STATUSES,
	agreementAllows,
	agreementDocument,
} from "../../src/server/machines/agreement-document";
import {
	agreementMessage,
	MESSAGE_EVENTS,
	MESSAGE_MOVES,
	MESSAGE_STATUSES,
	messageAllows,
} from "../../src/server/machines/agreement-message";
import {
	agreementPacket,
	PACKET_EVENTS,
	PACKET_MOVES,
	PACKET_STATUSES,
	packetAllows,
} from "../../src/server/machines/agreement-packet";
import { next } from "../../src/server/machines/next";
import { retireSigning } from "../../src/server/offers-store";
import { boundQuery } from "../helpers/d1";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The signing area's machines (docs/plans/2026-11-signing-conversion.md, section 1). The store builds its
// `status IN (...)` lists from the MOVES; these tests hold the lists to the machines, the states to the columns' CHECK
// lists, and the statements that already live in a converted store (the offers store's retirement) to the machine.

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

/** The values of `status`'s CHECK in the table's CREATE statement, in order. */
const checkOf = (table: string) => {
	const create = migration
		.split("\n")
		.find((line) => line.startsWith(`CREATE TABLE ${table} (`));

	const list = create?.match(
		/status TEXT[^,]*?CHECK\(status IN \(([^)]*)\)\)/,
	)?.[1];

	return list?.split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
};

describe("an agreement document", () => {
	it("is reviewed again only while in review, signed from review, and retired only from review", () => {
		expect(AGREEMENT_MOVES.REVIEW).toEqual(["review"]);
		expect(AGREEMENT_MOVES.SIGN).toEqual(["review"]);
		expect(AGREEMENT_MOVES.RETIRE).toEqual(["review"]);
	});

	it("is countersigned or abandoned only once the client signed", () => {
		expect(AGREEMENT_MOVES.COUNTERSIGN).toEqual(["client_signed"]);
		expect(AGREEMENT_MOVES.ABANDON).toEqual(["client_signed"]);
	});

	it("is ended only once executed or abandoned, and held or given a copy record from every state", () => {
		expect(AGREEMENT_MOVES.END).toEqual(["executed", "abandoned"]);
		expect(AGREEMENT_MOVES.HOLD).toEqual([...AGREEMENT_STATUSES]);
		expect(AGREEMENT_MOVES.RECORD_COPY).toEqual([...AGREEMENT_STATUSES]);
	});

	it("keeps its state on the moves that write beside it", () => {
		for (const status of AGREEMENT_STATUSES) {
			expect(next(agreementDocument, status, "HOLD")).toBe(status);
			expect(next(agreementDocument, status, "RECORD_COPY")).toBe(status);
		}

		expect(next(agreementDocument, "executed", "END")).toBe("executed");
		expect(next(agreementDocument, "abandoned", "END")).toBe("abandoned");
	});

	it("leaves review only by signing or retirement, and client_signed only by countersign or abandon", () => {
		expect(next(agreementDocument, "review", "SIGN")).toBe("client_signed");
		expect(next(agreementDocument, "review", "RETIRE")).toBe("abandoned");
		expect(next(agreementDocument, "client_signed", "COUNTERSIGN")).toBe(
			"executed",
		);
		expect(next(agreementDocument, "client_signed", "ABANDON")).toBe(
			"abandoned",
		);

		for (const event of AGREEMENT_EVENTS) {
			expect(agreementAllows("executed", event)).toBe(
				["END", "HOLD", "RECORD_COPY"].includes(event),
			);
			expect(agreementAllows("abandoned", event)).toBe(
				["END", "HOLD", "RECORD_COPY"].includes(event),
			);
		}
	});

	it("counts as signed (A3) in exactly the states SIGN and COUNTERSIGN lead to", () => {
		expect(AGREEMENT_SIGNED).toEqual([
			next(agreementDocument, "review", "SIGN"),
			next(agreementDocument, "client_signed", "COUNTERSIGN"),
		]);
	});

	it("names exactly the statuses the column's CHECK allows", () => {
		expect(checkOf("software_agreements")).toEqual([...AGREEMENT_STATUSES]);
		expect(Object.keys(agreementDocument.config.states ?? {})).toEqual([
			...AGREEMENT_STATUSES,
		]);
	});

	it("is retired by the offers store from the statuses RETIRE allows", () => {
		const statements = retireSigning(
			sqliteD1(new DatabaseSync(":memory:")),
			"request",
			{
				at: "2026-11-23T00:00:00.000Z",
				retainUntil: "2033-11-23T00:00:00.000Z",
			},
		).flatMap((statement) => boundQuery(statement) ?? []);

		const abandon = statements.find((sql) =>
			sql.startsWith("UPDATE software_agreements SET status='abandoned'"),
		);

		expect(abandon).toBeDefined();
		expect(abandon).toContain(
			`status=${AGREEMENT_MOVES.RETIRE.map((status) => `'${status}'`).join()}`,
		);
	});
});

describe("a signed copy", () => {
	it("is claimed from pending or failed, and ends ready or failed only from rendering", () => {
		expect(PACKET_MOVES.CLAIM).toEqual(["pending", "failed"]);
		expect(PACKET_MOVES.READY).toEqual(["rendering"]);
		expect(PACKET_MOVES.FAIL).toEqual(["rendering"]);
	});

	it("is recovered from rendering only when the owner confirmed a stale attempt", () => {
		expect(PACKET_MOVES.RECOVER).toEqual(["rendering"]);
		expect(packetAllows("rendering", "RECOVER")).toBe(false);
		expect(packetAllows("rendering", "RECOVER", true)).toBe(true);
		expect(
			next(agreementPacket, "rendering", "RECOVER", { recoverable: true }),
		).toBe("failed");
	});

	it("has no move out of ready", () => {
		for (const event of PACKET_EVENTS)
			expect(packetAllows("ready", event, true)).toBe(false);
	});

	it("names exactly the statuses the column's CHECK allows", () => {
		expect(checkOf("software_agreement_artifacts")).toEqual([
			...PACKET_STATUSES,
		]);
		expect(Object.keys(agreementPacket.config.states ?? {})).toEqual([
			...PACKET_STATUSES,
		]);
	});
});

describe("a copy or a signing notice", () => {
	it("is claimed from pending, and ends sent or failed only from sending", () => {
		expect(MESSAGE_MOVES.CLAIM).toEqual(["pending"]);
		expect(MESSAGE_MOVES.SEND).toEqual(["sending"]);
		expect(MESSAGE_MOVES.FAIL).toEqual(["sending"]);
		expect(MESSAGE_MOVES.OBSOLETE).toEqual(["sending"]);
	});

	it("is reset from failed, and from sending only when confirmed and stale, never from pending", () => {
		expect(MESSAGE_MOVES.RESET).toEqual(["failed"]);
		expect(MESSAGE_MOVES.RESET_RETRYABLE).toEqual(["sending"]);
		expect(messageAllows("sending", "RESET")).toBe(false);
		expect(messageAllows("sending", "RESET", true)).toBe(true);
		expect(messageAllows("pending", "RESET", true)).toBe(false);
	});

	it("has no move out of sent", () => {
		for (const event of MESSAGE_EVENTS)
			expect(messageAllows("sent", event, true)).toBe(false);
	});

	it("names exactly the statuses both columns' CHECK allows", () => {
		expect(checkOf("software_agreement_deliveries")).toEqual([
			...MESSAGE_STATUSES,
		]);
		expect(checkOf("software_agreement_notifications")).toEqual([
			...MESSAGE_STATUSES,
		]);
		expect(Object.keys(agreementMessage.config.states ?? {})).toEqual([
			...MESSAGE_STATUSES,
		]);
	});
});
