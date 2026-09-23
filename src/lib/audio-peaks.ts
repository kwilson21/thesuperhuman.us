// Waveform peaks for private studio files. The owner's browser measures them while
// uploading; the server only validates and stores the numbers.
export const peakCount = 160;

/** Loudest absolute sample per bar across all channels, scaled to 0-100. */
export function peaksFromChannels(channels: Float32Array[], count = peakCount): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const bars = Array.from({ length: count }, (_, bar) => {
    const start = Math.floor(bar * length / count);
    const end = Math.max(start + 1, Math.floor((bar + 1) * length / count));
    let peak = 0;
    for (const channel of channels) for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    return peak;
  });
  const loudest = Math.max(...bars);
  return bars.map(value => loudest ? Math.round(value / loudest * 100) : 0);
}

/** Accepts only a short list of whole numbers from 0 to 100. */
export function parsePeaks(value: unknown): number[] | null {
  const peaks = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!Array.isArray(peaks) || peaks.length < 16 || peaks.length > 400) return null;
  return peaks.every(peak => Number.isInteger(peak) && peak >= 0 && peak <= 100) ? peaks as number[] : null;
}
