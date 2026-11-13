// One frozen clock and seeded randomness for a case, so two runs write identical fixtures.
//
// Frozen: Date.now(), new Date() and performance.now(). Seeded, per case: crypto.randomUUID (a hex counter, so a value
// that a route checks against a hex pattern still passes), crypto.getRandomValues and Math.random. A case moves time
// only with `advance(ms)`, and the move is recorded.
import { vi } from "vitest";
import type { EffectLog } from "./log";
import { errorText, plain, type Passed, type Recorded } from "./plain";

export const START = "2026-11-13T12:00:00.000Z";

/** The n-th id, as a UUID version 4 shape with a hex counter. */
export const uuidFor = (
	n: number,
): `${string}-${string}-${string}-${string}-${string}` =>
	`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A small seeded generator (mulberry32). */
function seeded(seed: number) {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type KeyRequest = {
	readonly name?: string;
	readonly length?: number;
	readonly hash?: string | { readonly name: string };
};

/**
 * WebCrypto draws a generated key from its own source, which cannot be seeded, so the harness makes it: every key is the
 * same bytes (seven in every byte) at the length asked for. Only the key is fixed; the code's own calls and their order
 * are unchanged. A key type that cannot be built from bytes is refused by name.
 */
function generatedKey(
	given: string | KeyRequest,
	extractable: boolean,
	usages: KeyUsage[],
): Promise<CryptoKey> {
	const algorithm: KeyRequest =
		typeof given === "string" ? { name: given } : given;
	const name = (algorithm.name ?? "").toUpperCase();

	if (name.startsWith("AES") && algorithm.length !== undefined)
		return crypto.subtle.importKey(
			"raw",
			new Uint8Array(algorithm.length / 8).fill(7),
			name,
			extractable,
			usages,
		);

	if (name === "HMAC" && algorithm.hash !== undefined) {
		const hash = (
			typeof algorithm.hash === "string" ? algorithm.hash : algorithm.hash.name
		).toUpperCase();

		const bits =
			algorithm.length ??
			(hash === "SHA-384" || hash === "SHA-512" ? 1024 : 512);

		return crypto.subtle.importKey(
			"raw",
			new Uint8Array(bits / 8).fill(7),
			{ name: "HMAC", hash },
			extractable,
			usages,
		);
	}

	return Promise.reject(
		new Error(
			`golden harness: generateKey for ${name} is not deterministic yet. Add it to determinism.ts.`,
		),
	);
}

/** One argument of a console call, as a fixture holds it: an Error by its name and message. */
function consoleArg(arg: Passed): Recorded {
	if (arg instanceof Error) return errorText(arg);

	try {
		return plain(arg);
	} catch {
		return String(arg);
	}
}

export class Determinism {
	private ids = 0;
	private uploads = 0;
	private restores: (() => void)[] = [];

	constructor(private readonly log: EffectLog) {}

	/** An id for a fake's own use (an R2 upload id), counted apart from the UUIDs routes draw. */
	nextFakeId = () => String(++this.uploads);

	now = () => new Date();

	install() {
		vi.useFakeTimers({ toFake: ["Date", "performance"] });
		vi.setSystemTime(new Date(START));

		const bytes = seeded(0x2545f491);
		const floats = seeded(0x9e3779b9);

		const uuid = vi
			.spyOn(crypto, "randomUUID")
			.mockImplementation(() => uuidFor(++this.ids));

		const random = vi
			.spyOn(crypto, "getRandomValues")
			.mockImplementation((array) => {
				if (array === null) return array;

				const view = new Uint8Array(
					array.buffer,
					array.byteOffset,
					array.byteLength,
				);

				for (let index = 0; index < view.length; index += 1)
					view[index] = Math.floor(bytes() * 256);

				return array;
			});

		const math = vi.spyOn(Math, "random").mockImplementation(floats);

		const generate = vi
			.spyOn(crypto.subtle, "generateKey")
			// SAFETY: generateKey is overloaded by key type; the fake answers the key (or the refusal) that the overload a caller picked would return.
			.mockImplementation(generatedKey as typeof crypto.subtle.generateKey);

		const spyOnConsole = (level: "error" | "warn") =>
			vi.spyOn(console, level).mockImplementation((...args: Passed[]) => {
				this.log.push({
					kind: "console",
					level,
					args: args.map((arg) => consoleArg(arg)),
				});
			});

		const errors = spyOnConsole("error");
		const warnings = spyOnConsole("warn");

		this.restores = [
			() => errors.mockRestore(),
			() => warnings.mockRestore(),
			() => generate.mockRestore(),
			() => uuid.mockRestore(),
			() => random.mockRestore(),
			() => math.mockRestore(),
			() => vi.useRealTimers(),
		];
	}

	/** Restarts the id sequence, for setup (sign-in) that must not move the ids the case draws. */
	resetIds() {
		this.ids = 0;
	}

	/** Moves the id sequence to `start`, so a sign-in draws values no other sign-in or request draws. */
	startIds(start: number) {
		this.ids = start;
	}

	advance(ms: number) {
		this.log.push({ kind: "advance", ms });
		vi.setSystemTime(Date.now() + ms);
	}

	restore() {
		for (const restore of this.restores) restore();
		this.restores = [];
	}
}
