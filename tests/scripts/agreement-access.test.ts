import { afterEach, expect, it, vi } from "vitest";
import { setupAgreementAccess } from "~/scripts/agreement-access";
import { consentText } from "~/lib/agreement-fields";
function fixture() {
  const values: Record<string, string> = {
    legal_name: " Example LLC ",
    signer_name: " Alex Example ",
    signer_title: " Owner ",
    entity_type: "",
    state: "",
    country: "",
    business_address: "",
    portfolio_choice: "",
    reviewer_name: "",
    reviewer_email: "",
    approver_name: "",
    approver_email: "",
    notice_email: "",
    csrf_nonce: "csrf",
    documents: "[]",
  };
  const node = (extra: Record<string, unknown> = {}) => {
    const events: Record<string, Function> = {};
    return {
      value: "",
      textContent: "",
      hidden: false,
      checked: false,
      disabled: false,
      dataset: {},
      addEventListener: (event: string, fn: Function) => {
        events[event] = fn;
      },
      emit: async (event: string) =>
        events[event]?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() }),
      replaceChildren: vi.fn(),
      appendChild: vi.fn(),
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      focus: vi.fn(),
      ...extra,
    };
  };
  const elements: Record<string, ReturnType<typeof node>> = {};
  for (const selector of [
    '[name="csrf_nonce"]',
    '[role="status"]',
    '[name="documents"]',
    "[data-sign-button]",
    "[data-signature-name]",
    "[data-signature-details]",
    "[data-consent-text]",
    "[data-country]",
    '[name="consent"]',
    "[data-fresh-link]",
    "[data-agreed-terms]",
  ])
    elements[selector] = node();
  elements['[name="csrf_nonce"]'].value = "csrf";
  const form = node({
    dataset: { token: "offer", email: "alex@example.com" },
    querySelector: (s: string) => elements[s] ?? null,
  });
  const summary = node();
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector === "[data-signing-page]" ? form : summary,
    querySelectorAll: () => [],
    createElement: () => node(),
    getElementById: () => null,
  });
  vi.stubGlobal(
    "FormData",
    class {
      constructor(_form: unknown) {}
      *[Symbol.iterator]() {
        yield* Object.entries(values);
      }
      has(key: string) {
        return key in values;
      }
      get(key: string) {
        return values[key] ?? null;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
  return { values, elements, form };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shows the normalized name and exactly the consent text retained by the server", async () => {
  const { elements } = fixture();
  setupAgreementAccess();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(elements["[data-signature-name]"].textContent).toBe("Alex Example");
  expect(elements["[data-signature-details]"].textContent).toBe(
    "Alex Example · Owner, Example LLC",
  );
  expect(elements["[data-consent-text]"].textContent).toBe(
    consentText("Example LLC"),
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/draft");
});
it("autosaves changed fields and clears consent before a new review", async () => {
  vi.useFakeTimers();
  const { elements, form, values } = fixture();
  setupAgreementAccess();
  await vi.runAllTimersAsync();
  elements['[name="consent"]'].checked = true;
  values.signer_title = "Director";
  await form.emit("input");
  expect(elements['[name="consent"]'].checked).toBe(false);
  await vi.runAllTimersAsync();
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]?.body));
  expect(body.values.signer_title).toBe("Director");
});
