// One frozen clock and seeded randomness for a case, so two runs write identical fixtures.
//
// Frozen: Date.now(), new Date() and performance.now(). Seeded, per case: crypto.randomUUID (a hex counter, so a value
// that a route checks against a hex pattern still passes), crypto.getRandomValues and Math.random. A case moves time
// only with `advance(ms)`, and the move is recorded.
import { vi } from "vitest";
import type { EffectLog } from "./log";
import { isText } from "~/lib/type-guards";
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
	const algorithm: KeyRequest = isText(given) ? { name: given } : given;

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
			isText(algorithm.hash) ? algorithm.hash : algorithm.hash.name
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

/** What setTimeout returns on real timers: enough of a Node Timeout for the code that holds one. */
class QueuedTimeout {
	ref() {
		return this;
	}

	unref() {
		return this;
	}

	hasRef() {
		return false;
	}

	refresh() {
		return this;
	}
}

/** The WebCrypto operations that run on a thread, so they finish on a later macrotask. */
const THREADED = [
	"digest",
	"sign",
	"verify",
	"encrypt",
	"decrypt",
	"deriveBits",
	"deriveKey",
] as const;

export class Determinism {
	/** Timers are virtual: setTimeout and clearTimeout run on the frozen clock and fire only when the runner advances it. */
	virtualTimers = false;

	private queued: {
		handle: QueuedTimeout;
		due: number;
		order: number;
		callback: () => void;
	}[] = [];

	private logical = 0;
	private created = 0;
	private ids = 0;
	private uploads = 0;
	private restores: (() => void)[] = [];

	constructor(private readonly log: EffectLog) {}

	/** An id for a fake's own use (an R2 upload id), counted apart from the UUIDs routes draw. */
	nextFakeId = () => String(++this.uploads);

	now = () => new Date();

	install() {
		vi.useFakeTimers({
			toFake: this.virtualTimers
				? ["Date", "performance", "setTimeout", "clearTimeout"]
				: ["Date", "performance"],
		});
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

		// SAFETY: generateKey is overloaded by key type; the fake answers the key (or the refusal) that the overload a caller picked would return.
		const fake = generatedKey as typeof crypto.subtle.generateKey;

		const generate = vi
			.spyOn(crypto.subtle, "generateKey")
			.mockImplementation(fake);

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
			...this.trackAsyncWork(),
			() => errors.mockRestore(),
			() => warnings.mockRestore(),
			() => generate.mockRestore(),
			() => uuid.mockRestore(),
			() => random.mockRestore(),
			() => math.mockRestore(),
			() => vi.useRealTimers(),
		];
	}

	/**
	 * Makes the asynchronous work that leaves the microtask queue visible to the runner: WebCrypto operations that run on a
	 * thread (digest, sign, verify, encrypt, decrypt, key derivation) and, on real timers, setTimeout. Each counts as in
	 * flight until it ends (EffectLog.begin), and the macrotask it comes back on is a boundary (EffectLog.boundary).
	 * Returns what puts the originals back.
	 */
	private trackAsyncWork(): (() => void)[] {
		const restores: (() => void)[] = [];

		const replace = (target: object, name: string, value: unknown) => {
			const original = Reflect.getOwnPropertyDescriptor(target, name);

			Object.defineProperty(target, name, {
				value,
				configurable: true,
				writable: true,
			});

			restores.push(() => {
				if (original) Object.defineProperty(target, name, original);
				else Reflect.deleteProperty(target, name);
			});
		};

		for (const name of THREADED) {
			const real = Reflect.get(crypto.subtle, name);

			replace(crypto.subtle, name, (...args: unknown[]) => {
				const end = this.log.begin();
				const promise = Reflect.apply(real, crypto.subtle, args);

				promise.then(
					() => {
						this.log.boundary();
						end();
					},
					() => {
						this.log.boundary();
						end();
					},
				);

				return promise;
			});
		}

		// On real timers a route's setTimeout is queued, not scheduled: the runner fires it when nothing else can make
		// progress (fireNextTimer), in the order of its due time. How long the machine takes never decides when it fires.
		if (!this.virtualTimers) {
			this.queued.length = 0;
			this.logical = 0;

			replace(
				globalThis,
				"setTimeout",
				(
					callback: (...args: unknown[]) => void,
					ms?: number,
					...args: unknown[]
				) => {
					const handle = new QueuedTimeout();

					this.queued.push({
						handle,
						due: this.logical + Math.max(0, Number(ms) || 0),
						order: this.created,
						callback: () => callback(...args),
					});

					this.created += 1;
					this.log.onChange?.();

					return handle;
				},
			);

			replace(globalThis, "clearTimeout", (handle: unknown) => {
				const index = this.queued.findIndex((timer) => timer.handle === handle);

				if (index >= 0) this.queued.splice(index, 1);
			});
		}

		return restores;
	}

	/** Where the id sequence is, so setup that draws ids of its own (sign-in) can put it back. */
	idPosition() {
		return this.ids;
	}

	/** Moves the id sequence to `start`, so a sign-in draws values no other sign-in or request draws. */
	startIds(start: number) {
		this.ids = start;
	}

	/**
	 * Fires the next timer a route set, so a timeout comes without the test waiting for it. On virtual timers the clock
	 * moves to it, recorded as an advance; otherwise it is the next queued setTimeout, in due order, and the clock does not
	 * move. False when none is pending.
	 */
	async fireNextTimer(): Promise<boolean> {
		if (!this.virtualTimers) {
			const [first] = [...this.queued].sort(
				(a, b) => a.due - b.due || a.order - b.order,
			);

			if (!first) return false;

			this.queued.splice(this.queued.indexOf(first), 1);
			this.logical = first.due;
			this.log.boundary();
			first.callback();

			return true;
		}

		if (vi.getTimerCount() === 0) return false;

		const before = Date.now();
		await vi.advanceTimersToNextTimerAsync();
		this.log.push({ kind: "advance", ms: Date.now() - before });

		return true;
	}

	advance(ms: number) {
		this.log.push({ kind: "advance", ms });

		// On virtual timers the timers that become due fire, as they do when the clock really passes them.
		if (this.virtualTimers) vi.advanceTimersByTime(ms);
		else vi.setSystemTime(Date.now() + ms);
	}

	restore() {
		for (const restore of this.restores) restore();
		this.restores = [];
	}
}
