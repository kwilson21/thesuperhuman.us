import { describe, expect, it } from "vitest";
import { renderEmail } from "~/lib/email-template";
import {
	contactReplyEmail,
	resumeDeliveryEmail,
	studioCodeEmail,
	studioInvitationEmail,
	studioUpdateEmail,
} from "~/lib/client-emails";

describe("renderEmail", () => {
	it("escapes every value it places into the HTML", () => {
		const { html, text } = renderEmail({
			preheader: "<p>",
			kicker: "A&B",
			heading: '"Hi"',
			paragraphs: ["<script>alert(1)</script>"],
			button: { label: "Go", href: 'https://example.com/?a=1&b="2"' },
			reason: "Because <you>",
		});

		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).toContain(
			'href="https://example.com/?a=1&amp;b=&quot;2&quot;"',
		);
		expect(html).toContain("A&amp;B");
		expect(html).toContain("<title>&quot;Hi&quot;</title>");
		expect(html).toContain(">&lt;p&gt;</div>");
		expect(text).toContain("<script>alert(1)</script>");
	});

	it("groups a sign-in code into two blocks of four in both versions", () => {
		const { html, text } = studioCodeEmail("48271936");
		expect(html).toContain("4827 1936");
		expect(text).toContain("4827 1936");
		expect(text).toContain("expires in 10 minutes");
		expect(text).toContain("Enter it in the browser where you asked for it.");
	});

	it("carries no link or address to a page in the sign-in code email", () => {
		const { html, text } = studioCodeEmail("48271936");

		expect(html).not.toMatch(/<a\s/i);
		expect(html).not.toContain("Open the sign-in page");
		expect(text).not.toMatch(/https?:|www\./i);
		expect(text).not.toContain("Open the sign-in page");

		// The only address left in the HTML is the shared template's font stylesheet and the XML namespaces, none of them a page of the site.
		const addresses = [...html.matchAll(/https?:\/\/[^"'\s)<]+/g)].map(
			(match) => new URL(match[0]).hostname,
		);

		for (const host of addresses)
			expect(["fonts.googleapis.com", "www.w3.org"]).toContain(host);
		expect(html).not.toContain("thesuperhuman.us");
		expect(text).toContain("4827 1936");
		expect(text).toContain("expires in 10 minutes");
		expect(text).toContain("Enter it in the browser where you asked for it.");
	});

	it("keeps Outlook-safe markup: longhand fonts, padded button cell, fixed-width frame, hidden preheader", () => {
		const { html } = studioInvitationEmail();
		expect(html).toContain(
			'<img src="https://thesuperhuman.us/apple-touch-icon.png" width="40" height="40" alt=""',
		);
		expect(html).toContain("Kazon Wilson</td>");
		expect(html).not.toMatch(/font:\s*\d/);
		// The whole button is clickable (padding on the link), and Outlook pads the cell instead.
		expect(html).toMatch(
			/<td style="[^"]*mso-padding-alt:14px 28px;"><a href="https:\/\/thesuperhuman.us\/studio\/sign-in" style="display:inline-block;padding:14px 28px;/,
		);
		expect(html).toContain(
			'<!--[if mso]><table role="presentation" width="600"',
		);
		expect(html).toContain("mso-hide:all");
		expect(html).toContain(
			'<!--[if !mso]><!--><link href="https://fonts.googleapis.com',
		);
	});

	it("gives every client email a heading, a reason and a plain-text twin without em-dashes", () => {
		for (const email of [
			studioInvitationEmail(),
			studioUpdateEmail(),
			studioCodeEmail("12345678"),
			contactReplyEmail(),
			resumeDeliveryEmail("Jane"),
		]) {
			expect(email.html).toMatch(/^<!doctype html>/);
			expect(email.html).toContain("The Superhuman Group LLC");
			expect(email.text).toContain("You received this");
			expect(email.html + email.text).not.toContain("—");
		}

		expect(resumeDeliveryEmail("Jane <x>").html).toContain("Hi Jane &lt;x&gt;");
	});
});

// Sandbox mail must not send clients into the production studio.
it("uses the configured origin for every studio email", () => {
	const origin = "https://test.example.com";

	for (const email of [
		studioInvitationEmail(origin),
		studioUpdateEmail(origin),
		studioCodeEmail("12345678", origin),
	]) {
		expect(email.text).toContain(`${origin}/studio/sign-in`);
		expect(email.html).toContain(`${origin}/studio/sign-in`);
		expect(email.text).not.toContain("https://thesuperhuman.us/studio");
	}
});
