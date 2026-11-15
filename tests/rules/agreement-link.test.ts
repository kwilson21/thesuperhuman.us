import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
	afterMail,
	consumeOlderLinks,
	issueArchiveLink,
	signerName,
	takeCooldown,
	withinAllowance,
	type StoredArchiveLink,
	type StoredSignature,
} from "../../src/server/rules/agreement-link";

// The archive link rules as stories: the allowances, the cooldown, whether and when a link is issued, who is greeted, and
// which older links the new one consumes.

type Said = { refused: string } | { nothing: true } | { wrote: unknown };

const said = <W, E extends { _tag: string }>(
	decided: Effect.Effect<Option.Option<W> | W, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag }),
			onSuccess: (value) =>
				Option.isOption(value)
					? Option.isSome(value)
						? { wrote: value.value }
						: { nothing: true as const }
					: { wrote: value },
		}),
	);

const AT = new Date("2026-11-13T12:00:00.000Z");

describe("an allowance", () => {
	it("admits a request that is within it and refuses one that is not", () => {
		expect(said(withinAllowance.decide(null, { allowed: true }))).toEqual({
			wrote: {},
		});
		expect(said(withinAllowance.decide(null, { allowed: false }))).toEqual({
			refused: "TooManyLinks",
		});
	});
});

describe("the cooldown", () => {
	const take = (windowStart: string | null) =>
		said(takeCooldown.decide({ at: AT }, { windowStart }));

	const taken = {
		wrote: {
			at: "2026-11-13T12:00:00.000Z",
			since: "2026-11-13T11:59:30.000Z",
		},
	};

	it("is taken when the address has no cooldown row", () => {
		expect(take(null)).toEqual(taken);
	});

	it("is taken when the row is exactly 30 seconds old or older", () => {
		expect(take("2026-11-13T11:59:30.000Z")).toEqual(taken);
		expect(take("2026-11-13T11:00:00.000Z")).toEqual(taken);
	});

	it("is refused when the row is under 30 seconds old", () => {
		expect(take("2026-11-13T11:59:30.001Z")).toEqual({
			refused: "CooldownRunning",
		});
		expect(take("2026-11-13T12:00:00.000Z")).toEqual({
			refused: "CooldownRunning",
		});
	});
});

const link = (over: Partial<StoredArchiveLink> = {}): StoredArchiveLink => ({
	id: "old",
	issued_at: "2026-11-13T11:50:00.000Z",
	used_at: null,
	...over,
});

describe("issuing an archive link", () => {
	const issue = (
		agreementStatuses: string[],
		links: StoredArchiveLink[] = [],
	) =>
		said(issueArchiveLink.decide(null, { agreementStatuses, links, at: AT }));

	const issued = {
		wrote: {
			at: "2026-11-13T12:00:00.000Z",
			since: "2026-11-13T11:59:30.000Z",
			expiresAt: "2026-11-13T13:00:00.000Z",
		},
	};

	it("issues a link, valid for an hour, when the address has an executed agreement", () => {
		expect(issue(["review", "executed"])).toEqual(issued);
	});

	it("has nothing to do for an address with no executed agreement, whatever else it has", () => {
		expect(issue([])).toEqual({ nothing: true });
		expect(issue(["review", "client_signed", "abandoned"])).toEqual({
			nothing: true,
		});
		expect(
			issue(["review"], [link({ issued_at: "2026-11-13T11:59:59.000Z" })]),
		).toEqual({ nothing: true });
	});

	it("is refused with the cooldown's sentence when a link was issued in the last 30 seconds", () => {
		expect(
			issue(["executed"], [link({ issued_at: "2026-11-13T11:59:40.000Z" })]),
		).toEqual({
			refused: "CooldownRunning",
		});
	});

	it("is not held back by a link issued exactly 30 seconds ago or earlier", () => {
		expect(
			issue(["executed"], [link({ issued_at: "2026-11-13T11:59:30.000Z" })]),
		).toEqual(issued);
	});

	it("counts a used link too, as the guard did", () => {
		expect(
			issue(
				["executed"],
				[
					link({
						issued_at: "2026-11-13T11:59:50.000Z",
						used_at: "2026-11-13T11:59:51.000Z",
					}),
				],
			),
		).toEqual({ refused: "CooldownRunning" });
	});
});

describe("the greeting", () => {
	const sig = (over: Partial<StoredSignature>): StoredSignature => ({
		typed_name: "Grace",
		party: "client",
		signed_at: "2026-11-13T10:00:00.000Z",
		status: "executed",
		...over,
	});

	const name = (rows: StoredSignature[]) => said(signerName.decide(null, rows));

	it("is the latest client signature on an executed agreement", () => {
		expect(
			name([
				sig({ typed_name: "Older", signed_at: "2026-01-01T00:00:00.000Z" }),
				sig({ typed_name: "Newest", signed_at: "2026-11-01T00:00:00.000Z" }),
				sig({ typed_name: "Middle", signed_at: "2026-06-01T00:00:00.000Z" }),
			]),
		).toEqual({ wrote: "Newest" });
	});

	it("takes the first of two equally recent signatures", () => {
		expect(
			name([sig({ typed_name: "First" }), sig({ typed_name: "Second" })]),
		).toEqual({ wrote: "First" });
	});

	it("ignores the contractor's signature and agreements that are not executed", () => {
		expect(
			name([
				sig({
					typed_name: "Owner",
					party: "contractor",
					signed_at: "2026-12-01T00:00:00.000Z",
				}),
				sig({
					typed_name: "Draft",
					status: "client_signed",
					signed_at: "2026-12-01T00:00:00.000Z",
				}),
				sig({ typed_name: "Grace" }),
			]),
		).toEqual({ wrote: "Grace" });
	});

	it("is none when there is no such signature", () => {
		expect(name([])).toEqual({ wrote: null });
		expect(name([sig({ status: "review" })])).toEqual({ wrote: null });
	});
});

describe("consuming the older links", () => {
	const consume = (links: StoredArchiveLink[]) =>
		said(
			consumeOlderLinks.decide(
				{ id: "new", at: "2026-11-13T12:00:00.000Z" },
				links,
			),
		);

	it("consumes the unused links issued no later than the new one, but not the new one", () => {
		expect(
			consume([
				link({ id: "a" }),
				link({ id: "new", issued_at: "2026-11-13T12:00:00.000Z" }),
				link({ id: "b", issued_at: "2026-11-13T12:00:00.000Z" }),
			]),
		).toEqual({ wrote: { at: "2026-11-13T12:00:00.000Z", ids: ["a", "b"] } });
	});

	it("leaves used links and links issued later alone", () => {
		expect(
			consume([
				link({ id: "used", used_at: "2026-11-13T11:55:00.000Z" }),
				link({ id: "later", issued_at: "2026-11-13T12:00:00.001Z" }),
			]),
		).toEqual({ wrote: { at: "2026-11-13T12:00:00.000Z", ids: [] } });
	});
});

describe("what follows the mail", () => {
	it("marks the new link used when the mail was refused, and consumes the older links otherwise", () => {
		expect(said(afterMail.decide(null, { outcome: "refused" }))).toEqual({
			wrote: "mark-used",
		});
		expect(said(afterMail.decide(null, { outcome: "sent" }))).toEqual({
			wrote: "consume-older",
		});
		expect(said(afterMail.decide(null, { outcome: "uncertain" }))).toEqual({
			wrote: "consume-older",
		});
	});
});
