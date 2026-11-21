import * as Schema from "effect/Schema";
import {
	RESUME_REQUEST_TTL_SECONDS,
	type StoredResumeRequest,
} from "./resume-requests";

const PREFIX = "req:";
const PAGE_LIMIT = 50;
const MAX_PAGES = 2;
const TTL_MS = RESUME_REQUEST_TTL_SECONDS * 1000;

export type ResumeRequestToday = Pick<
	StoredResumeRequest,
	"name" | "email" | "company" | "audience" | "ts"
> & { id: string };

export type ResumeRequestsToday = {
	readonly requests: readonly ResumeRequestToday[];
	readonly truncated: boolean;
};

type ResumeStoreListResult = {
	readonly keys: readonly { readonly name: string }[];
	readonly list_complete: boolean;
	readonly cursor?: string;
};

type ResumeStoreReader = {
	get(keys: string[], type: "text"): Promise<Map<string, string | null>>;
	list(options: {
		prefix: string;
		limit: number;
		cursor?: string;
	}): Promise<ResumeStoreListResult>;
};

const decodeRequest = Schema.decodeUnknownSync(
	Schema.fromJsonString(
		Schema.Struct({
			name: Schema.String,
			email: Schema.String,
			company: Schema.String,
			audience: Schema.Literals(["general", "dod"]),
			ts: Schema.Number,
		}),
	),
);

/** Reads a bounded pending snapshot. KV failures reject so the caller shows unavailable. */
export async function listResumeRequestsToday(
	store: ResumeStoreReader,
	now = Date.now(),
): Promise<ResumeRequestsToday> {
	const found: ResumeRequestToday[] = [];
	let cursor: string | undefined;
	let complete = false;
	let truncated = false;

	for (let page = 0; page < MAX_PAGES; page += 1) {
		const result = cursor
			? await store.list({ prefix: PREFIX, limit: PAGE_LIMIT, cursor })
			: await store.list({ prefix: PREFIX, limit: PAGE_LIMIT });

		if (result.keys.some(({ name }) => !name.startsWith(PREFIX)))
			throw new Error("Resume request listing returned an unexpected key.");

		const keys = result.keys.slice(0, PAGE_LIMIT).map(({ name }) => name);

		const values = keys.length
			? await store.get(keys, "text")
			: new Map<string, string | null>();

		for (const name of keys) {
			const id = name.slice(PREFIX.length);
			const raw = values.get(name);

			if (!id || raw == null) continue;
			const request = decodeRequest(raw);

			if (
				!Number.isFinite(request.ts) ||
				request.ts > now ||
				now - request.ts >= TTL_MS
			)
				continue;

			found.push({ id, ...request });
		}

		complete = result.list_complete && result.keys.length <= PAGE_LIMIT;

		if (result.keys.length > PAGE_LIMIT) {
			truncated = true;
			break;
		}

		if (complete) break;

		if (!result.cursor)
			throw new Error("Resume request listing is incomplete without a cursor.");

		cursor = result.cursor;
	}

	return {
		requests: found.sort((a, b) => a.ts - b.ts),
		truncated: truncated || !complete,
	};
}
