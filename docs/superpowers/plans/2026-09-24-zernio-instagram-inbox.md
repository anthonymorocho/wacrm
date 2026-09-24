# Zernio Instagram Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Instagram DMs and organic post comments through the connected Zernio profile, with replies sent from WACRM.

**Architecture:** Keep one Zernio profile and signed webhook endpoint per CRM account. Store a separate provider-scoped connection for Messenger and Instagram, then reuse the existing social Inbox and comments persistence paths with provider-aware normalization and routing.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Supabase/Postgres migrations, Vitest, next-intl.

**Spec:** `docs/superpowers/specs/2026-09-24-zernio-instagram-inbox-design.md`

## Global Constraints

- Preserve the existing Facebook Messenger and WhatsApp paths.
- Verify raw Zernio webhook signatures against the payload's exact profile before parsing or processing.
- Scope connection, conversations, posts, comments, and outbound replies to the authenticated CRM account.
- Add no customer-owned Meta credentials, API, or app setup.
- Support text DM replies and public replies on organic post comments only.
- Read the installed Next.js 16 Route Handler documentation before changing route code.

---

### Task 1: Allow Facebook and Instagram connections under one Zernio profile

**Files:**
- Modify: `supabase/migrations/053_zernio_instagram_inbox.sql`
- Modify: `src/lib/zernio/connection.ts`
- Test: `src/lib/zernio/connection.test.ts`
- Modify: `src/lib/zernio/client.ts`
- Modify: `src/app/api/zernio/connect/route.ts`
- Test: `src/app/api/zernio/connect/route.test.ts`
- Modify: `src/app/api/zernio/callback/route.ts`
- Test: `src/app/api/zernio/callback/route.test.ts`
- Modify: `src/app/api/zernio/connection/route.ts`
- Test: `src/app/api/zernio/connection/route.test.ts`

**Interfaces:** `ZernioProvider = 'messenger' | 'instagram'`; generic save and channel lookup APIs; safe connection status returns an array keyed by provider.

- [ ] Write the failing connection test showing one account can retain a Messenger row while adding an Instagram row, with unique Zernio account IDs.
- [ ] Run `npx vitest run src/lib/zernio/connection.test.ts` and confirm the new test fails because only a single account connection exists.
- [ ] Add a migration that adds/backfills `provider`, replaces uniqueness on `account_id` and `zernio_profile_id` with `(account_id, provider)`, permits Instagram comments, and makes the legacy Facebook Page ID nullable.
- [ ] Generalize connection save/list/lookups while preserving the old Messenger row and channel.
- [ ] Add the `platform` query to the OAuth start route; allow only `facebook` and `instagram`, defaulting to `facebook` for existing callers.
- [ ] Generalize the callback to accept `connected=facebook|instagram`, retain Facebook Page resolution, and save Instagram using the returned username and Zernio account ID.
- [ ] Return safe provider-specific connection metadata without exposing Zernio account IDs or credentials.
- [ ] Run the Task 1 tests and confirm the provider-scoped mappings and OAuth behavior pass.

### Task 2: Receive and reply to Instagram direct messages

**Files:**
- Modify: `src/lib/zernio/messaging.ts`
- Test: `src/lib/zernio/messaging.test.ts`
- Modify: `src/lib/zernio/inbound.ts`
- Test: `src/lib/zernio/inbound.test.ts`
- Modify: `src/lib/whatsapp/send-message.ts`
- Test: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:** Normalize Zernio `facebook` events to WACRM `messenger` and `instagram` events to WACRM `instagram`; look up outbound connection from the conversation's channel ID.

- [ ] Add a failing parser test with a valid incoming `platform: 'instagram'` webhook and an assertion for `provider: 'instagram'`.
- [ ] Run `npx vitest run src/lib/zernio/messaging.test.ts` and confirm Instagram is currently ignored.
- [ ] Normalize Instagram events and attachment labels into the existing Meta inbound contract; continue rejecting outgoing and unsupported platform events.
- [ ] Require the event provider to match the Zernio connection's mapped channel before running the shared inbound processor.
- [ ] Route Instagram text replies from the existing send service through that channel's Zernio account; preserve text-only Zernio transport and account ownership checks.
- [ ] Parameterize recovery of missing Zernio conversation IDs by the channel's Zernio platform.
- [ ] Run focused parser, inbound, and outbound tests; confirm Messenger behavior is unchanged.

### Task 3: Receive and reply to Instagram post comments

**Files:**
- Modify: `src/lib/zernio/client.ts`
- Modify: `src/lib/zernio/comments.ts`
- Test: `src/lib/zernio/comments.test.ts`
- Modify: `src/lib/zernio/inbound.ts`
- Modify: `src/app/api/zernio/comments/route.ts`
- Test: `src/app/api/zernio/comments/route.test.ts`

**Interfaces:** Comment rows and `ZernioCommentedPost.platform` support `facebook | instagram`; routes resolve the Zernio account from each active provider connection.

- [ ] Add a failing parser test for a valid Instagram `comment.received` webhook and assert the resulting post/comment platform is Instagram.
- [ ] Run `npx vitest run src/lib/zernio/comments.test.ts` and confirm the current Facebook-only guard rejects the event.
- [ ] Accept only `facebook` and `instagram` comment events and persist their platform on posts and comments.
- [ ] Allow comment API listing to request either platform and keep returned data tied to the matching active connection.
- [ ] Sync posts/comments for both connected channels; when replying, select the connection from the account-owned mirrored post and validate the optional comment belongs to that post.
- [ ] Run focused comment parser and route tests for both platforms, including rejection of a post/comment not in the tenant's mirror.

### Task 4: Expose Instagram connection and comments in the CRM UI

**Files:**
- Modify: `src/components/settings/meta-channels-config.tsx`
- Modify: `src/app/(dashboard)/comments/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ko.json`

**Interfaces:** Settings renders independent Facebook and Instagram connection states/actions; comment posts carry a provider badge.

- [ ] Adapt Settings to load a provider-keyed connection list and offer separate connect/reconnect buttons using the existing Zernio credentials.
- [ ] Add labels for Instagram status, connection, success/error, and account identity in all three supported locales.
- [ ] Generalize Comments page copy and label each Facebook/Instagram post while retaining the existing public reply composer.
- [ ] Run `npm run typecheck`, `npx vitest run` for the affected Zernio and send-message tests, and `npm run lint -- <changed files>`.
- [ ] Run `npm run build` if required local environment variables are available; record configuration-only failures separately from code failures.
