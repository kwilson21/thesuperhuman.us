export function waveformGeometry(amplitudes: readonly number[]) {
  return amplitudes.map(amplitude => {
    const halfHeight = Math.max(1, amplitude * 30);
    return { y1: 32 - halfHeight, y2: 32 + halfHeight };
  });
}

export function waveformSeekSeconds(clientX: number, left: number, width: number, duration: number) {
  return width > 0 ? Math.min(duration, Math.max(0, (clientX - left) / width * duration)) : 0;
}

/** Touch can scroll the page, so a finger scrubs only once it moves sideways; mouse and pen scrub at once. */
export function isWaveformScrub(pointerType: string, dx: number, dy: number) {
  return pointerType !== 'touch' || Math.abs(dx) > Math.abs(dy);
}
