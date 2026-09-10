# WhatsApp Embedded Signup Design

**Date:** 2026-09-10

**Status:** Proposed

## Goal

Add WhatsApp Embedded Signup as a second connection path in the existing CRM
without replacing the current manual WhatsApp configuration, changing account
tenancy, or introducing an unofficial WhatsApp transport.

## Context and invariants

- The CRM uses the official Meta Cloud API directly through
  `graph.facebook.com`.
- `whatsapp_config` is one row per CRM account. The existing unique account
  constraint and phone-number ownership check remain authoritative.
- Access tokens, verify tokens, and Meta App Secrets are encrypted before they
  are stored. Plaintext credentials must never be returned to the browser or
  logged.
- WhatsApp settings are admin-only. The Embedded Signup exchange must enforce
  the same account role on the server, not rely on a client-side UI gate.
- The existing webhook remains the inbound endpoint and must continue to verify
  Meta's HMAC signature.
- The existing manual path remains available for installations that do not
  configure Embedded Signup.

## Recommended architecture

The deployment owner configures one Meta app for the CRM installation through
server environment variables:

```env
META_APP_ID=...
META_APP_SECRET=...
META_EMBEDDED_SIGNUP_CONFIG_ID=...
```

The browser receives only the App ID and Embedded Signup configuration ID from
an authenticated configuration endpoint. The App Secret stays server-only.

The settings UI loads the Facebook SDK only on the WhatsApp settings screen and
launches the configured WhatsApp Embedded Signup flow. The SDK callback yields
a short-lived authorization code; the session message supplies the selected
WABA and phone number IDs. The browser sends those values to the authenticated
server endpoint only as onboarding context.

The server then:

1. Validates the request shape and requires an account admin session.
2. Exchanges the authorization code with Meta using the server-only App ID and
   App Secret.
3. Validates the WABA and phone number against Meta using the returned token;
   browser-supplied IDs are never trusted without this check.
4. Reuses the existing WhatsApp connection path to verify phone metadata,
   register the phone number when a PIN is available, subscribe the WABA to the
   app, encrypt the token, and upsert the account's `whatsapp_config` row.
5. Stores the token expiry timestamp returned by Meta. If the token expires,
   the UI reports that the account must reconnect through Embedded Signup;
   this version does not invent a refresh flow whose availability depends on
   Meta's token type and configuration.

## Planned units

- `src/lib/whatsapp/embedded-signup.ts`: typed Meta code exchange, payload
  validation, and WABA/phone validation helpers. No database access.
- `src/lib/whatsapp/configure.ts`: shared account-level persistence and Meta
  connection finalization used by both manual configuration and Embedded
  Signup, preventing the two paths from drifting.
- `src/app/api/whatsapp/embedded-signup/route.ts`: authenticated GET for safe
  public configuration and authenticated POST for code exchange and connect.
- `src/components/settings/whatsapp-embedded-signup.tsx`: client-only SDK
  launcher, session message handling, loading/error/success states, and
  accessible connect button.
- `src/components/settings/whatsapp-config.tsx`: render the Embedded Signup
  action alongside the existing manual form and refresh the account state after
  success.
- `src/types/facebook-sdk.d.ts`: minimal types for the Facebook SDK globals.
- `supabase/migrations/039_whatsapp_token_expiry.sql`: nullable
  `token_expires_at` column so existing manual configurations remain valid.
- `.env.local.example`: document the two existing Meta credentials and the new
  Embedded Signup configuration ID.
- `next.config.ts`: allow the Facebook SDK and its expected frame/connect
  origins in the existing report-only CSP.

## Security and error behavior

- Reject missing, non-string, or overlong authorization codes and IDs with
  `400`.
- Return `401` for unauthenticated requests and `403` for non-admin users.
- Rate-limit the exchange endpoint using the existing admin action limiter.
- Do not include access tokens, App Secrets, authorization codes, or raw Meta
  responses in logs or JSON responses.
- Accept `postMessage` session data only from Meta's allowed origin and only for
  the expected Embedded Signup message type.
- A Meta exchange or validation failure returns an actionable error while
  leaving the existing configuration untouched.
- A phone already owned by another CRM account keeps the existing `409`
  conflict behavior.
- If Meta returns a successful token but final persistence fails, return an
  error without claiming the connection is complete; the user can retry the
  flow.
- The UI must distinguish "authorization cancelled", "Meta rejected the
  connection", and "connected but requires reconnection before token expiry".

## Acceptance criteria

1. An admin can open WhatsApp settings and launch Embedded Signup when the
   three server variables are configured.
2. A successful Meta flow creates or updates the current account's existing
   `whatsapp_config` row with the validated WABA/phone IDs and encrypted token.
3. The existing registration and WABA subscription steps still run, so the
   resulting number is usable by the existing inbox and webhook.
4. A non-admin cannot obtain the public onboarding configuration or exchange a
   code.
5. Invalid or cancelled flows do not overwrite an existing working connection.
6. The manual setup path continues to work unchanged.
7. Unit tests cover code exchange, validation, origin filtering, conflict/error
   responses, token expiry persistence, and the shared finalization path.
8. `npm run typecheck`, focused Vitest tests, `npm run lint`, and `npm run build`
   complete successfully before the feature is reported as complete.

## Non-goals

- Evolution API, Baileys, QR-session WhatsApp Web, or any unofficial transport.
- Multiple WhatsApp numbers per CRM account.
- Per-customer Meta applications and App Secrets.
- Automatic token refresh without a verified Meta-supported refresh contract.
- Replacing the current webhook or message-processing engine.

