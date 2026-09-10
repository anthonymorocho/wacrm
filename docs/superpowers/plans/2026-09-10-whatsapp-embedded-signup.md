# WhatsApp Embedded Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meta WhatsApp Embedded Signup as a secure second connection path while preserving the existing manual WhatsApp configuration and webhook behavior.

**Architecture:** Keep one Meta app per CRM installation, configured with server-only environment variables. The browser receives only the App ID and Embedded Signup configuration ID, launches Meta's SDK, and sends the short-lived authorization code plus onboarding context to an admin-only route. The server exchanges and validates the code, then uses a shared finalization helper to encrypt and persist the token and execute the existing phone registration/WABA subscription steps.

**Tech Stack:** Next.js 16 Route Handlers, React 19 client component, Supabase SSR/service-role clients, Meta Graph API v21.0, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-10-whatsapp-embedded-signup-design.md`

## Global Constraints

- Keep manual WhatsApp configuration available and behavior-compatible.
- App Secret, access tokens, and authorization codes remain server-only and are never logged or returned.
- Embedded Signup configuration is available only to authenticated account admins.
- Validate every browser-supplied WABA and phone ID against Meta before persistence.
- Preserve one WhatsApp configuration per CRM account and the existing phone-number conflict behavior.
- Do not add Evolution API, Baileys, QR sessions, automatic token refresh, or multiple numbers per account.
- Run focused tests, `npm run typecheck`, `npm run lint`, and `npm run build` before reporting completion.

---

### Task 1: Establish the Meta Embedded Signup domain helpers

**Files:**
- Create: `src/lib/whatsapp/embedded-signup.ts`
- Test: `src/lib/whatsapp/embedded-signup.test.ts`
- Modify: `src/lib/whatsapp/meta-api.ts` only if a small typed helper is needed for the existing API boundary

**Interfaces:**
- Produces `validateEmbeddedSignupPayload(input: unknown): EmbeddedSignupPayload` and `exchangeEmbeddedSignupCode(args: { code: string; appId: string; appSecret: string }): Promise<EmbeddedSignupToken>`.
- Produces `validateEmbeddedSignupMetaData(args: { accessToken: string; wabaId: string; phoneNumberId: string }): Promise<EmbeddedSignupMetaData>`.
- The helpers throw typed, safe validation errors for malformed input and collapse Meta failures to actionable messages without exposing raw responses.

- [ ] **Step 1: Write failing tests** for rejecting absent/non-string/overlong code and IDs, accepting a valid payload, exchanging a code with `redirect_uri` omitted, extracting `access_token` and `expires_in`, and validating the selected WABA plus phone number with Meta requests.
- [ ] **Step 2: Run `npm test -- src/lib/whatsapp/embedded-signup.test.ts` and confirm the tests fail because the helpers do not exist.**
- [ ] **Step 3: Implement the smallest helpers using the existing Graph API version, a strict maximum length, `fetch`, and safe response parsing. Validate that the phone response belongs to the requested WABA before returning.
- [ ] **Step 4: Run the focused test again and confirm all helper tests pass.**
- [ ] **Step 5: Refactor only after green so Meta response parsing and error sanitization are shared rather than duplicated.**

### Task 2: Add shared secure WhatsApp finalization and token expiry persistence

**Files:**
- Create: `src/lib/whatsapp/configure.ts`
- Create: `supabase/migrations/039_whatsapp_token_expiry.sql`
- Modify: `src/types/index.ts`
- Test: `src/lib/whatsapp/configure.test.ts`

**Interfaces:**
- Produces `finalizeWhatsAppConfiguration(args: { supabase: SupabaseClient; supabaseAdmin: SupabaseClient; accountId: string; userId: string; phoneNumberId: string; wabaId: string | null; accessToken: string; verifyToken?: string | null; pin?: string | null; tokenExpiresAt?: string | null; appSecret?: string | null }): Promise<FinalizeWhatsAppConfigurationResult>`.
- The result reports `phoneInfo`, `registered`, `registrationSkipped`, `registrationError`, and `saved`, without returning credentials.
- Both manual POST and Embedded Signup use this helper for ownership checks, Meta verification/registration/subscription, encryption, and account-row upsert.

- [ ] **Step 1: Write failing tests** for encrypted persistence, token expiry persistence, successful registration/subscription, best-effort registration failure, and rejection when another account owns the phone number.
- [ ] **Step 2: Run `npm test -- src/lib/whatsapp/configure.test.ts` and confirm the tests fail because the shared finalizer does not exist.**
- [ ] **Step 3: Add the nullable `token_expires_at` migration and type field; implement the helper by extracting the current manual route's proven behavior without changing its public response semantics.
- [ ] **Step 4: Update the manual config POST to call the helper and map its result to the existing response shape; preserve the existing initial App Secret requirement and token re-entry behavior.
- [ ] **Step 5: Run focused configuration tests and the existing WhatsApp route tests, then refactor only while green.**

### Task 3: Add authenticated Embedded Signup API routes

**Files:**
- Create: `src/app/api/whatsapp/embedded-signup/route.ts`
- Test: `src/app/api/whatsapp/embedded-signup/route.test.ts`
- Modify: `src/lib/rate-limit.ts` only if the existing admin-action limiter needs a route-specific key

**Interfaces:**
- `GET /api/whatsapp/embedded-signup` returns `{ app_id, config_id }` only after `requireRole('admin')`; missing server configuration returns a safe `404`/configuration error.
- `POST /api/whatsapp/embedded-signup` accepts `{ code, waba_id, phone_number_id, pin?, verify_token? }`, performs authorization, rate limiting, code exchange, Meta validation, and shared finalization, and returns only connection status/phone metadata.
- Unauthorized requests return `401`, non-admin requests `403`, malformed input `400`, phone conflicts `409`, and unexpected failures `500` through the existing auth/error patterns.

- [ ] **Step 1: Write failing route tests** for unauthenticated/admin authorization, safe GET output, missing environment configuration, malformed POST, Meta exchange failure, conflict propagation, and successful persistence without token leakage.
- [ ] **Step 2: Run the focused route tests and confirm they fail because the route does not exist.**
- [ ] **Step 3: Implement GET/POST with `requireRole('admin')`, the existing limiter, server-only App Secret, safe logging, and the helper contracts from Tasks 1–2.
- [ ] **Step 4: Run the focused route tests and confirm they pass; verify response bodies do not contain code, token, or secret values.**

### Task 4: Add the client Embedded Signup launcher and settings integration

**Files:**
- Create: `src/components/settings/whatsapp-embedded-signup.tsx`
- Create: `src/types/facebook-sdk.d.ts`
- Modify: `src/components/settings/whatsapp-config.tsx`
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ko.json`

