import type { APIRoute } from "astro";
import { readAttachmentQuery } from "~/lib/agreement-owner-input";
import { readBodyWithin } from "~/lib/audio-project-uploads";
import { hashBytes } from "~/lib/agreement-artifacts";
import { agreementJson, signingEnabled } from "~/lib/agreement-access";
import { agreementHeaders } from "~/lib/agreement-host";
import { softwareGuard } from "~/lib/software-guard";
import { logUnexpected } from "~/server/failure";
import { raisedByJsonGuard } from "~/server/guarded-save";

export const prerender = false;

const notSaved = "The attachment could not be saved.";

/** A failure on the site's side: logged once, never shown, and answered with the upload's fixed 500 (B1, B2). */
function uploadFailed<Failure>(failure: Failure) {
	logUnexpected("Owner attachment upload", failure);

	return agreementJson({ ok: false, error: notSaved }, 500);
}

/**
 * An upload whose batch guard raised: the request is unknown, not a software request, or withdrawn or resolved. It is a
 * refusal, not an unavailable dependency (B4): 404 for a request that is unknown or not software, otherwise 409. The
 * request is read only after the guard raised, as abandon reads the deposits again after its refused batch, so an upload
 * that is accepted reads nothing more.
 */
async function refusedUpload(db: D1Database, requestId: string) {
	try {
		const owned = await db
			.prepare("SELECT kind FROM owner_requests WHERE id=?")
			.bind(requestId)
			.first<{ kind: string }>();

		return owned?.kind === "software"
			? agreementJson({ ok: false, error: notSaved }, 409)
			: agreementJson({ ok: false }, 404);
	} catch (error) {
		return uploadFailed(error);
	}
}

export const PUT: APIRoute = async ({ locals, request, params, url }) => {
	const env = locals.runtime.env,
		db = env.MUSIC_DB;

	if (!locals.owner) return agreementJson({ ok: false }, 403);

	if (!db || !env.AUDIO) return agreementJson({ ok: false }, 503);

	if (request.headers.get("origin") !== url.origin)
		return agreementJson({ ok: false }, 403);

	let enabled: boolean;

	try {
		enabled = await signingEnabled(db);
	} catch (error) {
		return uploadFailed(error);
	}

	if (!enabled) return agreementJson({ ok: false }, 404);

	const parsed = readAttachmentQuery(Object.fromEntries(url.searchParams));

	if (
		!parsed.ok ||
		request.headers.get("content-type") !== "application/pdf" ||
		!request.body
	)
		return agreementJson(
			{ ok: false, error: "Choose a PDF, version and date." },
			400,
		);
	const bytes = await readBodyWithin(request.body, 10 * 1024 * 1024);

	if (!bytes)
		return agreementJson(
			{ ok: false, error: "Keep each PDF under 10 MiB." },
			413,
		);

	if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
		return agreementJson({ ok: false, error: "The file must be a PDF." }, 400);

	const unreadable = (status: 400 | 503) =>
		agreementJson(
			{
				ok: false,
				error:
					"The PDF could not be validated. Use a supported PDF or sign outside the website.",
			},
			status,
		);

	// pdf-lib that cannot be loaded is an unavailable dependency (503); bytes it cannot read are bad input (400, B4).
	let pdfLib: typeof import("pdf-lib");

	try {
		pdfLib = await import("pdf-lib");
	} catch {
		return unreadable(503);
	}

	try {
		const pdf = await pdfLib.PDFDocument.load(bytes);

		if (!pdf.getPageCount())
			return agreementJson({ ok: false, error: "The PDF has no pages." }, 400);
	} catch {
		return unreadable(400);
	}

	const id = crypto.randomUUID(),
		key = `agreements/attachments/${id}.pdf`,
		sha256 = await hashBytes(bytes),
		at = new Date().toISOString();

	/** After any refusal or failure past the put: the object is deleted unless its row was saved, as before. */
	const removeObject = async () => {
		try {
			const saved = await db
				.prepare("SELECT 1 FROM software_agreement_attachments WHERE id=?")
				.bind(id)
				.first();

			if (!saved) await env.AUDIO.delete(key);
		} catch {
			// Preserve an object if the write outcome cannot be established.
		}
	};

	try {
		await env.AUDIO.put(key, bytes, {
			httpMetadata: { contentType: "application/pdf" },
			customMetadata: { sha256 },
		});
	} catch (error) {
		await removeObject();

		return uploadFailed(error);
	}

	// A missing or empty id matches no request, as an unknown one does (B3, as offers F6 decided): the object is put and
	// then deleted, as for an unknown request.
	if (!params.id) {
		await removeObject();

		return agreementJson({ ok: false }, 404);
	}

	try {
		await db.batch([
			softwareGuard(
				db,
				"SELECT 1 FROM owner_requests WHERE id=? AND kind='software' AND status NOT IN ('withdrawn','resolved')",
				[params.id],
			),
			db
				.prepare(
					"INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					id,
					params.id,
					parsed.value.filename,
					parsed.value.version,
					parsed.value.date,
					key,
					sha256,
					bytes.byteLength,
					at,
					locals.owner.email,
				),
		]);
	} catch (error) {
		await removeObject();

		if (error instanceof Error && raisedByJsonGuard(error))
			return refusedUpload(db, params.id);

		return uploadFailed(error);
	}

	return agreementJson({
		ok: true,
		attachment: {
			filename: parsed.value.filename,
			version: parsed.value.version,
			date: parsed.value.date,
			sha256,
			key,
			bytes: bytes.byteLength,
		},
	});
};

/** A failure on the site's side: logged once, never shown, and answered with the download's fixed 500 (B2, B8). */
function downloadFailed<Failure>(failure: Failure) {
	logUnexpected("Owner attachment", failure);

	return new Response("Unavailable", { status: 500 });
}

export const GET: APIRoute = async ({ locals, params, url }) => {
	const env = locals.runtime.env,
		db = env.MUSIC_DB;

	if (!locals.owner) return new Response("Forbidden", { status: 403 });

	// A missing binding is a known unavailable dependency, answered before any read (B3).
	if (!db || !env.AUDIO) return new Response("Unavailable", { status: 503 });

	let object: R2ObjectBody | null;

	try {
		const row = await db
			.prepare(
				"SELECT object_key FROM software_agreement_attachments WHERE id=? AND request_id=?",
			)
			.bind(url.searchParams.get("attachment"), params.id)
			.first<{ object_key: string }>();

		if (!row) return new Response("Not found", { status: 404 });
		object = await env.AUDIO.get(row.object_key);
	} catch (error) {
		return downloadFailed(error);
	}

	// The owner knows the row exists, so an object that is gone is an unexpected store state, not a 404 (B8, J1).
	if (!object)
		return downloadFailed(new Error("The attachment's object is missing."));

	return new Response(object.body, {
		headers: {
			...agreementHeaders,
			"content-type": "application/pdf",
			"content-disposition": 'attachment; filename="agreement-attachment.pdf"',
			"x-content-type-options": "nosniff",
		},
	});
};
