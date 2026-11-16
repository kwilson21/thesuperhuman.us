// The KV namespace the OAuth library keeps its state in, held to Cloudflare's limit on a key.
//
// A KV key may not be longer than 512 bytes, and the library builds keys from what a visitor sends: a client id (from a
// parameter, a Basic header or the issuer of a client assertion), and the user and grant parts of an authorization code, a
// refresh token or an access token. A real value is never near that long, and KV would throw for one, which would make the
// route answer a server fault for a request that is simply wrong. So a read of a key over the limit answers "not found"
// without calling KV, and the library refuses the request in its own words, as it refuses any unknown client or invalid
// grant. The request itself reaches the library untouched.
//
// What the library does with the namespace (oauth-provider.js, version 0.x): `get` of `client:<id>`, `grant:<user>:<grant>`
// and `token:<user>:<grant>:<hash>`, each partly visitor-driven; `get` and `put` of the client-assertion replay marker, a
// fixed prefix plus the SHA-256 hex digest of the visitor-sent issuer and jti (a fixed length, so it never nears the limit);
// `put` and `delete` of keys it generated itself or read back from a record it stored (a client id it generated, a grant or
// token of the signed-in owner), and of `transaction:<hash>`; `list` by a prefix of those, only for a grant it has already
// found. `getWithMetadata` is not used.

const LONGEST_KEY = 512;

const encoder = new TextEncoder();

const tooLong = (key: string) => encoder.encode(key).length > LONGEST_KEY;

type JsonRead = { type: "json" };

/**
 * `kv` with reads of a key too long for KV answered as not found. A `delete` of such a key does nothing, since nothing can be
 * stored under it. A `put` goes to KV unchanged: no key the library writes comes from a visitor, so one too long is the
 * site's own fault, and KV's refusal is a store failure.
 */
export function keyBoundedKv(kv: KVNamespace): KVNamespace {
	const bounded = {
		get: (key: string, options?: JsonRead) => {
			if (tooLong(key)) return Promise.resolve(null);

			return options ? kv.get(key, options) : kv.get(key);
		},
		getWithMetadata: (key: string, options?: JsonRead) => {
			if (tooLong(key))
				return Promise.resolve({
					value: null,
					metadata: null,
					cacheStatus: null,
				});

			return options
				? kv.getWithMetadata(key, options)
				: kv.getWithMetadata(key);
		},
		put: (...args: Parameters<KVNamespace["put"]>) => kv.put(...args),
		delete: (key: string) =>
			tooLong(key) ? Promise.resolve() : kv.delete(key),
		list: (options?: KVNamespaceListOptions) => {
			if (tooLong(options?.prefix ?? ""))
				return Promise.resolve({
					keys: [],
					list_complete: true,
					cacheStatus: null,
				});

			return kv.list(options);
		},
	};

	// SAFETY: the library calls only get, getWithMetadata, put, delete and list, with the arguments this accepts; the overloads of KVNamespace.get and getWithMetadata that it never uses are not offered.
	return bounded as KVNamespace;
}
