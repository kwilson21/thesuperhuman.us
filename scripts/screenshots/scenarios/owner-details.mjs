// Owner detail pages need a record to show. Seeds one service request and one campaign,
// then captures both pages at desktop and phone size.
const at = '2026-09-22T12:00:00.000Z';

export default {
  title: 'Owner detail pages',
  async run({ capture, sql }) {
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
      VALUES ('screenshot-request','service','vocal-mix','Sample Client','client@example.com','Richmond, VA','Sample Song · Two-track vocal mixing',
      '{"title":"Sample Song","direction":"judgment"}','new','','${at}','${at}')`);
    sql(`INSERT OR IGNORE INTO owner_campaigns(id,subject_type,subject_id,name,primary_goal,starts_at,status,created_at,updated_at)
      VALUES ('screenshot-campaign','release','old-news-single','Old News premiere','Grow saved listeners','2026-09-01','active','${at}','${at}')`);
    const steps = [];
    for (const [title, route, name] of [['Request detail', '/owner/requests/screenshot-request', 'owner-request'],
      ['Campaign detail', '/owner/campaigns/screenshot-campaign', 'owner-campaign']]) {
      const images = [];
      for (const viewport of ['desktop', 'phone']) {
        images.push({ file: await capture({ file: `${name}-${viewport}.png`, path: route, viewport, owner: true }), caption: `${title}, ${viewport}` });
      }
      steps.push({ title, images });
    }
    return steps;
  },
};
