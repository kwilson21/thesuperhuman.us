/**
 * The lines on the Get in touch switchboard (/contact). Each line opens the form that fits:
 * the message form on the same page, the resume request on About, the song intake, or the
 * project brief with its path already chosen, so a visitor never picks twice. Server-side only:
 * the page renders these into links, and the switchboard script reads the links.
 */
export interface ContactLine {
	id: "message" | "resume" | "song" | "website" | "webapp" | "workflow";
	title: string;
	line: string;
	/** A main-site path, or with `audio`, an Audio path (mounted at /audio on the main host). */
	path: string;
	audio?: boolean;
	/** What the board says while it puts the visitor through. */
	connecting: string;
}

export const contactLines: ContactLine[] = [
	{
		id: "message",
		title: "Send a message",
		line: "An idea, an opportunity or a conversation worth having. Write to me here.",
		path: "/contact#message",
		connecting: "Connected. The message form is open below.",
	},
	{
		id: "resume",
		title: "Request my resume",
		line: "Hiring for a role? I review each request before the PDF is emailed.",
		path: "/about#resumes",
		connecting: "Putting you through to the resume request…",
	},
	{
		id: "song",
		title: "Start your song",
		line: "Send vocals and a beat for mixing, or a finished mix for mastering.",
		path: "/start",
		audio: true,
		connecting: "Putting you through to the song intake…",
	},
	{
		id: "website",
		title: "Plan your website",
		line: "I plan, design and build a site that works on phones and computers.",
		path: "/software/start?path=website",
		connecting: "Putting you through to the website brief…",
	},
	{
		id: "webapp",
		title: "Plan your web app",
		line: "I build an app people open in a browser, on a phone or a computer.",
		path: "/software/start?path=webapp",
		connecting: "Putting you through to the web app brief…",
	},
	{
		id: "workflow",
		title: "Automate a workflow",
		line: "I build a tool that takes manual steps out of a task your team repeats.",
		path: "/software/start?path=workflow",
		connecting: "Putting you through to the workflow brief…",
	},
];
