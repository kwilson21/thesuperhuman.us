import type { APIRoute } from "astro";
import { agreementRequest } from "~/lib/agreement-request";
import {
  agreementSession,
  agreementJson,
  signingEnabled,
} from "~/lib/agreement-access";
import { getLinkedOffer } from "~/lib/software-offers";
import { draftSchema, draftFieldErrors, saveAgreementDraft } from "~/lib/agreement-draft";
export const prerender = false;
export const POST: APIRoute = async ({ request, locals, params }) => {
  const db = locals.runtime.env.MUSIC_DB;
  const body = await agreementRequest(request);
  if (body instanceof Response) return body;
  const offer =
    db && params.token ? await getLinkedOffer(db, params.token) : null;
  const session =
    db && offer
      ? await agreementSession(db, request, "agreement", offer.id)
      : null;
  if (!db || !offer || !session || !(await signingEnabled(db)))
    return agreementJson(
      {
        ok: false,
        error:
          "Open a fresh email link to keep going. Your saved details will be here.",
      },
      401,
    );
  const input = body as { csrf_nonce?: unknown; values?: unknown };
  if (input.csrf_nonce !== session.csrf_nonce)
    return agreementJson({ ok: false, error: "Reload and try again." }, 403);
  const parsed = draftSchema.safeParse(input.values);
  if (!parsed.success)
    return agreementJson({ ok: false, error: "Check the highlighted details.", errors: draftFieldErrors(parsed.error.issues) }, 400);
  try {
    await saveAgreementDraft(db, offer, session, parsed.data);
    return agreementJson({ ok: true });
  } catch {
    return agreementJson(
      {
        ok: false,
        error:
          "Your details could not be saved. Check the fields and try again.",
      },
      409,
    );
  }
};
