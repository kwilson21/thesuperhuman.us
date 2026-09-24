import { describe, expect, it } from 'vitest';
import { renderEmail } from '~/lib/email-template';
import { contactReplyEmail, resumeDeliveryEmail, studioCodeEmail, studioInvitationEmail, studioUpdateEmail } from '~/lib/client-emails';

describe('renderEmail', () => {
  it('escapes every value it places into the HTML', () => {
    const { html, text } = renderEmail({ preheader: '<p>', kicker: 'A&B', heading: '"Hi"', paragraphs: ['<script>alert(1)</script>'],
      button: { label: 'Go', href: 'https://example.com/?a=1&b="2"' }, reason: 'Because <you>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain('A&amp;B');
    expect(text).toContain('<script>alert(1)</script>');
  });

  it('groups a sign-in code for reading and keeps it whole in the plain text', () => {
    const { html, text } = studioCodeEmail('48271936');
    expect(html).toContain('4827 1936');
    expect(text).toContain('4827 1936');
    expect(text).toContain('expires in 10 minutes');
  });

  it('gives every client email a heading, a reason and a plain-text twin without em-dashes', () => {
    for (const email of [studioInvitationEmail(), studioUpdateEmail(), studioCodeEmail('12345678'), contactReplyEmail(), resumeDeliveryEmail('Jane')]) {
      expect(email.html).toMatch(/^<!doctype html>/);
      expect(email.html).toContain('The Superhuman Group LLC');
      expect(email.text).toContain('You received this');
      expect(email.html + email.text).not.toContain('—');
    }
    expect(resumeDeliveryEmail('Jane <x>').html).toContain('Hi Jane &lt;x&gt;');
  });
});
