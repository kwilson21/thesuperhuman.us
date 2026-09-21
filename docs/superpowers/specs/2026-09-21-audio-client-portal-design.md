# Audio client portal design

**Date:** September 21, 2026  
**Status:** Proposed for final owner review  
**Owner:** The Superhuman Group LLC  
**Customer-facing service:** Audio services by Kazon

## Outcome

Build a private studio companion for audio-service clients. It gives each client a calm, reliable way to participate in bringing their song to life without needing to chase messages, schedule calls, or understand engineering vocabulary.

The portal should establish the trust of a thoughtful in-person process while remaining useful to clients who are busy, shy, or uncertain how to give notes. It should explain what is happening, why it matters, and what the client needs to do next.

## Goals

- Keep requests, messages, project progress, payment state, review files, and final delivery in one private place.
- Let clients participate asynchronously through a simple project page.
- Use clear language that accepts emotional or creative feedback without requiring technical audio terminology.
- Give Kazon a single owner view for projects needing attention, unread messages, dates at risk, and files awaiting delivery.
- Keep the first version small enough for one person to operate with confidence.

## Non-goals for the first version

- Direct client file attachments or uploads.
- Inviting collaborators, managers, producers, or additional client accounts.
- Video calling, live chat, voice messages, or automated mixing decisions.
- Automated quotes, contracts, payment reminders, refunds, or disputes.
- A generic customer-support system.

Deferred work must remain recorded in the project roadmap or issue tracker before implementation begins. The direct-file-attachment and collaborator-access features need separate security, retention, and permission design.

## Product model

A service request creates one **provisional** private project as soon as it is received. This lets the client correct a shared-file link or add essential context before Kazon approves the files. The same project is promoted to `Accepted` when Kazon approves the files and scope; messages and timeline history never need to be moved between records. The existing `owner_requests` record remains the source for intake and contact information. The existing `audio_payments` record remains the source for payment status. The new project record owns communication, visible progress, delivery dates, and published project files.

One project has one client email address in the first version. Only Kazon can change a project stage, publish files, set or change the delivery date, or close the project.

### Project stages

| Stage | Client experience | Owner action that advances it |
| --- | --- | --- |
| Files under review | The request arrived and the client can clarify shared-file links or context. The provisional project has no approved scope or payment state. | Accept the files and project scope, which promotes this same project to Accepted. |
| Accepted | The agreed service and cautious delivery date are visible. | Confirm the booking terms. |
| Booking paid | The project is booked. | Stripe confirms the booking invoice. |
| In progress | A brief update says what Kazon is focusing on. | Start the work. |
| Review ready | The client can stream the review version, download it if allowed, and reply with notes. | Publish a review file. |
| Revision in progress | The client sees that their notes were understood and are being addressed. | Begin an agreed revision round. |
| Final files ready | Final files can stream and download for one year. | Publish final files after Stripe confirms the balance. |
| Complete | The recorded delivery remains available through its expiry date. | Close the project after delivery. |

The first version does not allow a client action to change stages. Client messages can clarify or guide the work but do not silently create additional revision rounds.

## Client experience

### Access

The client receives an email containing a private sign-in link whenever a project begins or a meaningful update is posted. The email does not include message text, file names, project notes, payment details, or other private content.

Following the link opens an email-code sign-in flow. A valid, short-lived code establishes a private browser session that can access only projects associated with that email. There are no passwords to create or recover.

### Project page

The project page is calm and direct. Its first view shows:

1. The current stage and the next expected action.
2. The cautious “by” date, or the final-file availability date after delivery.
3. The latest meaningful update from Kazon.
4. A message action when a client response is useful.
5. Published audio files, in context, when available.

A timeline presents a durable record of changes, updates, deliveries, date revisions, and important payment milestones. It should read like studio progress, not a support ticket ledger.

### Visual direction

The client page and owner controls share the existing site’s warm ivory ground, charcoal type, thin rules, restrained oxidized-orange actions, and calm paper texture. The portal should feel like a quiet studio companion, not a generic software dashboard.

- Use a spacious two-column desktop composition: the client project on the left and owner attention controls on the right. Collapse each view to a focused single column on smaller screens.
- Lead the client page with stage, next action, cautious delivery date, latest meaningful update, and any available audio player. Keep these visible before the message thread or timeline.
- Use waveform playback and a vertical progress line as visual anchors. They communicate movement without requiring the client to parse a dense table.
- Use real project data only. Never add decorative quotes, invented project names, fake client messages, placeholder dates, or studio-themed filler language.
- Use small status dots and thin dividers instead of heavy cards, badges, gradients, shadows, or dense control groups.
- Do not show direct-attachment controls in version one. Shared-file links belong in the text thread; review and final audio are published by the owner.

