# Meta Messaging Inbound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound Instagram and Facebook Messenger messages to the existing Inbox while preserving the current WhatsApp integration unchanged.

**Architecture:** Keep `/api/whatsapp/webhook` and its WhatsApp-specific configuration untouched. Add account-scoped `meta_channels` and `meta_contact_identities`, normalize Meta `instagram`/`page` payloads in a separate library, persist through a new webhook route, and expose configuration in Settings. The existing Inbox sees the new rows through its current Supabase Realtime subscriptions.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Supabase/PostgreSQL migrations and RLS, Vitest, existing AES-256-GCM encryption and Meta HMAC helpers.

**Spec:** `docs/superpowers/specs/2026-09-16-meta-messaging-inbound-design.md`

## Global Constraints

- Do not modify the behavior or contracts of `/api/whatsapp/webhook`, `/api/whatsapp/send`, or `whatsapp_config`.
- Persist new secrets encrypted with the existing `encrypt()` helper; never return them to the browser.
- Validate the raw webhook body signature before parsing or writing data.
- Keep social identities and provider message IDs idempotent per configured channel.
- This delivery receives and displays messages only; social outbound replies remain a later feature.

---

### Task 1: Define the social Meta payload contract

**Files:**
- Create: `src/lib/meta/messaging.ts`
- Test: `src/lib/meta/messaging.test.ts`

**Interfaces:**
- Produces `MetaChannelProvider`, `NormalizedMetaMessage`, `parseMetaMessagingPayload(payload: unknown): NormalizedMetaMessage[]`, `validateMetaChannelProvider(value: unknown): MetaChannelProvider | null`, and `validateMetaChannelConfig(input: unknown): MetaChannelConfigInput`.

- [ ] **Step 1: Write failing parser tests**

Add tests for Messenger text, Instagram text, attachments, echo suppression, unsupported payloads, and malformed input. Assert normalized provider, account ID, sender ID, message ID, timestamp, content type, and text.

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- src/lib/meta/messaging.test.ts`

Expected: FAIL because `src/lib/meta/messaging.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser and config validator**

Map `object: "page"` to `messenger` and `object: "instagram"` to `instagram`. Read `entry[].messaging[]`, skip `message.is_echo`, require `sender.id` and `message.mid`, map text and the first attachment, and fall back to a readable unsupported marker. Reject non-string credentials, unsupported providers, empty IDs, and values over 2048 characters.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- src/lib/meta/messaging.test.ts`

Expected: PASS with all parser and validator tests passing.

### Task 2: Add additive database support

**Files:**
- Create: `supabase/migrations/048_meta_messaging_inbound.sql`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces tables `meta_channels` and `meta_contact_identities`, nullable `contacts.phone`, `conversations.channel`, `messages.channel`, `messages.channel_id`, and the partial unique index on `(channel_id, message_id)` for new social messages.

- [ ] **Step 1: Add schema assertions to the migration review checklist**

Verify the migration contains account-scoped RLS, encrypted-token comments, defaults of `whatsapp` for existing conversation/message rows, and no destructive operation on existing message/config data.

- [ ] **Step 2: Write the additive migration**

Create `meta_channels` with provider, external account ID, encrypted access token, encrypted app secret, encrypted verify token, display name, status, and account/user audit columns. Create `meta_contact_identities` with a unique `(channel_id, external_user_id)`. Make `contacts.phone` nullable, add channel columns with WhatsApp defaults, and create indexes/constraints needed for lookup and replay protection.

- [ ] **Step 3: Update types and preserve WhatsApp assumptions**

Add `MetaChannelProvider`, `MetaChannel`, `MetaContactIdentity`, and optional channel fields to `Conversation`/`Message`. Change `Contact.phone` to `string | null`, then retain explicit phone validation in all WhatsApp-only send/broadcast paths.

- [ ] **Step 4: Run typecheck and inspect failures**

Run: `npm run typecheck`

Expected: Any failures are limited to direct phone display/serialization sites and are fixed with existing name/phone fallbacks; no WhatsApp behavior is changed.

### Task 3: Build the account-scoped channel configuration API

**Files:**
- Create: `src/app/api/meta/channels/route.ts`
- Test: `src/app/api/meta/channels/route.test.ts`

**Interfaces:**
- `GET` returns channel metadata without secrets.
- `POST` accepts `{ provider, external_account_id, display_name?, access_token, app_secret, verify_token }` for an administrator and encrypts secrets before upsert.
- `DELETE` removes one channel belonging to the current account.

- [ ] **Step 1: Write failing validation/route tests**

Cover unsupported provider, missing credential, secret omission from GET response, and account-scoped delete/update behavior using the same route-test stubbing pattern as existing API tests.

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- src/app/api/meta/channels/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

Use `requireRole('admin')`, `validateMetaChannelConfig`, `encrypt`, and an account-filtered Supabase query. Upsert on `(account_id, provider, external_account_id)`. Return only IDs, provider, display name, status, and timestamps.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- src/app/api/meta/channels/route.test.ts`

