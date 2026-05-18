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
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
