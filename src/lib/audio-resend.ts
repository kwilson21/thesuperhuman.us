import type { IntakeInput } from './audio-intake';
import { audioOffers, describePreferences } from './audio-intake';
import { studioInvitationEmail, studioUpdateEmail } from './client-emails';
import { softwareLabels, softwarePaths, softwareQuestions } from './software-inquiry';

const ENDPOINT = 'https://api.resend.com/emails';

export async function sendAudioMessage({ payload, apiKey }: { payload: { from: string; to: string[]; subject: string; text: string; html?: string; reply_to?: string }; apiKey: string }): Promise<{ ok: boolean; uncertain?: boolean }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, uncertain: !res.ok && res.status >= 500 };
  } catch {
    // A timeout does not prove the provider rejected the email.
    return { ok: false, uncertain: true };
  }
}

const notices = { invitation: studioInvitationEmail, update: studioUpdateEmail };

export async function sendStudioSignInNotice(apiKey: string, from: string, to: string, subject: string,
  kind: keyof typeof notices = 'update', origin?: string): Promise<{ ok: boolean; uncertain?: boolean }> {
  return sendAudioMessage({ apiKey, payload: { from, to: [to], subject, ...notices[kind](origin) } });
}

const DIRECTION_LABELS: Record<IntakeInput['direction'], string> = {
  judgment: 'Use your judgment',
  preferences: 'I have a few preferences',
  specific: 'I have a specific direction',
};

function ownerRequestNoticeSubject(input: IntakeInput): string {
  return `Song request from ${input.name}: ${audioOffers[input.service].name}`;
}

function ownerRequestNoticeBody(input: IntakeInput, requestId: string, origin = 'https://thesuperhuman.us'): string {
  const preferences = describePreferences(input.service, input.preferences);
  const lines = [
    `Service: ${audioOffers[input.service].name}`,
    `Title: ${input.title}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.fileLink ? `Files: ${input.fileLink}` : 'Files: none provided yet.',
    `Direction: ${DIRECTION_LABELS[input.direction]}`,
    preferences.length ? `Preferences: ${preferences.join('; ')}` : null,
    input.preserve ? `Keep or avoid: ${input.preserve}` : null,
    input.referenceUrl ? `Reference link: ${input.referenceUrl}` : null,
    input.referenceNote ? `Notes: ${input.referenceNote}` : null,
    '',
    `Review this request: ${new URL(`/owner/requests/${requestId}`, origin).href}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

interface OwnerRequestNoticeArgs {
  input: IntakeInput;
  origin?: string;
  requestId: string;
  apiKey: string;
  from: string;
  to: string;
}

/** Alerts the operator to a new song request, regardless of the client-portal flag. */
export async function sendOwnerRequestNotice(args: OwnerRequestNoticeArgs): Promise<{ ok: boolean; uncertain?: boolean }> {
  if (!args.apiKey || !args.from || !args.to) return { ok: false };
  return sendAudioMessage({
    apiKey: args.apiKey,
    payload: {
      from: args.from,
      to: [args.to],
      subject: ownerRequestNoticeSubject(args.input),
      text: ownerRequestNoticeBody(args.input, args.requestId, args.origin),
      reply_to: args.input.email,
    },
  });
}

export async function sendSoftwareRequestNotice(args: {
  requestId: string; path: keyof typeof softwarePaths; name: string; email: string;
  brief: Record<string, string>;
  origin?: string; apiKey?: string; from?: string; to?: string;
}): Promise<{ ok: boolean; uncertain?: boolean }> {
  if (!args.apiKey || !args.from || !args.to) return { ok: false };
  return sendAudioMessage({
    apiKey: args.apiKey,
    payload: {
      from: args.from, to: [args.to], reply_to: args.email,
      subject: `Software request from ${args.name}: ${softwarePaths[args.path]}`,
      text: `A software project brief is ready for review.\n\n${softwareQuestions[args.path].map(key => `${softwareLabels[key]}\n${args.brief[key]}`).join('\n\n')}\n\n${new URL(`/owner/requests/${args.requestId}`, args.origin ?? 'https://thesuperhuman.us').href}`,
    },
  });
}
