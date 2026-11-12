import type { APIContext } from "astro";
import { beforeEach, expect, it, vi, type Mock } from "vitest";
import { double } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/tests-api-runtime";
import { POST } from "~/pages/api/owner/projects/[id]/invitation";
import {
	deliverProjectInvitation,
	queueProjectInvitation,
} from "~/lib/audio-project-invitations";

vi.mock("~/lib/audio-project-invitations", () => ({
	deliverProjectInvitation: vi.fn(async () => {}),
	queueProjectInvitation: vi.fn(async () => true),
}));

type InvitationContext = APIContext & { waitUntil: Mock };

function context(
	options: {
		owner?: boolean;
		enabled?: boolean;
		action?: string;
		confirmedNotSent?: boolean;
	} = {},
): InvitationContext {
	const waitUntil = vi.fn();

	const env: Partial<TestRuntime["env"]> = {
		AUDIO_CLIENT_PORTAL_ENABLED: options.enabled === false ? "false" : "true",
		MUSIC_DB: double<D1Database>({}),
	};

	return double<InvitationContext>({
		params: { id: "song-1" },
		request: new Request(
			"https://thesuperhuman.us/api/owner/projects/song-1/invitation",
			{
				method: "POST",
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					action: options.action ?? "send",
					confirmedNotSent: options.confirmedNotSent ?? false,
				}),
			},
		),
		locals: {
			owner:
				options.owner === false ? undefined : { email: "owner@example.com" },
			runtime: double<TestRuntime>({
				env: double<TestRuntime["env"]>(env),
				ctx: double<ExecutionContext>({ waitUntil }),
			}),
		},
		waitUntil,
	});
}

beforeEach(() => vi.clearAllMocks());

it("keeps invitation sending behind the owner and portal gates", async () => {
	expect((await POST(context({ owner: false }))).status).toBe(403);
	expect((await POST(context({ enabled: false }))).status).toBe(404);
	expect((await POST(context({ action: "wrong" }))).status).toBe(400);
	expect(queueProjectInvitation).not.toHaveBeenCalled();
});

it("queues one owner-triggered invitation and schedules delivery", async () => {
	const ctx = context();
	expect((await POST(ctx)).status).toBe(200);
	expect(queueProjectInvitation).toHaveBeenCalledWith(
		ctx.locals.runtime.env.MUSIC_DB,
		"song-1",
		false,
	);
	expect(deliverProjectInvitation).toHaveBeenCalledWith(
		ctx.locals.runtime.env.MUSIC_DB,
		"song-1",
		ctx.locals.runtime.env,
	);
	expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
	vi.mocked(queueProjectInvitation).mockResolvedValueOnce(false);
	expect((await POST(context())).status).toBe(409);
	vi.mocked(queueProjectInvitation).mockResolvedValueOnce(true);
	expect((await POST(context({ confirmedNotSent: true }))).status).toBe(200);
	expect(queueProjectInvitation).toHaveBeenLastCalledWith({}, "song-1", true);
});
