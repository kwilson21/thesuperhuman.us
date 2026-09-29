export const softwareVisualLimit = 5 * 1024 * 1024;
export const softwareVisualTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
export function softwareVisualMatches(bytes: ArrayBuffer, type: string) {
  const b = new Uint8Array(bytes);
  if (type === 'image/png') return b.length >= 8 && [137,80,78,71,13,10,26,10].every((value, i) => b[i] === value);
  if (type === 'image/jpeg') return b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  return type === 'image/webp' && b.length >= 12 && new TextDecoder().decode(b.slice(0,4)) === 'RIFF' && new TextDecoder().decode(b.slice(8,12)) === 'WEBP';
}
export function softwareVisualKey(key: string, requestId: string, updateId: string) {
  return key.startsWith(`software/${requestId}/${updateId}/`) && /^software\/[a-z0-9-]{1,100}\/[a-z0-9-]{1,100}\/[a-z0-9-]+\.(png|jpg|webp)$/.test(key);
}
export const softwareVisualHeaders = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
