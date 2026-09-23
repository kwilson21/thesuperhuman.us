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

/** SVG bars for a 320×40 viewBox, centered on the midline. */
export function waveformRects(peaks: number[]): string {
  const width = 320 / peaks.length;
  return peaks.map((peak, index) => {
    const height = Math.max(2, peak / 100 * 40);
    return `<rect x="${(index * width + width * .2).toFixed(2)}" y="${(20 - height / 2).toFixed(2)}" width="${(width * .6).toFixed(2)}" height="${height.toFixed(2)}" rx="${(width * .3).toFixed(2)}"/>`;
  }).join('');
}

type ReadRange = (start: number, end: number) => Promise<ArrayBuffer>;
const chunkBytes = 1024 * 1024;

/**
 * Peaks for a WAV file, measured from every sample but read in 1 MiB chunks, so memory stays
 * bounded at any file size and a short transient is never skipped. Returns null for anything
 * other than 16/24/32-bit integer or 32-bit float PCM.
 */
export async function peaksFromWav(read: ReadRange, size: number, count = peakCount): Promise<number[] | null> {
  const header = new DataView(await read(0, Math.min(size, 12)));
  if (header.byteLength < 12 || text(header, 0) !== 'RIFF' || text(header, 8) !== 'WAVE') return null;
  let offset = 12, format = 0, channels = 0, bits = 0, block = 0, dataStart = -1, dataSize = 0;
  // Walk the chunk list with 8-byte reads until the data chunk; fmt usually precedes it.
  for (let guard = 0; offset + 8 <= size && guard < 64; guard++) {
    const chunk = new DataView(await read(offset, offset + 8));
    const id = text(chunk, 0), length = chunk.getUint32(4, true);
    if (id === 'fmt ') {
      const fmt = new DataView(await read(offset + 8, offset + 8 + Math.min(length, 40)));
      format = fmt.getUint16(0, true); channels = fmt.getUint16(2, true); block = fmt.getUint16(12, true); bits = fmt.getUint16(14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its subformat GUID.
      if (format === 0xfffe && fmt.byteLength >= 26) format = fmt.getUint16(24, true);
    } else if (id === 'data') { dataStart = offset + 8; dataSize = Math.min(length, size - dataStart); break; }
    offset += 8 + length + (length % 2);
  }
  const integer = format === 1 && [16, 24, 32].includes(bits), float = format === 3 && bits === 32;
  if (dataStart < 0 || !channels || !block || block !== channels * bits / 8 || (!integer && !float)) return null;
  const frames = Math.floor(dataSize / block);
  if (frames < count) return null;
  const width = bits / 8;
  const sample = (view: DataView, at: number) => float ? Math.abs(view.getFloat32(at, true))
    : bits === 16 ? Math.abs(view.getInt16(at, true)) / 32768
    : bits === 24 ? Math.abs((view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getInt8(at + 2) << 16)) / 8388608
    : Math.abs(view.getInt32(at, true)) / 2147483648;
  const bars = new Array<number>(count).fill(0);
  const framesPerChunk = Math.max(1, Math.floor(chunkBytes / block));
  for (let first = 0; first < frames; first += framesPerChunk) {
    const length = Math.min(framesPerChunk, frames - first);
    const view = new DataView(await read(dataStart + first * block, dataStart + (first + length) * block));
    for (let frame = 0; frame < length; frame++) {
      const bar = Math.min(count - 1, Math.floor((first + frame) * count / frames));
      for (let channel = 0, at = frame * block; channel < channels; channel++, at += width) {
        const value = sample(view, at);
        if (value > bars[bar]) bars[bar] = value;
      }
    }
  }
  const loudest = Math.max(...bars.map(value => Math.min(1, value)));
  return bars.map(value => loudest ? Math.round(Math.min(1, value) / loudest * 100) : 0);
}

function text(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}
