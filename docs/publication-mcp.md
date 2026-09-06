# Authenticated publication connection

The website Worker hosts the publisher at
`https://thesuperhuman.us/api/publication/mcp`. This replaces copying the HTTP
receiver token into an agent environment. It adds no GitHub Actions workflow,
separate application server, or background scheduler.

The same D1 journal serves both transports. OAuth grants live in a dedicated KV
namespace. Pending reviewed envelopes stay in the source project’s existing durable handoff.
The D1 journal already stores receipts and prevents duplicate retries. MCP calls
that journal directly; there is no second queue or delivery service.

## One-time activation

1. Verify the existing `0001_publication_journal.sql` migration is applied.
   No additional migration is required for this publisher. Preserve the ledger
   and existing application bindings.
2. Create a dedicated KV namespace and add its real ID to `wrangler.jsonc` as
   `OAUTH_KV`. Do not reuse the contact, resume, or session namespace.
3. Create a dedicated GitHub OAuth App with homepage `https://thesuperhuman.us`
   and callback `https://thesuperhuman.us/api/publication/callback`.
   GitHub is used only to verify identity; this app requests no repository scopes.
4. Configure `PUBLICATION_OWNER_ID=10987837` and the OAuth App's public client ID
   as `PUBLICATION_GITHUB_CLIENT_ID`. Keep `PUBLICATION_PROJECTS=threadline`.
5. Store `PUBLICATION_GITHUB_CLIENT_SECRET` and a cryptographically random
   32-byte, base64url-encoded `PUBLICATION_COOKIE_KEY` as encrypted Worker secrets.
   Transfer values directly through private credential channels. Never paste them
   into chat, command arguments, source, logs, or publication payloads.
6. Deploy through the existing reviewed Git integration. Add the MCP URL in the
   client, approve its project permissions, and sign in with the owner's GitHub
   account. Leave the existing `PUBLICATION_TOKEN` in place for the HTTP receiver;
   this connector does not need to copy or expose it.
7. Read project progress through MCP and recover pending envelopes from the source handoff.
   Deliver one real reviewed update, retain its receipt, and check its public
   rendering on the homepage and `/building`. A successful probe alone does not
   establish active publishing.

Missing bindings fail closed with 503. Alternate hosts, including preview hosts,
return 404 for these OAuth routes. No placeholder namespace ID is committed.
The public read-only `/api/mcp-probe` remains available during migration.

## Authorization and boundaries

Cloudflare's pinned OAuth provider implements discovery, dynamic client
registration, authorization codes, PKCE, token audience checks, and refresh.
Our consent screen identifies the requesting client and project permissions.
GitHub sign-in is bound to that browser consent by a short-lived encrypted,
HttpOnly, Secure cookie, random state, and separate upstream PKCE verifier.
Only the configured numeric GitHub account ID may authorize publication.
The upstream GitHub token is neither stored nor passed to the MCP client.

Each project uses its own `publication:<project-id>` scope. Every tool checks the
owner ID, token scopes, and current deployment allowlist. Refresh narrowing also
narrows the properties consumed by the tool handler. Adding a new project to the
allowlist does not widen an existing token's grant: reconnect to consent to it.
Remove a project from the allowlist to stop its reads and writes immediately at
the application boundary. Revoke a client's grant through the provider's admin
helpers if the connection itself is compromised; delete/rotate the dedicated
OAuth configuration if retiring the publisher entirely.

Tool access authorizes transport, not factual claims. Agents must still reconcile
canonical records and apply the audience policy before constructing an envelope.
Client software may request confirmation for mutating tools; this server cannot
silently override the client's permission model.

## Tools and recovery

| Tool | Purpose |
| --- | --- |
| `get_project_progress` | Read published history, current focus, and revision. |
| `publish_project_update` | Deliver a version-1 publish, correction, backfill, or withdrawal. |

`delivered` includes a durable journal receipt. `pending` means retry the exact
same envelope from the source handoff at the next normal work boundary. `conflict` requires canonical reconciliation; do not increment the
revision blindly or change content under the same event ID. `withdrawn` means
stop attempting to restore that entry. Invalid or rejected envelopes need review.
A lost response is recovered using the same event identity.

Persist the returned receipt in the source handoff, then clear its pending copy.
A lost acknowledgement is safe: the journal returns the original receipt for an
identical retry. Withdrawal clears the journal's public prose and blocks replay.
Source-side pending copies must also be cleared during withdrawal reconciliation.
Replay-protection hashes remain. D1 backup retention remains separate.

## Verification limits

Tests exercise SQLite journal transactions, the actual OAuth library's discovery,
registration, code/token exchange and scope narrowing, plus consent/identity
failures. Node tests replace only the WorkerEntrypoint marker and KV transport.
Production activation still requires the real bindings, migration, owner sign-in,
a real publication receipt, and website rendering verification.
