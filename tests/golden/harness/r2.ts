// A recording in-memory R2 bucket: get, head, put, delete, list and the multipart calls.
//
// Bodies are recorded as a byte length and a SHA-256, never raw bytes. Etags are the first 32 hex digits of the SHA-256
// of the content (a multipart object: of the part etags joined by commas), so two runs agree. `uploaded` is the frozen
// clock. An object holds what was put; a read gives back a copy.
import { isText } from "~/lib/type-guards";
import { double } from "../../helpers/doubles";
import type { EffectLog } from "./log";
import {
	byteRecord,
	concat,
	type Bytes,
	drain,
	plain,
	sha256,
	viewOf,
	type Recorded,
} from "./plain";

type Meta = {
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: { [name: string]: string };
};

/** An object the bucket holds before the case. */
export type R2Seed = {
	[key: string]: { body: string | Uint8Array } & Meta;
};

export type R2Setup = {
	readonly missing?: boolean;
	readonly seed?: R2Seed;
	/** A listed operation rejects with an Error. Multipart calls are named createMultipartUpload and so on. */
	readonly fails?: readonly string[];
	/**
	 * Multipart uploads already started before the case: upload id to the key, or to the key and the parts already
	 * uploaded (part number to its content) and the metadata the upload was created with.
	 */
	readonly uploads?: {
		readonly [uploadId: string]:
			| string
			| {
					readonly key: string;
					readonly parts?: {
						readonly [partNumber: number]: string | Uint8Array;
					};
					readonly httpMetadata?: R2HTTPMetadata;
					readonly customMetadata?: { [name: string]: string };
			  };
	};
	/** Keys that disappear right after a head() answers for them, so the get() that follows finds nothing. */
	readonly vanishAfterHead?: readonly string[];
};

/** What R2 says of an upload it no longer has: error 10024, which `multipartUploadGone` in the source matches. */
const UPLOAD_GONE = "The specified multipart upload does not exist. (10024)";

type Held = {
	bytes: Bytes;
	httpMetadata: R2HTTPMetadata;
	customMetadata: { [name: string]: string };
	uploaded: Date;
	etag: string;
};

type Range = { offset?: number; length?: number; suffix?: number };

type AnyOptions =
	| R2GetOptions
	| R2PutOptions
	| R2ListOptions
	| R2MultipartOptions;

/** The options a route passed, as a fixture holds them. */
const optionsRecord = (options: AnyOptions | undefined): Recorded =>
	options === undefined
		? null
		: plain(Object.fromEntries(Object.entries(options)));

const etagOf = (bytes: Uint8Array) => sha256(bytes).slice(0, 32);

function metaOf(options: R2PutOptions | R2MultipartOptions | undefined): Meta {
	const given = options?.httpMetadata;

	const httpMetadata: R2HTTPMetadata =
		given instanceof Headers
			? {
					contentType: given.get("content-type") ?? undefined,
					contentDisposition: given.get("content-disposition") ?? undefined,
					cacheControl: given.get("cache-control") ?? undefined,
				}
			: (given ?? {});

	return {
		httpMetadata,
		customMetadata: options?.customMetadata ?? {},
	};
}

function rangeOf(range: R2GetOptions["range"]): Range | undefined {
	if (range === undefined) return undefined;

	if (range instanceof Headers) {
		const match = range.get("range")?.match(/^bytes=(\d*)-(\d*)$/);

		if (!match) return undefined;

		return match[1] === ""
			? { suffix: Number(match[2]) }
			: {
					offset: Number(match[1]),
					length:
						match[2] === ""
							? undefined
							: Number(match[2]) - Number(match[1]) + 1,
				};
	}

	return range;
}

