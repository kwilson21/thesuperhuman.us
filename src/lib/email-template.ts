/**
 * The site's transactional email design: paper background, serif headings, one rust action.
 * Every email is sent as HTML with a plain-text twin, so clients that block HTML still read it.
 * Inline styles and a single-column table keep it intact in Gmail, Outlook and Apple Mail.
 */
export type EmailContent = {
  /** Inbox preview line. */
  preheader: string;
  kicker: string;
  heading: string;
  paragraphs: string[];
  /** A large, spaced-out code shown in a pale box. */
  code?: string;
  button?: { label: string; href: string };
  /** A quiet text link below the body. */
  link?: { label: string; href: string };
  /** Small print under the action. */
  note?: string;
  /** Why the reader received this email. */
  reason: string;
};

const colors = { paper: '#FBF8F2', card: '#FFFDF9', ink: '#0E0E0E', muted: '#4A4A4A', rule: '#E8E3DA', accent: '#AE5534', codeBox: '#F1ECE3' };
const serif = "Newsreader, Georgia, 'Times New Roman', serif";
const sans = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Groups an 8-digit code as "1234 5678" so it is easy to read and type. */
const spacedCode = (code: string) => code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const e = escapeHtml;
  const paragraphs = content.paragraphs.map(text =>
    `<p style="margin:0 0 16px;font:400 16px/1.6 ${sans};color:${colors.muted};">${e(text)}</p>`).join('');
  const code = content.code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>
    <td align="center" style="background:${colors.codeBox};padding:22px 12px;font:500 34px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:4px;color:${colors.ink};">${e(spacedCode(content.code))}</td></tr></table>` : '';
  const button = content.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>
    <td style="background:${colors.accent};border-radius:2px;"><a href="${e(content.button.href)}" style="display:inline-block;padding:14px 28px;font:500 16px/1 ${sans};color:#FFFFFF;text-decoration:none;">${e(content.button.label)}</a></td></tr></table>` : '';
  const link = content.link ? `<p style="margin:4px 0 20px;"><a href="${e(content.link.href)}" style="font:400 16px/1.5 ${sans};color:${colors.accent};text-decoration:underline;">${e(content.link.label)}</a></p>` : '';
  const note = content.note ? `<p style="margin:0 0 8px;font:400 13px/1.5 ${sans};color:${colors.muted};">${e(content.note)}</p>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${e(content.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Newsreader:opsz@6..72&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${colors.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.paper};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${colors.card};border:1px solid ${colors.rule};">
<tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${colors.rule};font:400 20px/1.2 ${serif};color:${colors.ink};">Kazon Wilson</td></tr>
<tr><td style="padding:32px 32px 24px;">
<p style="margin:0 0 16px;font:600 12px/1.4 ${sans};letter-spacing:2px;text-transform:uppercase;color:${colors.accent};">${e(content.kicker)}</p>
<h1 style="margin:0 0 20px;font:400 34px/1.2 ${serif};color:${colors.ink};">${e(content.heading)}</h1>
${paragraphs}${code}${content.code ? note : ''}${button}${link}${content.code ? '' : note}
</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid ${colors.rule};">
<p style="margin:0 0 6px;font:400 12px/1.5 ${sans};color:${colors.ink};">The Superhuman Group LLC</p>
<p style="margin:0;font:400 12px/1.5 ${sans};color:${colors.muted};">${e(content.reason)}</p>
</td></tr></table></td></tr></table>
</body></html>`;
  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap(paragraph => [paragraph, '']),
    ...(content.code ? [spacedCode(content.code), ''] : []),
    // A code's expiry belongs right under it; otherwise the note follows the action.
    ...(content.code && content.note ? [content.note, ''] : []),
    ...(content.button ? [`${content.button.label}: ${content.button.href}`, ''] : []),
    ...(content.link ? [`${content.link.label}: ${content.link.href}`, ''] : []),
    ...(!content.code && content.note ? [content.note, ''] : []),
    'Kazon',
    '',
    '--',
    'The Superhuman Group LLC',
    content.reason,
  ].join('\n');
  return { html, text };
}
