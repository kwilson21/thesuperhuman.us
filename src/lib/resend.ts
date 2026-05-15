import type { ContactInput } from './validation';
import type { ResumeAudience, StoredResumeRequest } from './resume-requests';

const ENDPOINT = 'https://api.resend.com/emails';

interface SendArgs {
  input: ContactInput;
  apiKey: string;
  from: string;
  to: string;
}

interface Attachment {
  filename: string;
  content: string; // base64
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
    'Thanks for reaching out. I got your message and will respond within two business days.',
    '',
    'In the meantime, if you want a deeper look at my background, the resumes on https://thesuperhuman.us/about (general and DoD-focused) cover different angles.',
    '',
    'Kazon',
  ].join('\n');
}

async function sendOne(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: Attachment[];
}): Promise<boolean> {
  const payload: Record<string, unknown> = {
    from: args.from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  };
  if (args.replyTo) payload.reply_to = args.replyTo;
  if (args.attachments && args.attachments.length > 0) {
    payload.attachments = args.attachments;
  }

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function sendContactEmails(args: SendArgs): Promise<{ ok: boolean }> {
  const primaryOk = await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.to,
    subject: `New inquiry from ${args.input.name}: ${args.input.projectType.join(', ')}`,
    text: primaryBody(args.input),
    replyTo: args.input.email,
  });
  if (!primaryOk) return { ok: false };

  // Best-effort autoresponder. Do not fail the request if this errors.
  await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.input.email,
    subject: 'Thanks for reaching out (Kazon Wilson)',
    text: autoresponderBody(),
  }).catch(() => false);

  return { ok: true };
}

interface ResumeApprovalArgs {
  request: StoredResumeRequest;
  apiKey: string;
  from: string;
  to: string;
  approvalUrl: string;
}

function approvalNotificationBody(req: StoredResumeRequest, approvalUrl: string): string {
  return [
    `Name: ${req.name}`,
    `Email: ${req.email}`,
    req.company ? `Company: ${req.company}` : null,
    `Audience: ${req.audience}`,
    req.note ? '' : null,
    req.note ? 'Note:' : null,
    req.note ? req.note : null,
    '',
    'Approve and send the resume by clicking this link (single-use, expires in 7 days):',
    approvalUrl,
    '',
    'To deny: simply ignore this email. The request will expire on its own.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export async function sendResumeApprovalRequest(
  args: ResumeApprovalArgs,
): Promise<{ ok: boolean }> {
  const ok = await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.to,
    subject: `Resume request from ${args.request.name}: ${args.request.audience}`,
    text: approvalNotificationBody(args.request, args.approvalUrl),
    replyTo: args.request.email,
  });
  return { ok };
}

interface ResumeDeliveryArgs {
  apiKey: string;
  from: string;
  to: string;
  name: string;
  audience: ResumeAudience;
  pdf: ArrayBuffer;
  filename: string;
}

function deliveryBody(name: string): string {
  return [
    `Hi ${name},`,
    '',
    'My resume is attached. Let me know if anything sparks a conversation.',
    'Reply to this email or use the contact form at https://thesuperhuman.us/#contact.',
    '',
    'Kazon',
  ].join('\n');
}

export async function sendResumeDelivery(
  args: ResumeDeliveryArgs,
): Promise<{ ok: boolean }> {
  const ok = await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.to,
    subject: 'Your requested resume (Kazon Wilson)',
    text: deliveryBody(args.name),
    attachments: [
      {
        filename: args.filename,
        content: arrayBufferToBase64(args.pdf),
      },
    ],
  });
  return { ok };
}
