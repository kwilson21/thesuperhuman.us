import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	createResumeRequest,
	getResumeRequest,
	deleteResumeRequest,
	RESUME_AUDIENCES,
	type ResumeRequest,
} from "~/lib/resume-requests";
import { listResumeRequestsToday } from "~/lib/resume-requests-today";

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

describe("listResumeRequestsToday", () => {
	const now = Date.UTC(2026, 10, 21);

	const encode = (name: string, ts: number) =>
		JSON.stringify({
			name,
			email: "requester@example.test",
			company: "Sample Studio",
			audience: "general",
			note: "Synthetic fixture.",
			ts,
		});

	it("lists pending req: records and excludes expired, absent, and unrelated keys", async () => {
		const values = new Map([
			["req:pending", encode("Pending Owner Fixture", now - 1000)],
			["req:expired", encode("Expired Fixture", now - 7 * 24 * 60 * 60 * 1000)],
			["req:absent", null],
			["pdf:general", "binary-pdf"],
		]);

		const list = vi.fn(async () => ({
			keys: values
				.keys()
				.filter((name) => name.startsWith("req:"))
				.map((name) => ({ name }))
				.toArray(),
			list_complete: true,
		}));

		const get = vi.fn(
			async (keys: string[]) =>
				new Map(keys.map((key) => [key, values.get(key) ?? null])),
		);

		const put = vi.fn();
		const remove = vi.fn();

		const store = { list, get, put, delete: remove };
		const result = await listResumeRequestsToday(store, now);

		expect(result).toEqual({
			requests: [
				{
					id: "pending",
					name: "Pending Owner Fixture",
					email: "requester@example.test",
					company: "Sample Studio",
					audience: "general",
					ts: now - 1000,
				},
			],
			truncated: false,
		});
		expect(list).toHaveBeenCalledWith({ prefix: "req:", limit: 50 });
		expect(get).toHaveBeenCalledExactlyOnceWith(
			["req:pending", "req:expired", "req:absent"],
			"text",
		);
		expect(put).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it("can have zero visible rows and still know the snapshot was incomplete", async () => {
		const list = vi.fn(async () => ({
			keys: [],
			list_complete: false,
			cursor: "next",
		}));

		const get = vi.fn(async () => new Map<string, string | null>());

		expect(await listResumeRequestsToday({ list, get }, now)).toEqual({
			requests: [],
			truncated: true,
		});
		expect(list).toHaveBeenCalledTimes(2);
		expect(get).not.toHaveBeenCalled();
	});

	it("bounds listing and marks an incomplete result as truncated", async () => {
		const keys = Array.from({ length: 50 }, (_, index) => ({
			name: `req:${index}`,
		}));

		const list = vi
			.fn()
			.mockResolvedValueOnce({ keys, list_complete: false, cursor: "page-two" })
			.mockResolvedValueOnce({
				keys,
				list_complete: false,
				cursor: "page-three",
			});

		const get = vi.fn(
			async (names: string[]) =>
				new Map(names.map((name) => [name, encode("Owner Fixture", now - 10)])),
		);

		const result = await listResumeRequestsToday({ list, get }, now);
		expect(list).toHaveBeenCalledTimes(2);
		expect(get).toHaveBeenCalledTimes(2);
		expect(result.requests).toHaveLength(100);
		expect(result.truncated).toBe(true);
	});

	it("caps reads at the page limit even if a KV result exceeds it", async () => {
		const keys = Array.from({ length: 55 }, (_, index) => ({
			name: `req:${index}`,
		}));

		const list = vi.fn(async () => ({ keys, list_complete: true }));

		const get = vi.fn(
			async (names: string[]) =>
				new Map(names.map((name) => [name, encode("Owner Fixture", now - 10)])),
		);

		const result = await listResumeRequestsToday({ list, get }, now);
		expect(get).toHaveBeenCalledExactlyOnceWith(
			keys.slice(0, 50).map(({ name }) => name),
			"text",
		);
		expect(result.requests).toHaveLength(50);
		expect(result.truncated).toBe(true);
	});

	it("shows storage and malformed-record failures instead of treating them as no requests", async () => {
		await expect(
			listResumeRequestsToday(
				{
					list: async () => ({
						keys: [{ name: "req:broken" }],
						list_complete: true,
					}),
					get: async () => new Map([["req:broken", "not a request"]]),
				},
				now,
			),
		).rejects.toThrow();
	});

	it("rejects storage failures so the dashboard can show unavailable", async () => {
		await expect(
			listResumeRequestsToday(
				{
					list: async () => {
						throw new Error("synthetic storage failure");
					},
					get: async () => new Map(),
				},
				now,
			),
		).rejects.toThrow("synthetic storage failure");
	});
});
