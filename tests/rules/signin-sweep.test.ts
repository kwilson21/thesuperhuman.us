import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { AddressCode } from "../../src/server/rules/signin-issue";
import { sweepCodes } from "../../src/server/rules/signin-sweep";

// The sweep rule (docs/plans/2026-11-studio-signin-conversion.md, section 2): which of the address's rows a code request
// deletes, the case tests/lib/signin-code-rules.test.ts held `decideIssue`'s expired rows to. It refuses nothing, so the
// sweep is written whatever the issue answers; the database re-checks each row at write time (C3).

const now = "2026-11-13T12:00:00.000Z";
const later = "2026-11-13T12:10:00.000Z";

const row = (nonceHash: string, over: Partial<AddressCode> = {}) => ({
	nonceHash,
	email: "artist@example.com",
	codeHash: `code-${nonceHash}`,
	usedAt: null,
	expiresAt: later,
	...over,
});

const swept = (codes: readonly AddressCode[]) =>
	Effect.runSync(sweepCodes.decide({ now }, { codes }));

describe("sweeping an address's expired codes", () => {
	it("names the expired rows it was given, the instant of expiry included, each with the code it held", () => {
		expect(
			swept([
				row("old", { expiresAt: now }),
				row("older", { expiresAt: "2026-11-13T11:00:00.000Z" }),
				row("live"),
				row("soon", { expiresAt: "2026-11-13T12:00:00.001Z" }),
			]),
		).toEqual({
			expired: [
				{ nonceHash: "old", codeHash: "code-old" },
				{ nonceHash: "older", codeHash: "code-older" },
			],
		});
	});

	it("sweeps a used row past its lifetime, and keeps a used row that has not expired", () => {
		expect(
			swept([
				row("used-old", { usedAt: "2026-11-13T10:00:00.000Z", expiresAt: now }),
				row("used-live", { usedAt: "2026-11-13T11:59:00.000Z" }),
			]),
		).toEqual({
			expired: [{ nonceHash: "used-old", codeHash: "code-used-old" }],
		});
	});

	it("names nothing when nothing has expired, or there are no rows", () => {
		expect(swept([row("live")])).toEqual({ expired: [] });
		expect(swept([])).toEqual({ expired: [] });
	});
});
