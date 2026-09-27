// Scroll progress for the site's motion layer (src/scripts/scroll-scenes.ts). Pure, so
// it is unit tested and shared by every page that marks elements with [data-scene].

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
