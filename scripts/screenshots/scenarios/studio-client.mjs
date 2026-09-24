// Studio pages need a signed-in client. Seeds a service request (a trigger creates its project)
// and a session directly, because sign-in needs an emailed code. Captures the song list and the
// project page at desktop and phone size.
import { createHash } from 'node:crypto';

const at = '2026-09-22T12:00:00.000Z';
const email = 'studio-client@example.com';
const token = '00000000-0000-4000-8000-000000000000'.repeat(2);

export default {
  title: 'Client studio',
  async run({ capture, sql }) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
      VALUES ('screenshot-studio','service','vocal-mix','Studio Client','${email}','Richmond, VA','Sample Song · Two-track vocal mixing',
      '{"title":"Sample Song","direction":"judgment"}','reviewed','','${at}','${at}')`);
    sql(`UPDATE audio_projects SET stage='in_progress',original_due_at='2026-10-02',current_due_at='2026-10-02' WHERE request_id='screenshot-studio'`);
    sql(`INSERT OR IGNORE INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      VALUES ('${tokenHash}','${email}','${at}','2099-01-01T00:00:00.000Z','${at}')`);
    const cookie = { name: 'studio_session', value: token };
    const steps = [];
    for (const [title, path, name] of [['Your songs', '/studio', 'studio-home'],
      ['Project page', '/studio/projects/screenshot-studio', 'studio-project']]) {
      const images = [];
      for (const viewport of ['desktop', 'phone']) {
        images.push({ file: await capture({ file: `${name}-${viewport}.png`, path, viewport, cookie }), caption: `${title}, ${viewport}` });
      }
      steps.push({ title: `${title} (session seeded; sign-in needs an emailed code)`, images });
    }
    return steps;
  },
};
