import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendUrgentOwnerAlert } from "~/lib/owner-alerts";
import { partial } from "../helpers/doubles";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchMock = vi.fn<typeof fetch>(async () =>
		partial<Response>({ ok: true, status: 200 }),
	);
	vi.stubGlobal("fetch", fetchMock);
});

describe("urgent owner alerts", () => {
	it("sends only a safe category, route, request ID, code and time", async () => {
		const ok = await sendUrgentOwnerAlert(
			partial<Env>({
				RESEND_API_KEY: "secret",
				CONTACT_FROM_EMAIL: "noreply@notifs.thesuperhuman.us",
				CONTACT_TO_EMAIL: "owner@example.com",
			}),
			{
				category: "request-storage",
				route: "/api/audio-intake",
				requestId: "request-123",
				code: "d1-write-failed",
				occurredAt: "2026-09-19T12:00:00.000Z",
			},
		);

		expect(ok).toBe(true);

		const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

		expect(payload.text).toContain("request-123");
		expect(payload.text).not.toContain("artist@example.com");
		expect(payload.reply_to).toBeUndefined();
		expect(JSON.stringify(payload)).not.toContain("secret");
	});

	it("stays quiet when alert delivery is not configured", async () => {
		await expect(
			sendUrgentOwnerAlert(partial<Env>({}), {
				category: "request-storage",
				route: "/api/music-interest",
				requestId: "request-456",
				code: "d1-write-failed",
				occurredAt: "2026-09-19T12:00:00.000Z",
			}),
		).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
