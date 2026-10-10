import { consentText } from "~/lib/agreement-fields";
import { resolveClientDetails } from "~/lib/agreement-draft";
export function setupAgreementAccess() {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-document-link], a[href="#executed-agreement"]')) {
    link.addEventListener('click', (event) => {
      const target = document.querySelector<HTMLElement>(link.hash);
      const reader = document.querySelector<HTMLDetailsElement>('[data-agreed-terms]');
      if (link.hasAttribute('data-document-link') && reader) {
        event.preventDefault();
        reader.open = true;
        reader.querySelector<HTMLButtonElement>('[data-terms-stage-button="3"]')?.click();
        target?.scrollIntoView({block:'start'});
      } else if (target instanceof HTMLDetailsElement) target.open = true;
    });
  }

  for (const form of document.querySelectorAll<HTMLFormElement>(
    "[data-agreement-link]",
  )) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form),
        button = form.querySelector<HTMLButtonElement>("button")!;
      const status = document.querySelector<HTMLElement>('[role="status"]');
      button.disabled = true;
      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: data.get("email") ?? undefined,
            turnstileToken:
              data.get("cf-turnstile-response") || data.get("turnstileToken"),
          }),
        });
        const result = (await response.json()) as {
          error: string;
          errors?: Record<string, string>;
          documents: { id: string; kind: string; hash: string; text: string }[];
        };
        if (!response.ok) throw new Error(result.error);
        location.href =
          form.dataset.afterLink ?? location.pathname + "?email=sent";
      } catch (error) {
        if (status) status.textContent = (error as Error).message;
      } finally {
        button.disabled = false;
      }
    });
  }
  const form = document.querySelector<HTMLFormElement>("[data-signing-page]");
  if (!form) return;
  const root = form,
    token = form.dataset.token!,
    csrf = form.querySelector<HTMLInputElement>('[name="csrf_nonce"]')!;
  const status = form.querySelector<HTMLElement>('[role="status"]')!,
    summary = document.querySelector<HTMLElement>("[data-signing-errors]")!;
  const documentInput =
    form.querySelector<HTMLInputElement>('[name="documents"]')!;
  const signButton =
    form.querySelector<HTMLButtonElement>("[data-sign-button]")!;
  let revision = 0,
    timer: ReturnType<typeof setTimeout>,
    queue = Promise.resolve(),
    reviewedRevision = -1,
    showErrors = false;
  const values = () =>
    Object.fromEntries(
      [...new FormData(root)].filter(
        ([key]) => !["csrf_nonce", "documents", "consent"].includes(key),
      ),
    );
  const email = form.dataset.email!;
  function errors(fields: Record<string, string>) {
    summary.replaceChildren();
    summary.hidden = !Object.keys(fields).length;
    const list = document.createElement("ul");
    for (const node of form!.querySelectorAll<HTMLElement>(
      "[data-field-error]",
    ))
      node.textContent = "";
    for (const node of form!.querySelectorAll<HTMLElement>("[aria-invalid]"))
      node.removeAttribute("aria-invalid");
    for (const [field, message] of Object.entries(fields)) {
      const input = document.getElementById(field);
      input?.setAttribute("aria-invalid", "true");
      const hint = form!.querySelector<HTMLElement>(
        `[data-field-error="${field}"]`,
      );
      if (hint) hint.textContent = message;
      const item = document.createElement("li"),
        link = document.createElement("a");
      link.href = `#${field}`;
      link.textContent = message;
      link.addEventListener("click", () => {
        if (input) {
          for (
            let parent = input.parentElement;
            parent && parent !== root;
            parent = parent.parentElement
          )
            parent.hidden = false;
          input.focus();
        }
      });
      item.appendChild(link);
      list.appendChild(item);
    }
    summary.appendChild(list);
    if (fields.signer_name)
      form!.querySelector<HTMLElement>("[data-name-field]")!.hidden = false;
    if (
      ["legal_name", "entity_type", "state", "business_address"].some(
        (k) => fields[k],
      )
    )
      form!.querySelector<HTMLElement>("[data-business-details]")!.hidden =
        false;
    if (
      ["reviewer_email", "approver_email", "notice_email"].some(
        (k) => fields[k],
      )
    )
      form!.querySelector<HTMLElement>("[data-other-contacts]")!.hidden = false;
  }
  async function post(action: string, body: unknown) {
    const response = await fetch(`/api/offer/${token}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as {
      error: string;
      errors?: Record<string, string>;
      documents: { id: string; kind: string; hash: string; text: string }[];
    };
    if (response.status === 401)
      form!.querySelector<HTMLElement>("[data-fresh-link]")!.hidden = false;
    if (!response.ok) {
      if (result.errors && showErrors) errors(result.errors);
      throw new Error(result.error);
    }
    return result;
  }
  function updateSignature() {
    const data = Object.fromEntries(
      Object.entries(values()).map(([key, value]) => [
        key,
        String(value).trim().normalize("NFC"),
      ]),
    );
    root.querySelector<HTMLElement>("[data-signature-name]")!.textContent =
      String(data.signer_name);
    root.querySelector<HTMLElement>("[data-signature-details]")!.textContent =
      `${data.signer_name} · ${data.signer_title}, ${data.legal_name}`;
    root.querySelector<HTMLElement>("[data-consent-text]")!.textContent =
      consentText(String(data.legal_name));
    signButton.textContent = `Sign as ${data.signer_name}`;
    root.querySelector<HTMLElement>("[data-country]")!.hidden =
      data.state !== "Outside the US";
  }
  async function saveAndReview(
    expected: number,
    data: Record<string, FormDataEntryValue>,
  ) {
    await post("draft", { csrf_nonce: csrf.value, values: data });
    const resolved = resolveClientDetails(data, email);
    if (!resolved.ok) {
      if (showErrors) errors(resolved.errors);
      return;
    }
    const result = await post("review", {
      csrf_nonce: csrf.value,
      values: data,
    });
    if (expected !== revision) return;
    const holder = root.querySelector<HTMLElement>(
      "[data-reviewed-documents]",
    )!;
    holder.replaceChildren();
    for (const doc of result.documents) {
      const section = document.createElement("section"),
        heading = document.createElement("h3"),
        text = document.createElement("pre"),
        download = document.createElement("a");
      section.className = "agreement-section";
      section.id = `review-${doc.kind}`;
      heading.textContent = doc.kind.toUpperCase();
      text.className = "agreement-text";
      text.textContent = doc.text;
      download.href = `/api/offer/${token}/review?document=${doc.id}`;
      download.textContent = "Download exact review text";
      section.appendChild(heading);
      section.appendChild(download);
      section.appendChild(text);
      holder.appendChild(section);
    }
    root.querySelector<HTMLElement>("[data-review-hint]")!.textContent =
      "These are the exact filled documents your signature applies to. You can download and keep a complete copy.";
    documentInput.value = JSON.stringify(
      result.documents.map((d: { id: string; hash: string }) => ({
        id: d.id,
        hash: d.hash,
      })),
    );
    reviewedRevision = expected;
    if (showErrors) errors({});
    status.textContent = "Details saved. Your agreement is ready to review.";
  }
  function enqueue() {
    const expected = revision,
      data = values();
    queue = queue
      .then(() => saveAndReview(expected, data))
      .catch((error) => {
        status.textContent = (error as Error).message;
      });
    return queue;
  }
  form.addEventListener("input", () => {
    revision++;
    reviewedRevision = -1;
    documentInput.value = "[]";
    updateSignature();
    // An edit requires renewed consent to the newly filled documents.
    root.querySelector<HTMLInputElement>('[name="consent"]')!.checked = false;
    clearTimeout(timer);
    timer = setTimeout(enqueue, 350);
  });
  // Consent changes do not edit the documents or clear the checkbox itself.
  root
    .querySelector<HTMLInputElement>('[name="consent"]')!
    .addEventListener("input", (event) => event.stopPropagation());
  for (const [button, target] of [
    ["[data-other-contact]", "[data-other-contacts]"],
    ["[data-edit-details]", "[data-business-details]"],
    ["[data-edit-name]", "[data-name-field]"],
  ] as const)
    root.querySelector(button)?.addEventListener("click", () => {
      const node = root.querySelector<HTMLElement>(target)!;
      node.hidden = false;
      node.querySelector<HTMLInputElement>("input,select")?.focus();
    });
  root
    .querySelector<HTMLDetailsElement>("[data-agreed-terms]")!
    .addEventListener("toggle", () => {
      if (!root.querySelector<HTMLDetailsElement>("[data-agreed-terms]")!.open)
        return;
      showErrors = true;
      clearTimeout(timer);
      enqueue();
    });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showErrors = true;
    clearTimeout(timer);
    signButton.disabled = true;
    try {
      await queue;
      if (reviewedRevision !== revision) await enqueue();
      const resolved = resolveClientDetails(values(), email),
        fields = resolved.ok ? {} : resolved.errors;
      if (!root.querySelector<HTMLInputElement>('[name="consent"]')!.checked)
        fields.consent = "Agree to sign electronically";
      errors(fields);
      if (Object.keys(fields).length) {
        summary.focus();
        return;
      }
      if (reviewedRevision !== revision)
        throw new Error("Review your agreement again before signing.");
      await post("sign", {
        csrf_nonce: csrf.value,
        documents: JSON.parse(documentInput.value),
        consent: true,
      });
      location.reload();
    } catch (error) {
      status.textContent = (error as Error).message;
      status.focus();
    } finally {
      signButton.disabled = false;
    }
  });
  updateSignature();
  enqueue();
}
