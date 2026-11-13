import type { APIContext } from "astro";
import { expect, it } from "vitest";
import { POST, PUT } from "~/pages/api/owner/projects/[id]/uploads";
import { double, partial } from "../helpers/doubles";
import { rowD1 } from "../helpers/sqlite-d1";
import { testRuntime } from "../helpers/runtime";

const uuid = "98f3c6a7-9d1e-4f44-ae41-74db25122e14";
const url = "https://thesuperhuman.us/api/owner/projects/song-1/uploads";

it("fails closed without owner access or the portal gate", async () => {
	const request = new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			action: "start",
			version: "review",
			displayName: "Song.wav",
			mediaType: "audio/wav",
			byteSize: 10,
		}),
	});

	const context = partial<APIContext>({
		params: { id: "song-1" },
		request,
		locals: { runtime: testRuntime({ AUDIO_CLIENT_PORTAL_ENABLED: "false" }) },
	});

	expect((await POST(context)).status).toBe(403);
	context.locals.owner = { email: "owner@example.com" };
	expect((await POST(context)).status).toBe(404);
});

/** The upload row and the owner-request row that the part route reads, as the test's database serves them. */
function uploadDb(extra: Record<string, string> = {}): D1Database {
	return rowD1(
		(query): Record<string, string | number | null> =>
			query.includes("audio_project_uploads")
				? {
						id: uuid,
						request_id: "song-1",
						object_key: "studio/projects/song-1/test.wav",
						upload_id: "r2-id",
						byte_size: 10,
						...extra,
					}
				: { "1": 1 },
	);
}

it("rejects a wrongly sized part before sending it to R2", async () => {
	let reachedR2 = false;

	const request = new Request(`${url}?uploadId=${uuid}&part=1`, {
		method: "PUT",
		headers: { "content-length": "9" },
		body: new Uint8Array(9),
	});

	const context = partial<APIContext>({
		params: { id: "song-1" },
		request,
		locals: {
			owner: { email: "owner@example.com" },
			runtime: testRuntime({
				AUDIO_CLIENT_PORTAL_ENABLED: "true",
				MUSIC_DB: uploadDb(),
				AUDIO: double<R2Bucket>({
					resumeMultipartUpload: () => {
						reachedR2 = true;

						return double<R2MultipartUpload>({});
					},
				}),
			}),
		},
	});

	expect((await PUT(context)).status).toBe(400);
	expect(reachedR2).toBe(false);
});

it("checks the received part size even without a content-length header", async () => {
	let reachedR2 = false;

	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(9));
			controller.close();
		},
	});

	const init: RequestInit & { duplex: "half" } = {
		method: "PUT",
		body,
		duplex: "half",
	};

	const request = new Request(`${url}?uploadId=${uuid}&part=1`, init);

	const context = partial<APIContext>({
		params: { id: "song-1" },
		request,
		locals: {
			owner: { email: "owner@example.com" },
			runtime: testRuntime({
				AUDIO_CLIENT_PORTAL_ENABLED: "true",
				MUSIC_DB: uploadDb({ state: "pending" }),
				AUDIO: double<R2Bucket>({
					resumeMultipartUpload: () => {
						reachedR2 = true;

						return double<R2MultipartUpload>({});
					},
				}),
			}),
		},
	});

	expect((await PUT(context)).status).toBe(400);
	expect(reachedR2).toBe(false);
});
