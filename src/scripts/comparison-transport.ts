/** A passage of the song that repeats, in the song's time (seconds). */
export type LoopRegion = { start: number; end: number };

/** Flip A/B each pass: the gains with each version selected, and the version that sounds now. */
export type FlipLevels = { levels: number[][]; selected: number };

/** How many wraps ahead flips are scheduled on the audio clock, so they hold while the page cannot draw. */
const FLIPS_AHEAD = 64;

/** Both decoded exports run on one audio clock. Switching changes gain, never time. */
export class ComparisonTransport {
	private sources: AudioBufferSourceNode[] = [];
	private gains: GainNode[];
	private storedPosition = 0;
	private startedAt = 0;
	private generation = 0;
	private loop: LoopRegion | undefined;
	// While flipping: the gains per version, and the version that sounds on the first pass since playback last started.
	private flip: { levels: number[][]; first: number } | undefined;
	// The last pass whose flip is scheduled.
	private flipsScheduledTo = 0;
	readonly duration: number;
	playing = false;

	constructor(
		private context: AudioContext,
		private buffers: AudioBuffer[],
		private offsets: number[],
		duration: number,
		private onEnded: () => void,
	) {
		this.duration = Math.max(
			0,
			Math.min(
				duration,
				...buffers.map((buffer, index) => buffer.duration - offsets[index]),
			),
		);
		this.gains = buffers.map(() => {
			const gain = context.createGain();
			gain.gain.value = 0;
			gain.connect(context.destination);

			return gain;
		});
	}
	/** Where playback would be without the loop: the stored position plus the time played since. */
	private get unwrapped() {
		return (
			this.storedPosition +
			(this.playing
				? Math.max(0, this.context.currentTime - this.startedAt)
				: 0)
		);
	}

	get position() {
		const raw = this.unwrapped;

		if (!this.loop || raw < this.loop.end) return Math.min(this.duration, raw);
		const length = this.loop.end - this.loop.start;

		return this.loop.start + ((raw - this.loop.end) % length);
	}

	/** How many times the loop has wrapped since playback last started: 0 on the first pass. */
	get pass() {
		const raw = this.unwrapped;

		if (!this.loop || raw < this.loop.end) return 0;

		return (
			1 + Math.floor((raw - this.loop.end) / (this.loop.end - this.loop.start))
		);
	}

	/** The version sounding now while flipping, which changes at each wrap; undefined when not flipping. */
	get flipped() {
		return this.flip && (this.flip.first + this.pass) % this.flip.levels.length;
	}

	/**
	 * Loops a passage, or stops looping with undefined. Playing carries on from `at` (the current position by default),
	 * moved to the passage's start if that is outside it. While already looping and staying where it is, the playing
	 * sources take the new passage as they play, with no gap; otherwise they restart, as a seek does.
	 */
	setLoop(loop: LoopRegion | undefined, at = this.position) {
		const region = loop && {
			start: Math.max(0, loop.start),
			end: Math.min(this.duration, loop.end),
		};

		const now = this.position;

		const inPlace =
			this.playing &&
			this.loop &&
			Math.abs(at - now) < 0.01 &&
			(!region || (now >= region.start && now < region.end));

		if (inPlace) {
			// Count passes from here on the clock, as a restart would, without touching the sources.
			if (this.flip) this.flip.first = this.flipped ?? this.flip.first;
			// Within the first 30 ms the sources have not started yet, and keep their start time.
			this.storedPosition = now;
			this.startedAt = Math.max(this.startedAt, this.context.currentTime);
			this.loop = region;
			this.sources.forEach((source, index) => {
				source.loop = Boolean(region);

				if (!region) return;
				source.loopStart = region.start + this.offsets[index];
				source.loopEnd = region.end + this.offsets[index];
			});
			this.scheduleFlips();

			return;
		}

		const resume = this.playing;
		this.pause();
		this.loop = region;
		this.storedPosition = this.intoLoop(Math.min(at, this.duration));

		if (resume) this.play();
	}

