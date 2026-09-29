// Fictional request for reviewing the read-only owner brief at both widths.
export default {
  title: 'Software brief owner readback',
  async run({ capture, sql }) {
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES ('screenshot-software','software','workflow','Alex Example','alex@example.com','One place to see what each client needs next.',
      '{"path":"workflow","today":"We track onboarding in spreadsheets.\\nWe chase updates by email.","audience":"Our client team","firstResult":"One place to see what each client needs next.","company":"Example Studio","timing":"flexible","timingReason":"","budgetStatus":"exploring","budgetNote":"","approver":"self","approverRole":""}',
      'new','','2026-09-29T12:00:00.000Z','2026-09-29T12:00:00.000Z','00000000-0000-4000-8000-000000000001')`);
    const images = [];
    for (const viewport of ['desktop', 'phone'])
      images.push({ file: await capture({ file: `software-brief-owner-${viewport}.png`, path: '/owner/requests/screenshot-software', viewport, owner: true }), caption: `Fictional software brief, ${viewport}` });
    return [{ title: 'Owner reads the saved brief', images }];
  },
};