The approved visual study is a reference for proportion, hierarchy, and material feel. It does not prescribe placeholder content or require image assets in the product UI.

### Messages and revision feedback

A single shared text thread opens as soon as the request exists, allowing a client to correct a Drive, Dropbox, or WeTransfer link or provide relevant context before file approval. Messages accept plain text and HTTPS shared-file links only.

The thread remains open during active work and becomes read-only after the project is complete. Clients may describe an outcome in natural terms, for example “make the hook feel more open.” Kazon can respond in plain language, explain what he heard, and convert that feedback into the mixing or mastering work.

When a review version is published, the client is invited to send one consolidated response. This supports the agreed revision allowance without turning communication into an unbounded revision channel.

### Dates and updates

Kazon sets a cautious “by” date when accepting a project. The date is intentionally conservative so early delivery feels dependable.

Publishing a review or final file automatically marks the relevant milestone as delivered and records its actual time. The original “by” date remains visible as part of the project history.

If the date must move later, Kazon must select a clear reason and can add a personal note. First-version reasons are:

- More time to protect the song.
- Waiting on client clarification.
- Scheduling conflict.

The client receives a sign-in-link email and sees both the original and revised dates in the timeline. The system never silently moves a promised date later.

## Owner experience

The existing owner request page becomes the entry point for a provisional service project. It is created with the request. When Kazon accepts the files and scope, the owner sets its “by” date and posts its first update on that same project.

The owner project view provides:

- Project stage, client email, service, payment state, and delivery date.
- A message composer and a record of client and owner messages.
- A timeline composer for meaningful updates.
- Controls to publish a review or final audio file.
- A clear indication of payment gating before final file delivery.
- A project activity record with actor and timestamp.

The owner dashboard adds a “Projects needing attention” section. It prioritizes unread client messages, dates approaching or overdue, and projects where a review or final delivery is due. Routine client messages do not email Kazon. Urgent operational failures and owner attention states continue to use the existing alert approach.

## Files and delivery

Kazon uploads files from the owner project view. The application stores file metadata separately from the private audio object. Metadata includes project id, version type, display name, media type, uploaded time, published time, availability state, and expiry time.

Review audio can stream in the project page. Download availability is an owner choice per file. Final files can stream and download only after the balance invoice has reached Stripe-confirmed `paid` state.

Private file objects must never use a public URL. After an authorized client session is verified, the application produces short-lived streaming or download access. File delivery is recorded with a timestamp and client session identifier sufficient for operations, without storing unnecessary personal data.

Final-file access expires one year after its delivery date. Kazon can revoke a file or client project access earlier when necessary. Expired files remain unavailable even if an old browser link is retained.

## Communication and notification rules

| Event | Portal change | Client email |
| --- | --- | --- |
| Request received | Opens Files under review and message thread. | Sign-in link. |
| Project accepted | Shows scope and cautious “by” date. | Sign-in link. |
| Meaningful work update | Adds owner update to timeline. | Sign-in link. |
| Review file published | Adds player and optional download. | Sign-in link. |
| Delivery date revised | Adds reason, note, original date, and new date. | Sign-in link. |
| Final file published | Adds final player, download, and one-year expiry. | Sign-in link. |

Emails stay minimal. They say that an update is waiting and link to the private sign-in flow. They do not reproduce private content.

## Security and privacy

- Require an email code before client project access. Codes must be random, short-lived, single use, and rate-limited by email and client IP.
- Bind a completed session to one normalized client email. Verify project membership on every client route and file request.
- Use `Cache-Control: private, no-store` for client pages, API responses, and authorized file routes.
- Validate message content, limit message length, accept only HTTPS shared-file links, and rate-limit message creation.
- Store separate owner and client message actors. Client messages must never be treated as owner actions.
- Keep direct attachments and collaborator invitations out of the first version.
- Store files in private object storage. Generate authorization only after server-side session and project checks.
- Keep audit records for access-code issuance, completed sign-ins, message creation, milestone updates, date changes, file publication, revocation, and file delivery.
- Apply this retention schedule before production launch. It deliberately keeps active work intact while limiting inactive client data:
  - Access codes are stored only as hashes; delete them 30 days after use or expiry.
  - Revoke client sessions immediately when access is revoked. Delete expired, revoked, or inactive sessions after 30 days.
  - Keep project messages, updates, shared-link URLs, review files, and client contact data while a project is active. For a withdrawn or declined request with no active payment, delete them within 30 days of closure. For a delivered project, delete them 30 days after the one-year final-file access period ends.
  - Make final files unavailable at the one-year delivery expiry. Remove the portal's client-delivery objects within the following 30 days; any long-term production archive must live outside the client portal and follow its own documented policy.
  - Keep non-content operational and security audit metadata for two years. Payment and invoice records continue to follow the existing Stripe and owner-retention rules; portal cleanup must never remove identifiers for a live or reconciling payment.
