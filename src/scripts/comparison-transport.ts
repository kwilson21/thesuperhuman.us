/** Both decoded exports run on one audio clock. Switching changes gain, never time. */
export class ComparisonTransport {
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[];
  private storedPosition = 0;
  private startedAt = 0;
  private generation = 0;
  readonly duration: number;
  playing = false;

  constructor(private context: AudioContext, private buffers: AudioBuffer[], private offsets: number[], duration: number, private onEnded: () => void) {
    this.duration = Math.max(0, Math.min(duration, ...buffers.map((buffer, index) => buffer.duration - offsets[index])));
    this.gains = buffers.map(() => {
      const gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination); return gain;
    });
  }
  get position() {
    return Math.min(this.duration, this.storedPosition + (this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0));
  }
  setLevels(levels: number[]) {
    this.gains.forEach((node, index) => {
      node.gain.cancelScheduledValues(this.context.currentTime);
      node.gain.setTargetAtTime(levels[index], this.context.currentTime, .005);
    });
  }
  play() {
    if (this.playing || !this.duration) return;
    if (this.storedPosition >= this.duration) this.storedPosition = 0;
    const generation = ++this.generation;
    // Schedule ahead so source creation cannot stagger the two start times.
    this.startedAt = this.context.currentTime + .03;
    this.playing = true;
    this.sources = this.buffers.map((buffer, index) => {
      const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gains[index]);
      source.onended = () => {
        if (generation !== this.generation) return;
        this.pause(); this.storedPosition = this.duration; this.onEnded();
      };
      source.start(this.startedAt, this.storedPosition + this.offsets[index], this.duration - this.storedPosition);
      return source;
    });
  }
  pause() {
    this.storedPosition = this.position; this.playing = false; this.generation++;
    this.sources.forEach(source => { source.onended = null; source.stop(); source.disconnect(); }); this.sources = [];
  }
  seek(position: number) {
    const resume = this.playing; this.pause();
    this.storedPosition = Math.max(0, Math.min(position, this.duration));
    if (resume && this.storedPosition < this.duration) this.play();
  }
}
