# Automatic Conversation Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically route unassigned WhatsApp conversations to available team agents with a configurable capacity, preserve handled ownership, attribute human replies, and show live workload.

**Architecture:** PostgreSQL owns the routing invariant. A new additive migration stores account capacity and explicit agent availability, exposes a self-only availability RPC, and implements one security-definer allocator that releases stale unanswered work and claims queued conversations under row locks. Existing webhook, inbox, presence, settings, and dashboard layers call or display that database-owned state; no browser-side count/update race decides assignment.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Supabase/PostgreSQL RPC and RLS, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-conversation-routing-design.md`

## Global Constraints

- The assignment unit is a conversation, not an individual message.
- Only `owner`, `admin`, and `agent` members are eligible for automatic assignment; `viewer` never receives work.
- Active capacity counts only `open` and `pending` conversations and defaults to `400` per agent/account.
- FIFO queue ordering and least-active-load selection are enforced atomically in PostgreSQL; ties rotate by last assignment time.
- Stale heartbeat or explicit offline availability makes an agent ineligible; only unanswered conversations are released on unavailability.
- Existing manual assignments and answered conversations remain assigned unless explicitly unassigned or released by the stated rules.
- All account and role checks remain server/database enforced; clients never choose tenancy or impersonate another member.
- New behavior must be covered test-first, followed by focused tests, typecheck, lint, and production build.
- The repository uses Next.js 16.2.12; route handlers use the App Router Web `Request` API and dynamic route params are promises.

---

### Task 1: Add pure routing rules and database allocator

**Files:**
- Create: `src/lib/conversations/routing.ts`
- Test: `src/lib/conversations/routing.test.ts`
- Create: `supabase/migrations/040_conversation_routing.sql`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces pure helpers `countActiveAssignments`, `isCapacityAvailable`, `selectLeastLoadedAgent`, `sortQueuedConversations`, and `needsHumanReply` for tests and future UI logic.
- Produces SQL functions `public.route_account_conversations(UUID)` and `public.set_agent_availability(TEXT)` plus the `accounts.max_active_conversations_per_agent` and `member_presence.availability` columns.

- [ ] **Step 1: Write failing pure-rule tests** for active statuses, positive capacity, FIFO ordering, least-load selection with last-assignment tie rotation, and latest-customer-vs-human-reply detection.
- [ ] **Step 2: Run `npm test -- src/lib/conversations/routing.test.ts` and confirm the missing-module failure is caused by the unimplemented helpers.
- [ ] **Step 3: Implement the minimal typed pure helpers** with deterministic inputs and no database access.
- [ ] **Step 4: Run the focused routing tests and confirm they pass.**
- [ ] **Step 5: Write the additive SQL migration** with positive capacity validation, availability check/default, indexes, `set_agent_availability` caller/account authorization, and `route_account_conversations` security-definer locking/release/claim loop. Restrict allocator execution to `service_role`; let the self-only RPC invoke it internally. Add a conversation trigger for unassign/close events and realtime publication for the new presence field through the existing table.
- [ ] **Step 6: Update conversation/profile/presence TypeScript shapes** to include nullable assignment and availability fields without breaking legacy fixtures.
- [ ] **Step 7: Run `npm run typecheck` and the full unit suite.**

### Task 2: Connect automatic routing to inbound and conversation events

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Test: `src/app/api/whatsapp/webhook/route.test.ts` (create if absent, otherwise extend the existing webhook test)

**Interfaces:**
- Consumes `supabase.rpc('route_account_conversations', { p_account_id: accountId })` through the service-role client after canonical inbound message insertion.
- Existing manual assignment remains a direct account-scoped update; database trigger routes only when an assignment is removed or a conversation closes.

- [ ] **Step 1: Add a failing webhook regression test** proving routing is invoked after a deduplicated inbound message path and not before message persistence.
- [ ] **Step 2: Run the focused webhook test and confirm it fails for the missing allocator invocation.**
- [ ] **Step 3: Invoke the allocator after the inbound conversation/message update and preserve existing flow, automation, dedupe, reaction, and status behavior. Log routing failures without changing Meta’s acknowledgement path.**
- [ ] **Step 4: Run the webhook focused tests and confirm they pass.**
- [ ] **Step 5: Make inbox status/unassign paths resync the conversation list after the database trigger can release/claim queued work, while keeping explicit manual assignment intact.**
- [ ] **Step 6: Run inbox/API focused tests and typecheck.**

### Task 3: Persist the authenticated human sender on every manual send

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Modify: `src/app/api/whatsapp/send/route.ts`
- Modify: `src/lib/api/v1/messages.ts` (or the repository’s existing public-message adapter if the exact path differs)
- Test: `src/lib/whatsapp/send-message.test.ts`
- Test: `src/app/api/whatsapp/send/route.test.ts`

**Interfaces:**
- Extends `SendMessageParams` with `senderId?: string | null`.
- Dashboard route passes `userId`; API-key sends pass `null` unless an authenticated agent identity is already available. The persisted row remains `sender_type='agent'`, while automation remains `sender_type='bot'`.

- [ ] **Step 1: Add failing send-core tests** asserting the insert payload contains the authenticated sender ID for text, template, media, and interactive sends.
- [ ] **Step 2: Run the focused send tests and confirm they fail because `sender_id` is absent.**
- [ ] **Step 3: Add `senderId` to the core and dashboard adapter, writing `sender_id` on the single manual insert without changing Meta send behavior.**
- [ ] **Step 4: Run focused send tests and the existing route tests, confirming all pass.**
- [ ] **Step 5: Add/adjust the public adapter only where its existing contract has a real authenticated sender; do not invent identity for API keys.**
- [ ] **Step 6: Run typecheck and the full WhatsApp/API unit suite.**

### Task 4: Add self availability control and admin capacity setting

**Files:**
- Create: `src/app/api/account/availability/route.ts`
- Create: `src/components/presence/availability-control.tsx`
- Create: `src/components/settings/routing-settings.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/components/settings/settings-sections.ts`
- Modify: `src/components/settings/settings-overview.tsx`
- Test: `src/app/api/account/availability/route.test.ts`
- Test: `src/components/presence/availability-control.test.tsx` (or a pure control test if the repository test environment lacks DOM support)

**Interfaces:**
- `POST /api/account/availability` accepts only `{ availability: 'online' | 'offline' }` and calls the self-only RPC; it never accepts a user or account ID.
- `RoutingSettings` reads/writes `accounts.max_active_conversations_per_agent` only for admin/owner, validates an integer `> 0`, and uses `400` as the fallback/default.
- `AvailabilityControl` reads the caller’s own `member_presence` row, optimistically toggles with rollback on error, and keeps visual heartbeat presence separate from routing availability.

- [ ] **Step 1: Add failing route tests** for accepted self state, invalid value, unauthenticated caller, and no caller-supplied user/account targeting.
- [ ] **Step 2: Run the focused API tests and confirm they fail because the route does not exist.**
- [ ] **Step 3: Implement the thin route using `getCurrentAccount`, input validation, and the `set_agent_availability` RPC.**
- [ ] **Step 4: Run focused availability tests and confirm they pass.**
- [ ] **Step 5: Add the availability control to the authenticated dashboard shell and the admin-only routing settings panel to the existing settings rail/page.**
- [ ] **Step 6: Add failing/green UI tests for toggle rollback and capacity validation, then run them with the existing UI test command.**
- [ ] **Step 7: Run typecheck and lint.**

### Task 5: Show agent attribution in the inbox

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/hooks/use-presence.ts`
- Modify: `src/lib/presence.ts`
- Modify: `src/app/api/account/members/route.ts`
- Test: `src/lib/presence.test.ts`
- Test: `src/components/inbox/message-bubble.test.tsx` (create if the current test setup supports component tests)

