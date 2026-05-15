/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  RESEND_API_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  CONTACT_TO_EMAIL: string;
  CONTACT_FROM_EMAIL: string;
  RATE_LIMIT: KVNamespace;
  // KV namespace holding short-lived resume-request approval tokens (req:<id>)
  // and the binary resume PDFs (pdf:general | pdf:dod).
  // Can point at the same physical KV namespace as RATE_LIMIT — key
  // prefixes keep the data isolated.
  RESUME_STORE: KVNamespace;
}

interface ImportMetaEnv {
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
