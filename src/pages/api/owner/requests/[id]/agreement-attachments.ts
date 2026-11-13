import type { APIRoute } from "astro";
import { readAttachmentQuery } from "~/lib/agreement-owner-input";
import { readBodyWithin } from "~/lib/audio-project-uploads";
import { hashBytes } from "~/lib/agreement-artifacts";
import {
	agreementJson,
	agreementHeaders,
	signingEnabled,
} from "~/lib/agreement-access";
import { softwareGuard } from "~/lib/software-projects";

export const prerender = false;

export const PUT: APIRoute = async ({ locals, request, params, url }) => {
	const env = locals.runtime.env,
		db = env.MUSIC_DB;

	if (!locals.owner) return agreementJson({ ok: false }, 403);

	if (!db || !env.AUDIO) return agreementJson({ ok: false }, 503);

	if (request.headers.get("origin") !== url.origin)
		return agreementJson({ ok: false }, 403);

	if (!(await signingEnabled(db))) return agreementJson({ ok: false }, 404);

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

	try {
		const { PDFDocument } = await import("pdf-lib");
		const pdf = await PDFDocument.load(bytes);

		if (!pdf.getPageCount())
			return agreementJson({ ok: false, error: "The PDF has no pages." }, 400);
	} catch {
		return agreementJson(
			{
				ok: false,
				error:
					"The PDF could not be validated. Use a supported PDF or sign outside the website.",
			},
			503,
		);
	}

	const id = crypto.randomUUID(),
		key = `agreements/attachments/${id}.pdf`,
		sha256 = await hashBytes(bytes),
		at = new Date().toISOString();

	try {
		await env.AUDIO.put(key, bytes, {
			httpMetadata: { contentType: "application/pdf" },
			customMetadata: { sha256 },
		});
		await db.batch([
			softwareGuard(
				db,
				"SELECT 1 FROM owner_requests WHERE id=? AND kind='software' AND status NOT IN ('withdrawn','resolved')",
				[params.id!],
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
	} catch {
		try {
			const saved = await db
				.prepare("SELECT 1 FROM software_agreement_attachments WHERE id=?")
				.bind(id)
				.first();

			if (!saved) await env.AUDIO.delete(key);
		} catch {
			// Preserve an object if the write outcome cannot be established.
		}

		return agreementJson(
			{ ok: false, error: "The attachment could not be saved." },
			503,
		);
	}
};

export const GET: APIRoute = async ({ locals, params, url }) => {
	const env = locals.runtime.env;

	if (!locals.owner) return new Response("Forbidden", { status: 403 });

	const row = await env.MUSIC_DB?.prepare(
		"SELECT object_key FROM software_agreement_attachments WHERE id=? AND request_id=?",
	)
		.bind(url.searchParams.get("attachment"), params.id)
		.first<{ object_key: string }>();

	if (!row) return new Response("Not found", { status: 404 });
	const object = await env.AUDIO.get(row.object_key);

	return object
		? new Response(object.body, {
				headers: {
					...agreementHeaders,
					"content-type": "application/pdf",
					"content-disposition":
						'attachment; filename="agreement-attachment.pdf"',
					"x-content-type-options": "nosniff",
				},
			})
		: new Response("Unavailable", { status: 503 });
};