**Interfaces:**
- Presence row shape includes `availability` while `derivePresence` continues to derive visual `online/away/offline` from heartbeat.
- Message bubbles receive a resolved `senderLabel`; missing legacy `sender_id` renders neutral `Agent`, never the conversation owner.

- [ ] **Step 1: Add failing pure presence/type tests** for availability being independent from stale visual presence.
- [ ] **Step 2: Run the focused presence tests and confirm the new expectation fails.**
- [ ] **Step 3: Extend presence fetching/realtime state and member data without changing visual stale-heartbeat semantics.**
- [ ] **Step 4: Add failing/green bubble tests for named human sender, neutral legacy sender, and bot distinction.**
- [ ] **Step 5: Hydrate member profiles once in the inbox and pass the resolved label to message bubbles; keep the assignment dropdown usable for permitted users.**
- [ ] **Step 6: Run focused inbox/presence tests, typecheck, and lint.**

### Task 6: Add dashboard workload snapshot

**Files:**
- Modify: `src/lib/dashboard/types.ts`
- Modify: `src/lib/dashboard/queries.ts`
- Create: `src/components/dashboard/agent-workload.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Test: `src/lib/dashboard/queries.test.ts` (create if absent)
- Test: `src/components/dashboard/agent-workload.test.tsx` (create if DOM tests are available)

**Interfaces:**
- `loadAgentWorkload(db)` returns every owner/admin/agent member with `userId`, `name`, visual presence, availability, `activeCount`, `capacity`, and `remaining`, plus the account’s unassigned active queue count.
- The query is account/RLS scoped, includes zero-load agents, counts only `open`/`pending`, and uses the configured capacity from the account row.

- [ ] **Step 1: Add failing query tests** for zero-load inclusion, closed exclusion, capacity remaining, and queued count.
- [ ] **Step 2: Run the focused dashboard query tests and confirm the missing query fails.**
- [ ] **Step 3: Implement the account-scoped workload query using existing Supabase client query patterns and pure aggregation helpers.**
- [ ] **Step 4: Run focused query tests and confirm they pass.**
- [ ] **Step 5: Render an accessible workload card with agent counts/capacity and queued conversations; load it with the dashboard’s existing initial refresh flow.**
- [ ] **Step 6: Run dashboard UI tests, typecheck, and lint.**

### Task 7: Verify the complete slice

**Files:**
- Modify: `docs/superpowers/plans/2026-09-10-conversation-routing.md` (check off completed steps)
- Modify: `docs/superpowers/specs/2026-09-10-conversation-routing-design.md` only if implementation reveals a documented contract correction

- [ ] **Step 1: Run `npm test` and record the complete result.**
- [ ] **Step 2: Run `npm run typecheck` and record the complete result.**
- [ ] **Step 3: Run `npm run lint` and record the complete result.**
- [ ] **Step 4: Run `npm run build` and record the complete result.**
- [ ] **Step 5: Review `git diff` and verify no Embedded Signup or unrelated `.gitignore` changes were discarded.**
- [ ] **Step 6: If Supabase is available locally, run the migration and a two-agent manual scenario; otherwise report the database/E2E validation as an explicit remaining risk.**