- Retention must not delete identifiers needed to prevent a live-payment or active-delivery error.
- Do not place client message content, file URLs, access codes, or personal contact data in alerts or logs.

## Proposed data boundaries

New persistence belongs beside existing `owner_requests` and `audio_payments` in the same D1 boundary. It should use small, purpose-specific tables rather than extending one request row with a growing JSON document.

| Record | Purpose |
| --- | --- |
| `audio_projects` | Project identity, request link, client email, stage, original and current “by” dates, completion state. |
| `audio_project_updates` | Owner-authored milestones and date-change reasons. |
| `audio_project_messages` | Text messages and shared HTTPS links, actor type, delivery and read state. |
| `audio_project_files` | Private object key and client-facing publication metadata. |
| `audio_client_codes` | Hashed one-time code, expiry, use time, request limits. |
| `audio_client_sessions` | Revocable client session with minimal access metadata. |
| `audio_project_audit` | Security and operational audit history. |

The design should reuse the existing owner-request audit conventions where a project action is part of request handling. It should not duplicate payment state or make the project database authoritative for Stripe status.

## Route and API boundaries

The public audio intake flow remains unchanged. New client routes live under a dedicated private project namespace, for example `/studio`, to avoid confusing the artist-facing audio pages with the service workflow.

- `/studio/sign-in`: request and complete email-code access.
- `/studio/projects/:id`: client project page.
- `/api/studio/*`: client message, session, streaming, and download actions.
- `/owner/projects`: projects needing attention.
- `/owner/projects/:id`: owner project controls.
- `/api/owner/projects/*`: owner project, update, message, file, and revocation actions.

All client and owner mutations require same-origin protection, authorization, input validation, and no-store responses. Stripe remains the payment authority and the existing Stripe webhook continues to update only payment projections.

## Failure handling

- If code delivery fails, do not reveal whether a project exists. Record the failure for the owner and offer a safe retry path.
- If a client is rate-limited, provide a clear wait message without exposing project data.
- If file processing or upload fails, do not publish a partial file. Keep the prior published version intact.
- If an authorized streaming or download link expires during use, show a clear prompt to return to the project page and request a fresh authorized link.
- If final payment is not confirmed, hide final files even if they were uploaded accidentally.
- If the owner revokes access, terminate client sessions and make all future file authorization fail.
- If email delivery or storage is unavailable, preserve the project record and show the owner an actionable state rather than implying delivery succeeded.

## Verification

Implementation is complete only when the following checks pass:

1. Client access codes cannot be reused, guessed, or used after expiry.
2. A client session cannot view another client’s project, messages, files, or payment details.
3. Owner and client mutations reject cross-site requests and unauthorized actors.
4. Message validation and rate limits reject abusive payloads without storing them.
5. Review files stream only to an authorized client session.
6. Final file streaming and downloads remain unavailable until the Stripe balance status is paid.
7. Publishing a review or final file creates the correct timeline entry and actual delivery timestamp.
8. A late date update records the original date, selected reason, new date, and client notification event.
9. File revocation and project-access revocation take effect for active sessions.
10. One-year final-file expiry blocks new downloads.
11. Owner attention reporting correctly identifies unread messages and date-risk projects.
12. Retention deletes or anonymizes project data according to the documented policy without breaking active payment or delivery states.
13. Existing request, owner, payment, Stripe webhook, build, and responsive-page checks continue to pass.
14. The repository prelaunch checklist is completed separately before any production deployment.

## Delivery milestones

1. **Foundation:** schema, migration, owner project creation, audit history, and client email-code authentication.
2. **Communication:** client project page, owner and client message thread, timeline updates, notification email.
3. **Review and delivery:** private file publishing, browser audio playback, payment-gated final downloads, one-year expiry, revocation.
4. **Operations:** owner attention view, retention rules, failure states, accessibility and mobile review, operational runbook.

Each milestone should be independently reviewable and releasable behind a disabled configuration gate until its tests and manual checks pass.
