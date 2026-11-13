import type { APIContext } from "astro";
import { expect, it } from "vitest";
import { POST } from "~/pages/api/owner/projects/[id]/files/[fileId]";
import { partial } from "../helpers/doubles";
import { testRuntime } from "../helpers/runtime";

it("keeps file publication behind owner access and the disabled portal gate", async () => {
	const request = new Request(
		"https://thesuperhuman.us/api/owner/projects/song-1/files/review-1",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "publish",
				note: "Ready for review.",
				downloadable: false,
			}),
		},
	);

	const context = partial<APIContext>({
		params: { id: "song-1", fileId: "review-1" },
		request,
		locals: { runtime: testRuntime({ AUDIO_CLIENT_PORTAL_ENABLED: "false" }) },
	});

	expect((await POST(context)).status).toBe(403);
	context.locals.owner = { email: "owner@example.com" };
	expect((await POST(context)).status).toBe(404);
});