**Interfaces:**
- The client component receives `onConnected: () => Promise<void>` and renders an accessible connect button only when the authenticated route exposes configuration.
- It loads the Facebook SDK on demand, calls `FB.login` with `config_id`, `response_type: 'code'`, and `override_default_response_type: true`, validates `postMessage` origin/type, distinguishes cancellation, Meta rejection, and success, then POSTs only onboarding context to the server.
- Existing manual form state and controls remain unchanged apart from rendering the new action beside them.

- [ ] **Step 1: Write focused client tests or type-level compile fixtures for the message-origin filter, cancellation state, and success callback contract before production component code.**
- [ ] **Step 2: Run the focused client test and confirm it fails because the launcher does not exist.**
- [ ] **Step 3: Implement the launcher with runtime GET configuration, cleanup of message listeners, disabled/loading states, accessible labels, and no credential fields.
- [ ] **Step 4: Render it in WhatsApp settings and refresh the existing config after a successful connection; add localized strings in all three locale files.
- [ ] **Step 5: Run the focused UI test and typecheck; confirm the manual path remains available in the rendered component.**

### Task 5: Configure Meta browser policy and run full verification

**Files:**
- Modify: `.env.local.example`
- Modify: `next.config.ts`

- [ ] **Step 1: Add `META_APP_ID`, `META_APP_SECRET`, and `META_EMBEDDED_SIGNUP_CONFIG_ID` documentation without placing real credentials in the repository.**
- [ ] **Step 2: Extend the existing report-only CSP with the Facebook SDK script, Meta frame, and Meta connect origins required by Embedded Signup while leaving server-side Graph calls out of `connect-src`.**
- [ ] **Step 3: Run `npm test` and confirm zero failures.**
- [ ] **Step 4: Run `npm run typecheck` and confirm exit code 0.**
- [ ] **Step 5: Run `npm run lint` and confirm exit code 0.**
- [ ] **Step 6: Run `npm run build` and confirm exit code 0.**
- [ ] **Step 7: Review `git diff`, confirm `.gitignore` remains untouched, confirm no secrets are present, and report any real Meta-environment verification still requiring the user's configured App Secret.**

## Self-review

- The plan covers server configuration delivery, code exchange, Meta validation, secure persistence, expiry storage, admin authorization, rate limiting, origin filtering, UI states, localization, CSP, manual compatibility, and all acceptance-test commands from the approved specification.
- No production file is added before its focused failing test, except the migration, environment example, CSP, and SDK declaration, which are configuration/type artifacts covered by later integration checks.
- All referenced functions and response responsibilities are defined in the task interfaces before use.
