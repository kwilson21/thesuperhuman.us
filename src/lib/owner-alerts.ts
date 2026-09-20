import { sendAudioMessage } from './audio-resend';

export type OwnerIncident = {
  category: 'request-storage';
  route: '/api/audio-intake' | '/api/music-interest';
  requestId: string;
  code: 'd1-write-failed';
  occurredAt: string;
};

export async function sendUrgentOwnerAlert(env: Env, incident: OwnerIncident): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL || !env.CONTACT_TO_EMAIL) return false;
  const text = [
    'A valid visitor request could not be stored.',
    `Category: ${incident.category}`,
    `Route: ${incident.route}`,
    `Request ID: ${incident.requestId}`,
    `Failure code: ${incident.code}`,
    `Occurred at: ${incident.occurredAt}`,
    '',
    'No visitor name, email, files, notes or challenge token are included in this alert.',
  ].join('\n');
  const result = await sendAudioMessage({
    apiKey: env.RESEND_API_KEY,
    payload: {
      from: env.CONTACT_FROM_EMAIL,
      to: [env.CONTACT_TO_EMAIL],
      subject: 'Urgent: website request storage failed',
      text,
    },
  });
  return result.ok;
}
