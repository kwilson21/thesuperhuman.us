// Pure helpers behind Home's scroll scenes. The server renders each scene's resting
// frame with these, and src/scripts/home-worlds.ts animates the same shapes, so the
// page is complete without JavaScript or with reduced motion.

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface SceneMeasure {
  /** The scene's top edge relative to the viewport, in pixels. */
  top: number;
  /** Viewport height in pixels. */
  viewport: number;
  /** Where the scene starts, as a fraction of the viewport height (1 = its top meets the bottom edge). */
  start: number;
  /** Where it ends, as the same fraction. */
  end: number;
  /** The scene's top when the page is scrolled to the bottom. A scene near the foot of the page
   *  may never reach `end`, so this caps it and every scene can finish. */
  topAtMaxScroll: number;
}

/** How far a scene has travelled, from 0 (not started) to 1 (finished). */
export function sceneProgress({ top, viewport, start, end, topAtMaxScroll }: SceneMeasure): number {
  const from = viewport * start;
  const to = Math.max(viewport * end, topAtMaxScroll);
  if (from - to < 1) return 1;
  return clamp01((from - top) / (from - to));
}

export interface Figure { prefix: string; value: number; suffix: string; }

/** Reads a display figure such as "100,000+" into its number and the text around it. */
export function parseFigure(text: string): Figure | null {
  const match = /^(\D*)(\d[\d,]*)(\D*)$/.exec(text.trim());
  if (!match) return null;
  return { prefix: match[1], value: Number(match[2].replace(/,/g, '')), suffix: match[3] };
}

/** Writes a figure back in the site's format, optionally at an in-between value while counting. */
export function formatFigure(figure: Figure, value = figure.value): string {
  return `${figure.prefix}${Math.round(value).toLocaleString('en-US')}${figure.suffix}`;
}

export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** Unit cells for a before-and-after capacity comparison: one cell is the old capacity. */
export function capacityCells(before: Figure, after: Figure, max = 40): number {
  if (before.value <= 0) return 1;
  return Math.max(1, Math.min(max, Math.round(after.value / before.value)));
}

/** Deterministic pseudo-random numbers, so the server-rendered frame and the animated one match. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Peak heights (0 to 1) for a waveform that fades in, swells twice, and fades out, like a sung phrase. */
export function waveformPeaks(count: number, seed = 7): number[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, index) => {
    const x = count > 1 ? index / (count - 1) : 0.5;
    const taper = Math.sin(Math.PI * x) ** 0.7;
    const swells = 0.62 + 0.38 * Math.sin(Math.PI * (x * 4 - 0.35));
    return clamp01(taper * swells * (0.42 + 0.58 * random()));
  });
}

/** Bar heights for scroll progress: silent at either edge of the viewport, loudest crossing the middle. */
export function signalFrame(peaks: number[], progress: number): number[] {
  const level = Math.sin(Math.PI * clamp01(progress));
  return peaks.map((peak, index) => peak * level * (0.78 + 0.22 * Math.sin(index * 0.55 - progress * 16)));
}

export interface BarLayout {
  /** Width of the drawing in viewBox units. */
  width: number;
  /** The zero line the bars grow from. */
  mid: number;
  /** The height of a full-scale bar. */
  depth: number;
  /** Bars grow up from the zero line, or down from it. */
  direction: 'up' | 'down';
  /** Share of each slot the bar fills; the rest is the gap. */
  fill?: number;
}

/** One SVG path of rectangles, one per height, rounded to keep the markup small. */
export function barsPath(heights: number[], { width, mid, depth, direction, fill = 0.58 }: BarLayout): string {
  const slot = width / heights.length;
  const bar = +(slot * fill).toFixed(2);
  return heights.map((height, index) => {
    const size = +(clamp01(height) * depth).toFixed(2);
    if (size < 0.05) return '';
    const x = +(index * slot + (slot - bar) / 2).toFixed(2);
    const y = direction === 'up' ? +(mid - size).toFixed(2) : mid;
    return `M${x} ${y}h${bar}v${size}h${-bar}z`;
  }).join('');
}

export interface CodeSegment { width: number; tone: number; }
export interface CodeRow { indent: number; segments: CodeSegment[]; }

/** Rows of syntax-coloured bars that read as code at a glance and say nothing. */
export function codeRows(count: number, seed = 3, tones = 5): CodeRow[] {
  const random = seeded(seed);
  let indent = 0;
  return Array.from({ length: count }, () => {
    const step = random();
    indent = step < 0.3 ? Math.min(indent + 1, 4) : step < 0.55 ? Math.max(indent - 1, 0) : indent;
    const segments = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
      width: 4 + Math.floor(random() * 14),
      tone: Math.floor(random() * tones),
    }));
    return { indent, segments };
  });
}
