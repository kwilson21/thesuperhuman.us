export function waveformGeometry(amplitudes: readonly number[]) {
  return amplitudes.map(amplitude => {
    const halfHeight = Math.max(1, amplitude * 30);
    return { y1: 32 - halfHeight, y2: 32 + halfHeight };
  });
}

export function waveformSeekSeconds(clientX: number, left: number, width: number, duration: number) {
  return width > 0 ? (clientX - left) / width * duration : 0;
}