Expected: PASS.

### Task 4: Persist normalized inbound social messages

**Files:**
- Create: `src/lib/meta/inbound.ts`
- Test: `src/lib/meta/inbound.test.ts`

**Interfaces:**
- Produces `processNormalizedMetaMessage(db, channel, message): Promise<'inserted' | 'duplicate' | 'failed'>`.

- [ ] **Step 1: Write failing persistence tests**

Cover first identity creation, identity reuse, conversation creation, message insert, duplicate message handling, unread update, and account-scoped lookup. Assert database payloads rather than implementation call counts.

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- src/lib/meta/inbound.test.ts`

Expected: FAIL because the persistence helper does not exist.

- [ ] **Step 3: Implement the minimal persistence helper**

Resolve/create the social identity and contact, find/create one conversation for that contact, insert a customer message with the provider channel and channel ID, treat PostgreSQL `23505` on the new partial unique index as a replay, update conversation activity/unread state, and invoke existing inbound routing/deal helpers after the canonical insert.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- src/lib/meta/inbound.test.ts`

Expected: PASS.

### Task 5: Add the isolated Meta webhook route

**Files:**
- Create: `src/app/api/meta/webhook/route.ts`
- Test: `src/app/api/meta/webhook/route.test.ts`

**Interfaces:**
- `GET` verifies Meta's `hub.challenge` against encrypted channel verify tokens.
- `POST` validates `x-hub-signature-256`, schedules processing with `after()`, returns `{ status: 'received' }`, and processes only entries whose channel-specific app secret matches.

- [ ] **Step 1: Write failing route behavior tests**

Cover valid GET, wrong verify token, invalid signature, valid Messenger/Instagram acknowledgement, unknown channel, and echo suppression.

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- src/app/api/meta/webhook/route.test.ts`

Expected: FAIL because the isolated route does not exist.

- [ ] **Step 3: Implement the route**

Read the raw body once, load configured channels with the service-role client, decrypt only on the server, validate the signature against channels matching entry IDs, parse only supported objects, and call `processNormalizedMetaMessage` inside `after()`. Do not import or alter the WhatsApp webhook route.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- src/app/api/meta/webhook/route.test.ts`

Expected: PASS.

### Task 6: Add Settings configuration UI

**Files:**
- Create: `src/components/settings/meta-channels-config.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/components/settings/settings-sections.ts`
- Modify: `messages/es.json`
- Modify: `messages/en.json`
- Modify: `messages/ko.json`

**Interfaces:**
- Adds a `Meta messaging` settings section with separate Instagram and Facebook Messenger forms, masked credential inputs, save/remove actions, and the common webhook URL.

- [ ] **Step 1: Write the UI against the existing API contract**

Render the two providers from a fixed local list, load `GET /api/meta/channels`, and never prefill secret inputs with plaintext. Require all three credentials on each save.

- [ ] **Step 2: Add translated labels and section metadata**

Add the section to the settings rail/page map and add matching keys to all locale files so `next-intl` has no missing-message errors.

- [ ] **Step 3: Implement save/remove states**

Use the existing `canEditSettings` gate, show disabled/read-only state to non-admins, surface API errors, and display `https://<current-host>/api/meta/webhook` for Meta configuration.

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint; npm run typecheck`

Expected: exit code 0.

### Task 7: Verify the existing WhatsApp path and full build

**Files:**
- Test only existing WhatsApp suites and all new suites.

- [ ] **Step 1: Run focused WhatsApp regression tests**

Run: `npm test -- src/app/api/whatsapp/send/route.test.ts src/lib/whatsapp/webhook-signature.test.ts src/lib/whatsapp/meta-api.test.ts src/lib/whatsapp/meta-api.media.test.ts`

Expected: PASS with no changes required to the WhatsApp route or send path.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run formatting/lint/typecheck/build**

Run: `npm run format:check; npm run lint; npm run typecheck; npm run build`

Expected: every command exits 0.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check; git status --short; git diff --stat`

Expected: only the Meta inbound feature files, migration, settings integration, locale additions, tests, and design/plan documents are changed; no WhatsApp route behavior is modified.

