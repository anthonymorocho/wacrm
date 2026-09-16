# Meta Messaging Inbound Design

## Goal

Receive text and basic attachment messages sent to a configured Instagram professional account or Facebook Page, persist them in the existing CRM conversation model, and show them in the existing Inbox without changing the current WhatsApp webhook or send path.

## Scope

Included:

- A separate account-scoped configuration for Instagram and Messenger credentials.
- A separate Meta webhook route at `/api/meta/webhook` with GET verification and signed POST handling.
- Normalization of Meta `instagram` and `page` messaging payloads into the existing `contacts`, `conversations`, and `messages` tables.
- External sender identity storage so a social sender does not need a phone number.
- Inbox visibility through the existing Supabase Realtime subscriptions.
- Settings UI for saving and removing the two channel configurations.

Not included:

- Sending replies from the CRM to Instagram or Messenger.
- Instagram/Messenger broadcasts, templates, reactions, or read/delivery status handling.
- Changes to `/api/whatsapp/webhook`, `/api/whatsapp/send`, `whatsapp_config`, or WhatsApp automation behavior.

## Architecture

WhatsApp remains on its existing route and schema contract. Instagram and Messenger use a new route and new `meta_channels` configuration table, then enter the shared operational tables only after their provider-specific payload has been validated and normalized.

Each social sender is represented by `meta_contact_identities(channel_id, external_user_id)`. A social contact may have a null phone, while existing WhatsApp contacts remain unchanged. The identity table is the deduplication boundary; the current one-conversation-per-account/contact invariant remains intact because each external channel identity owns one CRM contact.

The new webhook acknowledges Meta quickly with `after()`, validates the raw-body HMAC before JSON processing, ignores echo events, and treats duplicate `(channel_id, provider_message_id)` inserts as successful replays rather than creating a second message.

## Data flow

```text
Meta Instagram/Page webhook
  -> /api/meta/webhook GET/POST
  -> HMAC + channel lookup
  -> normalizeMetaMessagingPayload()
  -> meta_contact_identities -> contacts
  -> conversations
  -> messages
  -> existing Supabase Realtime Inbox
```

## Safety invariants

1. The WhatsApp route and outbound endpoints are not modified.
2. All new secrets are encrypted before persistence and are never returned to the browser.
3. A webhook is accepted only when its signature matches the app secret belonging to the channel identified by the entry ID.
4. Social identities are unique per configured channel and provider sender ID.
5. Social message IDs are unique per configured channel, so Meta retries cannot duplicate a message.
6. Database writes are account-scoped and use the same routing/unread/deal behavior as an inbound CRM message where the shared helper already owns it.
7. Existing rows and WhatsApp defaults are preserved by additive migration defaults.

## Acceptance criteria

- Existing WhatsApp unit tests continue to pass unchanged.
- Valid Messenger text payloads create one contact, one conversation, and one customer message.
- Valid Instagram text payloads create the same normalized records with `channel = 'instagram'`.
- Replaying the same provider message ID does not create a second message.
- Invalid signatures, unsupported objects, echo events, and entries for unknown channels do not create records.
- A social contact can be stored without a phone number and remains visible by name/ID in the Inbox.
- An administrator can save/remove channel configuration from Settings.
- The project typecheck, lint, focused tests, and production build complete successfully.

