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

// ---- the uploads route ----

/** The caller is not the owner. */
export const ownerAccessRequired = () =>
	Response.json(
		{ ok: false, error: "Owner access required." },
		{ status: 403 },
	);

/** The portal is off. The uploads route answers with a sentence and JSON, not the plain text of the other routes. */
export const uploadsPortalOff = () =>
	Response.json({ ok: false, error: "Not found." }, { status: 404 });

/** The route has no project id or no database or bucket on this deployment: a deliberate 503. */
export const uploadsUnavailable = () =>
	Response.json(
		{ ok: false, error: "Private uploads are unavailable." },
		{ status: 503 },
	);

/** A body that is not one of the uploads route's commands. */
export const checkFileDetails = () =>
	Response.json(
		{ ok: false, error: "Check the file details and try again." },
		{ status: 400 },
	);

/** A query or a body that is not one part of an upload. */
export const invalidFilePart = () =>
	Response.json({ ok: false, error: "Invalid file part." }, { status: 400 });

const UPLOAD_NOT_SAVED = "The upload could not be saved. Please try again.";

/** The upload could not be saved: a failure of the database or R2, or a defect. 500, logged once by the route. */
export const uploadNotSaved = () =>
	Response.json({ ok: false, error: UPLOAD_NOT_SAVED }, { status: 500 });

/** R2 is unavailable, or too busy for the completion: a known temporary outage. 503, not logged. */
export const uploadSaveUnavailable = () =>
	Response.json({ ok: false, error: UPLOAD_NOT_SAVED }, { status: 503 });

const PART_NOT_UPLOADED = "This part could not be uploaded. Please try again.";

/** The part could not be put: a failure of the database or R2, or a defect. 500, logged once by the route. */
export const partNotUploaded = () =>
	Response.json({ ok: false, error: PART_NOT_UPLOADED }, { status: 500 });

/** R2 is unavailable for the part: a known temporary outage. 503, not logged. */
export const partUploadUnavailable = () =>
	Response.json({ ok: false, error: PART_NOT_UPLOADED }, { status: 503 });

// ---- the owner's file route ----

/** The route has no database or no execution context, or the publish has no bucket: a deliberate 503. */
export const filePublicationUnavailable = () =>
	Response.json(
		{ ok: false, error: "File publication is temporarily unavailable." },
		{ status: 503 },
	);

/** A body that is not one of the file route's commands. */
export const checkFileAction = () =>
	Response.json(
		{ ok: false, error: "Check the file action and try again." },
		{ status: 400 },
	);

const FILE_NOT_PUBLISHED = "The file could not be published. Please try again.";

/** The file action could not be saved: a failure of the database or R2, or a defect. 500, logged once by the route. The revoke path says the same sentence. */
export const fileNotPublished = () =>
	Response.json({ ok: false, error: FILE_NOT_PUBLISHED }, { status: 500 });

/** R2 is unavailable for the publish: a known temporary outage. 503, not logged. */
export const filePublishUnavailable = () =>
	Response.json({ ok: false, error: FILE_NOT_PUBLISHED }, { status: 503 });

// ---- the studio's file route ----

const PRIVATE = { "cache-control": "private, no-store" };

/** The client cannot be shown the file, or the route has none to name. */
export const fileHidden = () =>
	new Response("File not found", { status: 404, headers: PRIVATE });

/** The route has no database or bucket on this deployment: a deliberate 503. */
export const privateAudioUnavailable = () =>
	new Response("Private audio is temporarily unavailable", {
		status: 503,
		headers: PRIVATE,
	});

/** The read failed: a failure of the database or R2, or a defect. 500, logged once by the route. */
export const privateAudioFailed = () =>
	new Response("Private audio is temporarily unavailable", {
		status: 500,
		headers: PRIVATE,
	});

/** The bucket has no object for the file. */
export const fileUnavailable = () =>
	new Response("File unavailable", { status: 404, headers: PRIVATE });

/** The bucket's object is another size than the row says: a stored state that disagrees with R2, not an unavailable service. */
export const fileSizeDiffers = () =>
	new Response("File unavailable", { status: 500, headers: PRIVATE });

type ClientFile = {
	readonly version: "review" | "final";
	readonly media_type: "audio/mpeg" | "audio/wav";
};

const clientFileHeaders = (file: ClientFile, download: boolean) =>
	new Headers({
		"cache-control": "private, no-store",
		vary: "Cookie",
		"x-content-type-options": "nosniff",
		"cross-origin-resource-policy": "same-origin",
		"content-type": file.media_type,
		"accept-ranges": "bytes",
		"content-disposition": download
			? `attachment; filename="project-${file.version}.${file.media_type === "audio/mpeg" ? "mp3" : "wav"}"`
			: "inline",
	});

/** The Range header names bytes the file does not have. */
export const fileRangeRefused = (
	file: ClientFile,
	download: boolean,
	size: number,
) => {
	const headers = clientFileHeaders(file, download);
	headers.set("content-range", `bytes */${size}`);

	return new Response(null, { status: 416, headers });
};

/** The file's bytes, or the part of them a Range header named; HEAD answers the headers alone. */
export const projectFileBytes = (
	read: {
		readonly file: ClientFile;
		readonly size: number;
		readonly slice: { readonly offset: number; readonly length: number } | null;
		readonly body: ReadableStream | null;
	},
	download: boolean,
) => {
	const headers = clientFileHeaders(read.file, download);
	headers.set("content-length", String(read.slice?.length ?? read.size));

	if (read.slice)
		headers.set(
			"content-range",
			`bytes ${read.slice.offset}-${read.slice.offset + read.slice.length - 1}/${read.size}`,
		);

	if (read.body === null) return new Response(null, { headers });

	return new Response(read.body, {
		status: read.slice ? 206 : 200,
		headers,
	});
};
