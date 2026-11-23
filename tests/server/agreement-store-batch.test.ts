import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AgreementStoreFailed,
	refusedBatch,
} from "../../src/server/agreement-store";
import { GuardRefused } from "../../src/server/guarded-save";
import { DatabaseSync } from "../helpers/sqlite-d1";

// What a rejected batch of the signing area is (docs/plans/2026-11-signing-conversion.md, section 4): a raised JSON
// guard or one of the raise-only triggers of the signing migration is GuardRefused; anything else is a store failure
// with its cause.

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

const triggerMessages = [
	...migration.matchAll(/RAISE\(ABORT,'([^']*)'\)/g),
].map((match) => match[1]);

describe("a rejected batch", () => {
	it("is refused for every raise-only trigger of the signing migration, as SQLite words it", () => {
		expect(triggerMessages).toHaveLength(7);

		for (const message of triggerMessages) {
			const database = new DatabaseSync(":memory:");

			database.exec(
				`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('a');
				CREATE TRIGGER t_raise BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT,'${message}'); END;`,
			);

			let raised: unknown;

			try {
				database.exec("UPDATE t SET v='b'");
			} catch (error) {
				raised = error;
			}

			expect(refusedBatch(raised)).toBeInstanceOf(GuardRefused);
		}
	});

	it("is refused for a raised JSON guard, found down the cause chain", () => {
		const guard = new Error("D1_ERROR: malformed JSON: SQLITE_ERROR");

		expect(refusedBatch(guard)).toBeInstanceOf(GuardRefused);
		expect(
			refusedBatch(new Error("D1_ERROR", { cause: guard })),
		).toBeInstanceOf(GuardRefused);
		expect(
			refusedBatch(
				new Error("D1_ERROR", {
					cause: new Error("Archive cleanup is reserved"),
				}),
			),
		).toBeInstanceOf(GuardRefused);
	});

	it("is a store failure carrying its cause for anything else", () => {
		const unique = new Error(
			"D1_ERROR: UNIQUE constraint failed: software_agreement_signatures.agreement_id",
		);

		const outage = new Error("D1_ERROR: Network connection lost.");

		for (const cause of [unique, outage, "not an error", null]) {
			const answer = refusedBatch(cause);

			expect(answer).toBeInstanceOf(AgreementStoreFailed);
			expect(answer).toMatchObject({ failure: cause });
		}

		expect(refusedBatch(new Error("Immutable things"))).toBeInstanceOf(
			AgreementStoreFailed,
		);
	});
});
