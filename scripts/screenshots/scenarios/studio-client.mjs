// A studio project from request to first review and back out again (revoking the review, then
// closing access), through the owner's real routes. Seeds only what
// needs an outside service: the request (Turnstile intake), the paid booking (a Stripe webhook),
// the client's session and message (an emailed code). Client notices fail without a Resend key.
import { createHash } from 'node:crypto';

const at = '2026-09-22T12:00:00.000Z';
const id = 'screenshot-studio';
const email = 'studio-client@example.com';
const token = '00000000-0000-4000-8000-000000000000'.repeat(2);
const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** One second of a shaped 220 Hz tone as a 16-bit mono WAV, and its waveform peaks. */
function reviewMix() {
  const rate = 8000;
  const samples = Array.from({ length: rate }, (_, i) => Math.sin(2 * Math.PI * 220 * i / rate) * Math.exp(-1.5 * i / rate) * (0.4 + 0.6 * Math.abs(Math.sin(i / 700))));
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(sample * 32767), true));
  const bars = 160;
  const peaks = Array.from({ length: bars }, (_, bar) => {
    const slice = samples.slice(Math.floor(bar * samples.length / bars), Math.floor((bar + 1) * samples.length / bars));
    return Math.round(Math.max(...slice.map(Math.abs)) * 100);
  });
  return { bytes, peaks };
}

export default {
  title: 'Client studio',
  async run({ capture, sql, ownerFetch }) {
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
      VALUES ('${id}','service','vocal-mix','Studio Client','${email}','Richmond, VA','Sample Song · Two-track vocal mixing',
      '{"title":"Sample Song","direction":"judgment"}','new','','${at}','${at}')`);
    sql(`INSERT OR IGNORE INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,booking_status,created_at,updated_at) VALUES ('${id}','Two-track vocal mixing',15000,7500,7500,'${at}','paid','${at}','${at}')`);
    sql(`INSERT OR IGNORE INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      VALUES ('${createHash('sha256').update(token).digest('hex')}','${email}','${at}','2099-01-01T00:00:00.000Z','${at}')`);
    const cookie = { name: 'studio_session', value: token };
    const project = `/api/owner/projects/${id}`;
    const shots = async (title, path, name, options = {}) => {
      const images = [];
      for (const viewport of ['desktop', 'phone']) {
        images.push({ file: await capture({ file: `${name}-${viewport}.png`, path, viewport, ...options }), caption: `${title}, ${viewport}` });
      }
      return { title, images };
    };
    const steps = [];

    await ownerFetch(`/api/owner/requests/${id}`, { action: 'review' });
    steps.push(await shots('Request reviewed and ready to accept', `/owner/requests/${id}`, 'studio-01-owner-reviewed', { owner: true }));

    await ownerFetch(`${project}/updates`, { action: 'accept', dueDate: day(10), body: 'Thanks for sending this. I will start with the lead vocal and keep the arrangement as it is.' });
    await ownerFetch(`${project}/updates`, { action: 'start_work', body: 'Working on the lead vocal balance and de-essing first.' });
    await ownerFetch(`${project}/updates`, { action: 'revise_date', dueDate: day(14), reason: 'client_clarification', body: 'Moving the date while I wait on the alternate chorus take you mentioned.' });
    sql(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
      VALUES ('${id}','client','${email}','The alternate chorus take is in the same Drive folder, named chorus_alt.wav.','${new Date().toISOString()}')`);
    await ownerFetch(`${project}/messages`, { action: 'send', body: 'Got it, thank you. I will use it for the last chorus.' });

    const { bytes, peaks } = reviewMix();
    const start = await ownerFetch(`${project}/uploads`, { action: 'start', version: 'review', displayName: 'Sample Song review 1.wav', mediaType: 'audio/wav', byteSize: bytes.length });
    const part = await ownerFetch(`${project}/uploads?uploadId=${start.uploadId}&part=1`, bytes, 'PUT');
    await ownerFetch(`${project}/uploads`, { action: 'complete', uploadId: start.uploadId, parts: [part.part], peaks });
    await ownerFetch(`${project}/files/${start.uploadId}`, { action: 'publish', note: 'Here is the first review mix. Listen on headphones and on a phone speaker.', downloadable: false });

    steps.push(await shots('Review published: timeline, files and conversation', `/owner/requests/${id}`, 'studio-02-owner-review', { owner: true }));
    steps.push(await shots('Your songs (session seeded; sign-in needs an emailed code)', '/studio', 'studio-home', { cookie }));
    steps.push(await shots('The client hears the review', `/studio/projects/${id}`, 'studio-project', { cookie }));
    steps.push(await shots('Today lists the song', '/owner', 'studio-03-owner-today', { owner: true }));

    // Recovery: withdraw the review, then close the client's access entirely.
    await ownerFetch(`${project}/files/${start.uploadId}`, { action: 'revoke', note: 'I found a clipped vocal in this review. A corrected mix is coming.' });
    steps.push(await shots('Review revoked: the client sees the note, not the file', `/studio/projects/${id}`, 'studio-04-client-revoked', { cookie }));
    await ownerFetch(`${project}/access`, { action: 'revoke' });
    steps.push(await shots('Access closed: the owner view', `/owner/requests/${id}`, 'studio-05-owner-closed', { owner: true }));
    steps.push(await shots('Access closed: the client link now explains itself', `/studio/projects/${id}`, 'studio-06-client-closed', { cookie, status: 404 }));
    return steps;
  },
};
