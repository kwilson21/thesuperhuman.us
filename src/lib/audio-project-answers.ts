// The fixed answers of the audio project routes that are not a refusal's own `say` (the rule files hold those): the answer
// that hides a project, the bare conflict, the sentences of an unavailable or failed route, and the portal being off. A
// route passes the one for a failure as `answer` to `runRoute`, beside `musicRequest` in src/lib/music-request.ts.

/** The portal is off. */
export const portalOff = () => new Response("Not found", { status: 404 });

/** The project cannot be shown, or the route has no project to name: nothing says which. */
export const projectHidden = () =>
	Response.json({ ok: false }, { status: 404 });

/** The client has no session cookie, or the route has no project id. */
export const noStudioSession = () =>
	Response.json({ ok: false }, { status: 401 });

/** The project cannot take the write now, and no sentence says why. */
export const writeNotAccepted = () =>
	Response.json({ ok: false }, { status: 409 });

/** A body that is not one of the route's commands. */
export const checkYourMessage = () =>
	Response.json(
		{ ok: false, error: "Check your message and try again." },
		{ status: 400 },
	);

/** A refusal that carries its own sentence, with the status the route gives it. */
export const sentence = (say: string, status: number) =>
	Response.json({ ok: false, error: say }, { status });

/** The owner's message route has no database on this deployment: a deliberate 503. */
export const ownerMessagesUnavailable = () =>
	Response.json(
		{ ok: false, error: "Project messages are temporarily unavailable." },
		{ status: 503 },
	);

/** The client's message route has no database on this deployment: a deliberate 503. */
export const studioMessagesUnavailable = () =>
	Response.json(
		{ ok: false, error: "Studio messages are temporarily unavailable." },
		{ status: 503 },
	);

/** The message could not be saved: a failure of the database, or a defect. 500, logged once by the route. */
export const messageNotSaved = () =>
	Response.json(
		{
			ok: false,
			error: "Your message could not be saved. Please try again.",
		},
		{ status: 500 },
	);
