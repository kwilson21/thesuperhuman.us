import type { APIContext } from "astro";
import { expect, it } from "vitest";
import { double } from "../helpers/doubles";
import { testRuntime } from "../helpers/tests-api-runtime";
import { POST as revokeAccess } from "~/pages/api/owner/projects/[id]/access";
import { POST as fileAction } from "~/pages/api/owner/projects/[id]/files/[fileId]";

it("keeps file and project revocation behind the owner and portal gates", async () => {
	const request = new Request(
		"https://thesuperhuman.us/api/owner/projects/song-1/access",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "revoke" }),
		},
	);

	const context = double<APIContext>({
		params: { id: "song-1" },
		request,
		locals: { runtime: testRuntime({ AUDIO_CLIENT_PORTAL_ENABLED: "false" }) },
	});

	expect((await revokeAccess(context)).status).toBe(403);
	context.locals.owner = { email: "owner@example.com" };
	expect((await revokeAccess(context)).status).toBe(404);
	expect(
		(
			await fileAction({
				...context,
				params: { id: "song-1", fileId: "review-1" },
			})
		).status,
	).toBe(404);
});
