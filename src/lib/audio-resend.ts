import type { AudioInquiryInput } from './audio-validation';

const ENDPOINT = 'https://api.resend.com/emails';

interface SendArgs {
  input: AudioInquiryInput;
  apiKey: string;
  from: string;
  to: string;
}

function body(input: AudioInquiryInput): string {
  const lines = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Services: ${input.services.join(', ')}`,
    input.trackCount !== undefined ? `Track count: ${input.trackCount}` : null,
    `Target date: ${input.flexible || !input.targetDate ? 'flexible' : input.targetDate}`,
    `Delivery: ${input.delivery}`,
    input.references ? `References: ${input.references}` : null,
    '',
    'Notes:',
    input.notes,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export async function sendAudioInquiry(args: SendArgs): Promise<{ ok: boolean }> {
  const payload = {
    from: args.from,
    to: [args.to],
    subject: `Audio inquiry: ${args.input.services.join(', ')} from ${args.input.name}`,
    text: body(args.input),
    reply_to: args.input.email,
  };
  return sendAudioMessage({ payload, apiKey: args.apiKey });
}

export async function sendAudioMessage({ payload, apiKey }: { payload: { from: string; to: string[]; subject: string; text: string; reply_to?: string }; apiKey: string }): Promise<{ ok: boolean; uncertain?: boolean }> {
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

const noticeIntro = {
  invitation: 'Your private audio project is ready. Follow its progress and send messages there.',
  update: 'There is an update to your private audio project.',
};

export async function sendStudioSignInNotice(apiKey: string, from: string, to: string, subject: string,
  kind: keyof typeof noticeIntro = 'update'): Promise<{ ok: boolean; uncertain?: boolean }> {
  return sendAudioMessage({ apiKey, payload: {
    from, to: [to], subject,
    text: `${noticeIntro[kind]} Sign in to see it: https://thesuperhuman.us/studio/sign-in`,
  } });
}
