import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	createResumeRequest,
	getResumeRequest,
	deleteResumeRequest,
	RESUME_AUDIENCES,
	type ResumeRequest,
} from "~/lib/resume-requests";

function makeKv() {
	const store = new Map<string, string>();

	return {
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		put: vi.fn(
			async (k: string, v: string, _opts?: { expirationTtl: number }) => {
				store.set(k, v);
			},
		),
		delete: vi.fn(async (k: string) => {
			store.delete(k);
		}),
	};
}

const sampleRequest = {
	name: "Jane Doe",
	email: "jane@example.com",
	company: "Acme Corp",
	audience: "dod",
	note: "Reviewing your background for a staff role.",
} satisfies ResumeRequest;

describe("RESUME_AUDIENCES", () => {
	it("exposes the three audience keys", () => {
		expect(RESUME_AUDIENCES).toEqual(["general", "dod"]);
	});
});

describe("createResumeRequest", () => {
	beforeEach(() => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000001",
		);
	});

	it("stores the request under req:<id> and returns the id", async () => {
		const kv = makeKv();
		const id = await createResumeRequest(kv, sampleRequest);
		expect(id).toBe("00000000-0000-4000-8000-000000000001");
		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(kv.put.mock.calls[0][0]).toBe(
			"req:00000000-0000-4000-8000-000000000001",
		);
	});

	it("serializes the full request as JSON", async () => {
		const kv = makeKv();
		await createResumeRequest(kv, sampleRequest);
		const stored = JSON.parse(kv.put.mock.calls[0][1]);
		expect(stored).toMatchObject(sampleRequest);
		expect(stored.ts).toEqual(expect.any(Number));
	});

	it("sets a 7-day TTL", async () => {
		const kv = makeKv();
		await createResumeRequest(kv, sampleRequest);
		expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 604800 });
	});

	it("generates a fresh UUID per request", async () => {
		const kv = makeKv();
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("id-aaa-aaa-aaa-aaa")
			.mockReturnValueOnce("id-bbb-bbb-bbb-bbb");
		const a = await createResumeRequest(kv, sampleRequest);
		const b = await createResumeRequest(kv, sampleRequest);
		expect(a).not.toBe(b);
	});
});

describe("getResumeRequest", () => {
	it("returns the parsed request when present (without deleting)", async () => {
		const kv = makeKv();
		const id = "abc";

		const payload: ResumeRequest & { ts: number } = {
			...sampleRequest,
			ts: 1700000000000,
		};

		kv.get.mockResolvedValueOnce(JSON.stringify(payload));

		const result = await getResumeRequest(kv, id);

		expect(result).toEqual(payload);
		expect(kv.delete).not.toHaveBeenCalled();
	});

	it("returns null when the id is not in KV", async () => {
		const kv = makeKv();
		const result = await getResumeRequest(kv, "missing");
		expect(result).toBeNull();
	});

	it("returns null on malformed JSON", async () => {
		const kv = makeKv();
		kv.get.mockResolvedValueOnce("{not valid json");
		const result = await getResumeRequest(kv, "corrupt");
		expect(result).toBeNull();
	});
});

describe("deleteResumeRequest", () => {
	it("deletes the request from KV under the prefixed key", async () => {
		const kv = makeKv();
		await deleteResumeRequest(kv, "abc");
		expect(kv.delete).toHaveBeenCalledWith("req:abc");
	});
});
