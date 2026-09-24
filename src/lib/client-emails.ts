import { renderEmail } from './email-template';

const site = 'https://thesuperhuman.us';
const studioSignIn = `${site}/studio/sign-in`;
// Studio emails carry no project details: the client signs in to see them.
const signInNote = 'Sign in with this email address. You’ll get a one-time code to finish.';

export const studioInvitationEmail = () => renderEmail({
  preheader: 'Your private studio is ready.',
  kicker: 'Studio',
  heading: 'Your song has a private studio.',
  paragraphs: ['Your private studio is ready, with everything for your song in one place: its progress, review mixes and our conversation.'],
  button: { label: 'Open your studio', href: studioSignIn },
  note: signInNote,
  reason: 'You received this invitation for your studio project.',
});

export const studioUpdateEmail = () => renderEmail({
  preheader: 'There’s an update in your private studio.',
  kicker: 'Update',
  heading: 'There’s something new on your song.',
  paragraphs: ['Your studio has an update. Sign in to see it.'],
  button: { label: 'Open your studio', href: studioSignIn },
  note: signInNote,
  reason: 'You received this because your studio project has an update.',
});

export const studioCodeEmail = (code: string) => renderEmail({
  preheader: 'Your studio sign-in code.',
  kicker: 'Sign in',
  heading: 'Your code',
  paragraphs: [],
  code,
  note: 'This code expires in 10 minutes. If you didn’t ask for it, you can ignore this email.',
  link: { label: 'Open the sign-in page', href: studioSignIn },
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
