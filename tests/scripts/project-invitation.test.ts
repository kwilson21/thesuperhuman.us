import { afterEach, expect, it, vi } from "vitest";
import { setupProjectInvitation } from "../../src/scripts/project-invitation";

afterEach(() => {
	vi.unstubAllGlobals();
});

const BRIEF_COPY = "[data-brief-copy]";
const INVITATION = "[data-project-invitation]";

/** Clicks the page's one button against a stubbed answer and reports what the page did. */
async function click(selector: string, answer: Response | "network-failure") {
	let onClick: (() => Promise<void>) | undefined;

	const button = {
		disabled: false,
		dataset: { confirmedNotSent: "true" },
		addEventListener: (_type: string, listener: () => Promise<void>) => {
			onClick = listener;
		},
	};

	const status = { textContent: "" };
	const reload = vi.fn();

	const root = {
		dataset: { endpoint: "/api/endpoint" },
		querySelector: (inner: string) =>
			inner === "[data-send-project-invitation]" ? button : status,
	};

	const fetchStub = vi.fn(async () => {
		if (answer === "network-failure") throw new Error("offline");

		return answer;
	});

	vi.stubGlobal("document", { querySelector: () => root });
	vi.stubGlobal("location", { reload });
	vi.stubGlobal("fetch", fetchStub);
	setupProjectInvitation(selector);
	await onClick?.();

	return {
		reload,
		status: status.textContent,
		disabled: button.disabled,
		sent: fetchStub.mock.calls.length,
	};
}

it("reloads the page after a brief copy answers 500, so the recorded status and its buttons show", async () => {
	const result = await click(
		BRIEF_COPY,
		Response.json({ ok: false, error: "x" }, { status: 500 }),
	);

	expect(result.sent).toBe(1);
	expect(result.reload).toHaveBeenCalledTimes(1);
});

it("reloads the page after a brief copy answers 200", async () => {
	const result = await click(BRIEF_COPY, Response.json({ ok: true }));

	expect(result.reload).toHaveBeenCalledTimes(1);
});

it("does not reload after a brief copy answers 409 and shows the sentence", async () => {
	const result = await click(
		BRIEF_COPY,
		Response.json(
			{ ok: false, error: "This brief copy cannot be sent again here." },
			{ status: 409 },
		),
	);

	expect(result.reload).not.toHaveBeenCalled();
	expect(result.status).toBe("This brief copy cannot be sent again here.");
	expect(result.disabled).toBe(false);
});

it("does not reload after a brief copy answers 503", async () => {
	const result = await click(
		BRIEF_COPY,
		Response.json({ ok: false, error: "y" }, { status: 503 }),
	);

	expect(result.reload).not.toHaveBeenCalled();
});

it("keeps the invitation button unchanged: a 500 does not reload", async () => {
	const result = await click(
		INVITATION,
		Response.json({ ok: false, error: "z" }, { status: 500 }),
	);

	expect(result.reload).not.toHaveBeenCalled();
	expect(result.status).toBe("z");
});