	/**
	 * Flips A/B at each wrap of the loop, starting from `selected` now, or stops flipping with undefined (the caller then
	 * sets the levels). Each flip is scheduled on the audio clock, many wraps ahead, so it lands exactly on the wrap and
	 * keeps going while the page cannot draw, as in a hidden tab.
	 */
	setFlip(flip: FlipLevels | undefined) {
		this.flip = flip && {
			levels: flip.levels,
			first:
				(((flip.selected - this.pass) % flip.levels.length) +
					flip.levels.length) %
				flip.levels.length,
		};
		this.scheduleFlips();
	}

	/** Schedules more flips once half of those scheduled have passed; call it now and then while playing. */
	keepFlipping() {
		if (this.flip && this.pass > this.flipsScheduledTo - FLIPS_AHEAD / 2)
			this.scheduleFlips();
	}

	private scheduleFlips() {
		if (!this.flip) return;
		const { levels, first } = this.flip;
		const pass = this.pass;
		this.setLevels(levels[(first + pass) % levels.length]);

		if (!this.playing || !this.loop) return;
		const length = this.loop.end - this.loop.start;
		// The first wrap comes when the stored position reaches the loop's end; the rest follow a loop's length apart.
		const firstWrap = this.startedAt + (this.loop.end - this.storedPosition);

		for (let next = pass + 1; next <= pass + FLIPS_AHEAD; next++) {
			const time = firstWrap + (next - 1) * length;
			const version = levels[(first + next) % levels.length];

			this.gains.forEach((node, index) =>
				node.gain.setTargetAtTime(version[index], time, 0.003),
			);
		}

		this.flipsScheduledTo = pass + FLIPS_AHEAD;
	}

	/** A position moved inside the loop: one outside it goes to the loop's start. */
	private intoLoop(at: number) {
		const position = Math.max(0, at);

		return this.loop &&
			(position < this.loop.start || position >= this.loop.end)
			? this.loop.start
			: position;
	}

	setLevels(levels: number[]) {
		this.gains.forEach((node, index) => {
			node.gain.cancelScheduledValues(this.context.currentTime);
			node.gain.setTargetAtTime(levels[index], this.context.currentTime, 0.005);
		});
	}
	play() {
		if (this.playing || !this.duration) return;

		if (this.storedPosition >= this.duration) this.storedPosition = 0;
		const generation = ++this.generation;
		// Schedule ahead so source creation cannot stagger the two start times.
		this.startedAt = this.context.currentTime + 0.03;
		this.playing = true;
		this.sources = this.buffers.map((buffer, index) => {
			const source = this.context.createBufferSource();
			source.buffer = buffer;

			// Both sources loop the same passage, each at its own offset, so they stay on one clock.
			if (this.loop) {
				source.loop = true;
				source.loopStart = this.loop.start + this.offsets[index];
				source.loopEnd = this.loop.end + this.offsets[index];
			}

			source.connect(this.gains[index]);
			source.onended = () => {
				if (generation !== this.generation) return;
				this.pause();
				this.storedPosition = this.duration;
				this.onEnded();
			};

			if (this.loop)
				source.start(this.startedAt, this.storedPosition + this.offsets[index]);
			else
				source.start(
					this.startedAt,
					this.storedPosition + this.offsets[index],
					this.duration - this.storedPosition,
				);

			return source;
		});

		if (this.flip) this.scheduleFlips();
	}
	pause() {
		// A resumed flip starts from the version sounding now; the next play schedules the flips again.
		if (this.flip) this.flip.first = this.flipped ?? this.flip.first;
		this.storedPosition = this.position;
		this.playing = false;
		this.generation++;
		this.sources.forEach((source) => {
			source.onended = null;
			source.stop();
			source.disconnect();
		});
		this.sources = [];
	}
	seek(position: number) {
		const resume = this.playing;
		this.pause();
		this.storedPosition = this.intoLoop(Math.min(position, this.duration));

		if (resume && this.storedPosition < this.duration) this.play();
	}
}