function slice(bytes: Bytes, range: Range | undefined) {
	if (!range) return { bytes, offset: 0, length: bytes.length };

	if (range.suffix !== undefined) {
		const length = Math.min(range.suffix, bytes.length);

		return {
			bytes: bytes.slice(bytes.length - length),
			offset: bytes.length - length,
			length,
		};
	}

	const offset = range.offset ?? 0;
	const end = range.length === undefined ? bytes.length : offset + range.length;
	const part = bytes.slice(offset, Math.min(end, bytes.length));

	return { bytes: part, offset, length: part.length };
}

async function bytesOf(value: R2PutValue | null | string): Promise<Bytes> {
	if (value === null) return new Uint8Array();

	if (isText(value)) return new TextEncoder().encode(value);

	if (value instanceof ReadableStream) return drain(value);

	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());

	if (ArrayBuffer.isView(value))
		return new Uint8Array(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		).slice();

	return viewOf(value).slice();
}

type R2PutValue =
	| ReadableStream
	| ArrayBuffer
	| ArrayBufferView
	| string
	| Blob;

/** A recording bucket, and what it holds now: per key the size, digest, etag and metadata. */
export type RecordedR2 = { binding: R2Bucket; snapshot: () => Recorded };

export function recordingR2(
	label: string,
	setup: R2Setup,
	log: EffectLog,
	now: () => Date,
	nextId: () => string,
): RecordedR2 {
	const store = new Map<string, Held>();
	const fails = new Set(setup.fails ?? []);

	const uploads = new Map<
		string,
		{ key: string; meta: Meta; parts: Map<number, Bytes> }
	>();

	const asBytes = (value: string | Uint8Array): Bytes =>
		isText(value) ? new TextEncoder().encode(value) : value.slice();

	for (const [uploadId, given] of Object.entries(setup.uploads ?? {}))
		uploads.set(
			uploadId,
			isText(given)
				? { key: given, meta: {}, parts: new Map() }
				: {
						key: given.key,
						meta: {
							httpMetadata: given.httpMetadata,
							customMetadata: given.customMetadata,
						},
						parts: new Map(
							Object.entries(given.parts ?? {}).map(([number, value]) => [
								Number(number),
								asBytes(value),
							]),
						),
					},
		);

	const vanishing = new Set(setup.vanishAfterHead ?? []);

	for (const [key, entry] of Object.entries(setup.seed ?? {})) {
		const bytes = isText(entry.body)
			? new TextEncoder().encode(entry.body)
			: entry.body.slice();

		store.set(key, {
			bytes,
			httpMetadata: entry.httpMetadata ?? {},
			customMetadata: entry.customMetadata ?? {},
			uploaded: now(),
			etag: etagOf(bytes),
		});
	}

	const note = (op: string, key: string | null, detail: Recorded) =>
		log.push({ kind: "r2", bucket: label, op, key, detail });

	const failIf = (op: string) => {
		if (fails.has(op)) throw new Error(`r2 ${op} failed`);
	};

	const info = (key: string, held: Held) => ({
		key,
		version: held.etag,
		size: held.bytes.length,
		etag: held.etag,
		httpEtag: `"${held.etag}"`,
		checksums: double<R2Checksums>({ toJSON: () => ({}) }),
		uploaded: held.uploaded,
		httpMetadata: held.httpMetadata,
		customMetadata: held.customMetadata,
		storageClass: "Standard",
		writeHttpMetadata: (headers: Headers) => {
			const meta = held.httpMetadata;

			if (meta.contentType) headers.set("content-type", meta.contentType);

			if (meta.contentLanguage)
				headers.set("content-language", meta.contentLanguage);

			if (meta.contentDisposition)
				headers.set("content-disposition", meta.contentDisposition);

			if (meta.contentEncoding)
				headers.set("content-encoding", meta.contentEncoding);

			if (meta.cacheControl) headers.set("cache-control", meta.cacheControl);

			if (meta.cacheExpiry)
				headers.set("expires", meta.cacheExpiry.toUTCString());
		},
	});

	const objectOf = (key: string, held: Held) =>
		double<R2Object>(info(key, held));

	const bodyOf = (key: string, held: Held, range: Range | undefined) => {
		const part = slice(held.bytes, range);
		let used = false;

		const stream = () => {
			used = true;

			return new Response(part.bytes).body!;
		};

		return double<R2ObjectBody>({
			...info(key, held),
			get body() {
				return stream();
			},
			get bodyUsed() {
				return used;
			},
			range: range ? { offset: part.offset, length: part.length } : undefined,
			arrayBuffer: async () => part.bytes.slice().buffer,
			bytes: async () => part.bytes.slice(),
			text: async () => new TextDecoder().decode(part.bytes),
			json: async () => JSON.parse(new TextDecoder().decode(part.bytes)),
			blob: async () => new Blob([part.bytes]),
		});
	};

	const precondition = (
		onlyIf: R2PutOptions["onlyIf"] | R2GetOptions["onlyIf"],
		held: Held | undefined,
	) => {
		if (!onlyIf || onlyIf instanceof Headers) return true;

		if (onlyIf.etagMatches !== undefined) {
			if (!held) return false;

			if (onlyIf.etagMatches !== "*" && onlyIf.etagMatches !== held.etag)
				return false;
		}

		if (onlyIf.etagDoesNotMatch !== undefined) {
			if (
				onlyIf.etagDoesNotMatch === "*"
					? held !== undefined
					: held?.etag === onlyIf.etagDoesNotMatch
			)
				return false;
		}

		return true;
	};

	const write = async (
		key: string,
		bytes: Bytes,
		meta: Meta,
		etag = etagOf(bytes),
	) => {
		const held: Held = {
			bytes,
			httpMetadata: meta.httpMetadata ?? {},
			customMetadata: meta.customMetadata ?? {},
			uploaded: now(),
			etag,
		};

		store.set(key, held);

		return held;
	};

	const upload = (id: string) => {
		const found = uploads.get(id);

		if (!found) throw new Error(UPLOAD_GONE);

		return found;
	};

	const handle = (id: string) => {
		const found = upload(id);

		return double<R2MultipartUpload>({
			key: found.key,
			uploadId: id,
			uploadPart: async (partNumber: number, value: R2PutValue) => {
				failIf("uploadPart");
				upload(id);
				const bytes = await bytesOf(value);
				found.parts.set(partNumber, bytes);

				note("uploadPart", found.key, {
					uploadId: id,
					partNumber,
					body: byteRecord(bytes),
				});

				return { partNumber, etag: etagOf(bytes) };
			},
			abort: async () => {
				note("abort", found.key, { uploadId: id });
				failIf("abort");
				upload(id);
				uploads.delete(id);
			},
			complete: async (parts: R2UploadedPart[]) => {
				note("complete", found.key, {
					uploadId: id,
					parts: parts.map((part) => ({
						partNumber: part.partNumber,
						etag: part.etag,
					})),
				});

				failIf("complete");
				upload(id);

				const bytes = concat(
					parts.map((part) => {
						const bodyPart = found.parts.get(part.partNumber);

						if (!bodyPart || etagOf(bodyPart) !== part.etag)
							throw new Error(
								"r2: multipart part is missing or its etag differs",
							);

						return bodyPart;
					}),
				);

				const held = await write(
					found.key,
					bytes,
					found.meta,
					etagOf(
						new TextEncoder().encode(parts.map((part) => part.etag).join(",")),
					),
				);

				uploads.delete(id);

				return objectOf(found.key, held);
			},
		});
	};

	const binding = double<R2Bucket>({
		// SAFETY: get(), put() and list() are overloaded or generic, so one signature cannot be typed as the member; each fake answers what the real bucket returns for the call the route makes.
		get: (async (key: string, options?: R2GetOptions) => {
			const held = store.get(key);

			note("get", key, {
				options: optionsRecord(options),
				found: held !== undefined,
				size: held?.bytes.length ?? null,
			});

			failIf("get");

			if (!held) return null;

			if (!precondition(options?.onlyIf, held)) return objectOf(key, held);

			return bodyOf(key, held, rangeOf(options?.range));
		}) as R2Bucket["get"],
		head: async (key: string) => {
			const held = store.get(key);

			note("head", key, {
				found: held !== undefined,
				size: held?.bytes.length ?? null,
			});
			failIf("head");

			const answer = held ? objectOf(key, held) : null;

			if (held && vanishing.has(key)) {
				store.delete(key);
				note("vanish", key, null);
			}

			return answer;
		},
		// SAFETY: as for get().
		put: (async (
			key: string,
			value: R2PutValue | null,
			options?: R2PutOptions,
		) => {
			const bytes = await bytesOf(value);

			note("put", key, {
				body: byteRecord(bytes),
				options: optionsRecord(options),
			});

			failIf("put");

			if (!precondition(options?.onlyIf, store.get(key))) return null;

			return objectOf(key, await write(key, bytes, metaOf(options)));
		}) as R2Bucket["put"],
		delete: async (keys: string | string[]) => {
			const list = Array.isArray(keys) ? keys : [keys];

			note("delete", list.length === 1 ? list[0] : null, { keys: list });
			failIf("delete");

			for (const key of list) store.delete(key);
		},
		// SAFETY: as for get().
		list: (async (options?: R2ListOptions) => {
			const prefix = options?.prefix ?? "";
			const limit = options?.limit ?? 1000;
			const after = options?.cursor ?? options?.startAfter ?? "";

			const all = [...store.keys()]
				.filter((key) => key.startsWith(prefix) && key > after)
				.sort();

			const delimiter = options?.delimiter;
			const prefixes = new Set<string>();
			const keys: string[] = [];

			for (const key of all) {
				const cut = delimiter ? key.indexOf(delimiter, prefix.length) : -1;

				if (cut >= 0) prefixes.add(key.slice(0, cut + delimiter!.length));
				else keys.push(key);
			}

			const page = keys.slice(0, limit);
			const truncated = keys.length > limit;

			note("list", null, {
				options: optionsRecord(options),
				keys: page,
				truncated,
			});

			failIf("list");

			const objects = page.map((key) => objectOf(key, store.get(key)!));

			return truncated
				? {
						objects,
						truncated: true,
						cursor: page[page.length - 1],
						delimitedPrefixes: [...prefixes],
					}
				: { objects, truncated: false, delimitedPrefixes: [...prefixes] };
		}) as R2Bucket["list"],
		createMultipartUpload: async (
			key: string,
			options?: R2MultipartOptions,
		) => {
			const id = `upload-${nextId()}`;

			note("createMultipartUpload", key, {
				options: optionsRecord(options),
				uploadId: id,
			});

			failIf("createMultipartUpload");
			uploads.set(id, { key, meta: metaOf(options), parts: new Map() });

			return handle(id);
		},
		resumeMultipartUpload: (key: string, uploadId: string) => {
			note("resumeMultipartUpload", key, { uploadId });

			if (!uploads.has(uploadId))
				return double<R2MultipartUpload>({
					key,
					uploadId,
					uploadPart: async () => {
						throw new Error(UPLOAD_GONE);
					},
					abort: async () => {
						throw new Error(UPLOAD_GONE);
					},
					complete: async () => {
						throw new Error(UPLOAD_GONE);
					},
				});

			return handle(uploadId);
		},
	});

	return {
		binding,
		snapshot: () =>
			Object.fromEntries(
				[...store.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, held]) => [
						key,
						{
							size: held.bytes.length,
							sha256: sha256(held.bytes),
							etag: held.etag,
							httpMetadata: plain(
								Object.fromEntries(Object.entries(held.httpMetadata)),
							),
							customMetadata: held.customMetadata,
						},
					]),
			),
	};
}
