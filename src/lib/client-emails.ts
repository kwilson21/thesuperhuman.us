import { softwareLabels } from './software-inquiry';
import { renderEmail } from './email-template';

const site = 'https://thesuperhuman.us';
const studioSignIn = (origin = site) => new URL('/studio/sign-in', origin).href;
// Studio emails carry no project details: the client signs in to see them.
const signInNote = 'Sign in with this email address. You’ll get a one-time code to finish.';

export const studioInvitationEmail = (origin?: string) => renderEmail({
  preheader: 'Your private studio is ready.',
  kicker: 'Studio',
  heading: 'Your song has a private studio.',
  paragraphs: ['Your private studio is ready, with everything for your song in one place: its progress, review mixes and our conversation.'],
  button: { label: 'Open your studio', href: studioSignIn(origin) },
  note: signInNote,
  reason: 'You received this invitation for your studio project.',
});

export const studioUpdateEmail = (origin?: string) => renderEmail({
  preheader: 'A new update is ready in your private studio.',
  kicker: 'Update',
  heading: 'You have a new studio update.',
  paragraphs: ['Sign in to see the latest update on your project.'],
  button: { label: 'Open your studio', href: studioSignIn(origin) },
  note: signInNote,
  reason: 'You received this because your studio project has an update.',
});

export const studioCodeEmail = (code: string, origin?: string) => renderEmail({
  preheader: 'Your studio sign-in code.',
  kicker: 'Sign in',
  heading: 'Your code',
  paragraphs: [],
  code,
  note: 'This code expires in 10 minutes. If you didn’t ask for it, you can ignore this email.',
  link: { label: 'Open the sign-in page', href: studioSignIn(origin) },
  reason: 'You received this because you requested a studio sign-in code.',
});

export const contactReplyEmail = () => renderEmail({
  preheader: 'Your message came through.',
  kicker: 'Contact',
  heading: 'Thanks, I’ve got your message.',
  paragraphs: ['Thanks for taking the time to write. I’ll reply by email.', 'For a deeper look at my background, you can request my resume. Each request is reviewed before a copy is sent.'],
  link: { label: 'Request my resume', href: `${site}/about#resumes` },
  reason: 'You received this because you sent a message through my website.',
});

export const resumeDeliveryEmail = (name: string) => renderEmail({
  preheader: 'My resume is attached.',
  kicker: 'Resume',
  heading: 'Here’s the resume you asked for.',
  paragraphs: [`Hi ${name}, my resume is attached as a PDF.`, 'Reply to this email if anything sparks a conversation.'],
  link: { label: 'Visit my website', href: site },
  reason: 'You received this because you requested my resume.',
});

const softwareSignIn = (origin = site) => new URL('/studio/sign-in?for=software', origin).href;
export const softwareInvitationEmail = (origin?: string) => renderEmail({
  preheader: 'Your project has started.', kicker: 'Project', heading: 'Your project has started.',
  paragraphs: ['Your private project page is ready, with each update, what I need from you, and when you’ll hear from me next.'],
  button: { label: 'Open your project', href: softwareSignIn(origin) }, note: signInNote,
  reason: 'You received this invitation for your software project.',
});
export const softwareUpdateEmail = (origin?: string) => renderEmail({
  preheader: 'A new update is ready on your project page.', kicker: 'Update', heading: 'You have a new project update.',
  paragraphs: ['Sign in to see the latest update on your project.'],
  button: { label: 'Open your project', href: softwareSignIn(origin) }, note: signInNote,
  reason: 'You received this because your software project has an update.',
});
export const softwareReviewEmail = (origin?: string) => renderEmail({
  preheader: 'Something is ready for your review.', kicker: 'Review', heading: 'Ready for your review.',
  paragraphs: ['Sign in to review the latest version on your project page.'],
  button: { label: 'Open your project', href: softwareSignIn(origin) }, note: signInNote,
  reason: 'You received this because your software project has something to review.',
});
export const softwareHandoffEmail = (origin?: string) => renderEmail({
  preheader: 'Your handoff is ready.', kicker: 'Handoff', heading: 'Your handoff is ready.',
  paragraphs: ['Sign in to download the delivered files and read the handoff notes.'],
  button: { label: 'Open your project', href: softwareSignIn(origin) }, note: signInNote,
  reason: 'You received this because your software project has a handoff.',
});

export function softwareBriefEmail(name: string, brief: Record<string, string>) {
  const paragraphs = [
    `Hi ${name.trim().split(/\s+/)[0] || 'there'},`,
    "Thanks for sending this. I'll read it myself and reply within two business days with a fixed-price first milestone, or a question or two.",
    "Here's what you sent:",
    ...Object.entries(brief).map(([key, answer]) => `${softwareLabels[key as keyof typeof softwareLabels]}\n${answer}`),
    'Kazon',
    'Reply to this email if you want to add anything.',
  ];
  const { html } = renderEmail({ preheader: 'Your brief is in.', kicker: 'Software brief', heading: 'Your brief is in.', paragraphs,
    reason: 'You received this because you sent a software project brief.' });
  return { text: paragraphs.join('\n\n'), html: html.replace(/(<p style="margin:0 0 16px;)/g, '$1white-space:pre-wrap;') };
}
