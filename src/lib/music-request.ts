export async function musicRequest(request: Request, maxBytes = 8192): Promise<unknown | Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return Response.json({ ok: false, error: 'JSON required' }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ ok: false, error: 'Missing request' }, { status: 400 });
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); return Response.json({ ok: false, error: 'Request too large' }, { status: 413 }); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
}
export const musicUnavailable = () => Response.json({ ok: false, error: 'Your request could not be saved. Please try again shortly.' }, { status: 503 });
