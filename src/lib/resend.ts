import type { ContactInput } from "../server/contact-input";
import type { MailMessage } from "../server/services";
import type { StoredResumeRequest } from "./resume-requests";
import { contactReplyEmail, resumeDeliveryEmail } from "./client-emails";

const ENDPOINT = "https://api.resend.com/emails";

interface Attachment {
	filename: string;
	content: string; // base64
}

type ResendPayload = {
	from: string;
	to: string[];
	subject: string;
	text: string;
	html?: string;
	reply_to?: string;
	attachments?: Attachment[];
};

function primaryBody(input: ContactInput): string {
	return [
		`Name: ${input.name}`,
		`Email: ${input.email}`,
		input.company ? `Company: ${input.company}` : null,
		"",
		"Message:",
		input.description,
	]
		.filter(Boolean)
		.join("\n");
}

function payloadOf(message: MailMessage): ResendPayload {
	const payload: ResendPayload = {
		from: message.from,
		to: [...message.to],
		subject: message.subject,
		text: message.text,
	};

	if (message.html) payload.html = message.html;

	if (message.reply_to) payload.reply_to = message.reply_to;

	if (message.attachments && message.attachments.length > 0) {
		payload.attachments = message.attachments.map((a) => ({ ...a }));
	}

	return payload;
}

/** What Resend answered: it sent the email, it refused (a status below 500), or it may not have (5xx, or no answer). */
export type MailOutcome = "sent" | "refused" | "uncertain";

/**
 * Sends one email. A message that carries an `idempotencyKey` sends it as the Idempotency-Key header, as
 * sendAudioMessage does; no route in this area sets one.
 */
export async function sendMail(
	apiKey: string,
	message: MailMessage,
): Promise<MailOutcome> {
	const baseHeaders = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};

	let res: Response;

	try {
		res = await fetch(ENDPOINT, {
			method: "POST",
			headers: message.idempotencyKey
				? { ...baseHeaders, "Idempotency-Key": message.idempotencyKey }
				: baseHeaders,
			body: JSON.stringify(payloadOf(message)),
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		return "uncertain";
	}

	if (res.ok) return "sent";

	return res.status >= 500 ? "uncertain" : "refused";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";

	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}

	return btoa(binary);
}

/** The email to the owner with what the visitor wrote, replies going to the visitor. */
export function contactOwnerMessage(args: {
	input: ContactInput;
	from: string;
	to: string;
}): MailMessage {
	return {
		from: args.from,
		to: [args.to],
		subject: `New message from ${args.input.name}`,
		text: primaryBody(args.input),
		reply_to: args.input.email,
	};
}

/** The autoresponder to the visitor. */
export function contactReplyMessage(args: {
	input: ContactInput;
	from: string;
}): MailMessage {
	return {
		from: args.from,
		to: [args.input.email],
		subject: "Thanks for reaching out (Kazon Wilson)",
		...contactReplyEmail(),
	};
}

function approvalNotificationBody(
	req: StoredResumeRequest,
	approvalUrl: string,
): string {
	return [
		`Name: ${req.name}`,
		`Email: ${req.email}`,
		req.company ? `Company: ${req.company}` : null,
		`Audience: ${req.audience}`,
		req.note ? "" : null,
		req.note ? "Note:" : null,
		req.note ? req.note : null,
		"",
		"Approve and send the resume by clicking this link (single-use, expires in 7 days):",
		approvalUrl,
		"",
		"To deny: simply ignore this email. The request will expire on its own.",
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

/** The email to the owner with the approval link. */
export function resumeApprovalMessage(args: {
	request: StoredResumeRequest;
	from: string;
	to: string;
	approvalUrl: string;
}): MailMessage {
	return {
		from: args.from,
		to: [args.to],
		subject: `Resume request from ${args.request.name}: ${args.request.audience}`,
		text: approvalNotificationBody(args.request, args.approvalUrl),
		reply_to: args.request.email,
	};
}

/** The email to the person who asked, with the resume attached. */
export function resumeDeliveryMessage(args: {
	from: string;
	to: string;
	name: string;
	pdf: ArrayBuffer;
	filename: string;
}): MailMessage {
	return {
		from: args.from,
		to: [args.to],
		subject: "Your requested resume (Kazon Wilson)",
		...resumeDeliveryEmail(args.name),
		attachments: [
			{
				filename: args.filename,
				content: arrayBufferToBase64(args.pdf),
			},
		],
	};
}
