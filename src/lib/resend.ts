import type { ContactInput } from './validation';

const ENDPOINT = 'https://api.resend.com/emails';

interface SendArgs {
  input: ContactInput;
  apiKey: string;
  from: string;
  to: string;
}

function primaryBody(input: ContactInput): string {
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.company ? `Company: ${input.company}` : null,
    `Project type: ${input.projectType.join(', ')}`,
    `Timeline: ${input.timeline}`,
    input.budget ? `Budget: ${input.budget}` : null,
    '',
    'Description:',
    input.description,
  ]
    .filter(Boolean)
    .join('\n');
}

function autoresponderBody(): string {
  return [
    'Thanks for reaching out — I got your message and will respond within two business days.',
    '',
    'In the meantime, if you want a deeper look at my background, the resumes on https://thesuperhuman.us/about (general, leadership, and DoD-focused) cover different angles.',
    '',
    '— Kazon',
  ].join('\n');
}

async function sendOne(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<boolean> {
  const payload: Record<string, unknown> = {
    from: args.from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  };
  if (args.replyTo) payload.reply_to = args.replyTo;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return false;
  }
  return res.ok;
}

export async function sendContactEmails(args: SendArgs): Promise<{ ok: boolean }> {
  const primaryOk = await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.to,
    subject: `New inquiry from ${args.input.name} — ${args.input.projectType.join(', ')}`,
    text: primaryBody(args.input),
    replyTo: args.input.email,
  });
  if (!primaryOk) return { ok: false };

  // Best-effort autoresponder — do not fail the request if this errors.
  await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.input.email,
    subject: 'Thanks for reaching out — Kazon Wilson',
    text: autoresponderBody(),
  }).catch(() => false);

  return { ok: true };
}
