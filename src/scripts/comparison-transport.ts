/** A passage of the song that repeats, in the song's time (seconds). */
export type LoopRegion = { start: number; end: number };

/** Both decoded exports run on one audio clock. Switching changes gain, never time. */
export class ComparisonTransport {
	private sources: AudioBufferSourceNode[] = [];
	private gains: GainNode[];
	private storedPosition = 0;
	private startedAt = 0;
	private generation = 0;
	private loop: LoopRegion | undefined;
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

	/** The audio clock time of the loop's next wrap while looping, so a level change can land exactly on it. */
	get nextWrap() {
		if (!this.playing || !this.loop) return undefined;
		const length = this.loop.end - this.loop.start;
		const wrapAt = this.loop.end + this.pass * length;

		return this.startedAt + (wrapAt - this.storedPosition);
	}

	/** Loops a passage, or stops looping with undefined. Playing carries on, moved into the passage if it was outside. */
	setLoop(loop: LoopRegion | undefined) {
		const resume = this.playing;
		const at = this.position;
		this.pause();
		this.loop = loop && {
			start: Math.max(0, loop.start),
			end: Math.min(this.duration, loop.end),
		};
		this.storedPosition =
			this.loop && (at < this.loop.start || at >= this.loop.end)
				? this.loop.start
				: at;

		if (resume) this.play();
	}

	/** Sets the levels at an audio clock time instead of now, for a switch that must land on a loop's wrap. */
	setLevelsAt(levels: number[], time: number) {
		this.gains.forEach((node, index) => {
			node.gain.cancelScheduledValues(time);
			node.gain.setTargetAtTime(levels[index], time, 0.003);
		});
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
	}
	pause() {
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
		this.storedPosition = Math.max(0, Math.min(position, this.duration));

		if (resume && this.storedPosition < this.duration) this.play();
	}
}
