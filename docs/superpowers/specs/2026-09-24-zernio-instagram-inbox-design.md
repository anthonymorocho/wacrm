# Zernio Instagram Inbox Design

## Goal

Use the existing Zernio profile and credentials to receive Instagram direct messages and post comments in WACRM, then let agents reply from WACRM through the Zernio API without configuring a customer-owned Meta app.

## Scope

- Connect one Instagram account alongside the existing Facebook Page under the same WACRM account's Zernio profile.
- Receive signed `message.received` and `comment.received` webhooks for Instagram.
- Store Instagram DMs in the existing social contacts, conversations, and messages flow; show them in the existing Inbox.
- Mirror organic Instagram posts with comments in the existing Comments page.
- Send text DM replies and public comment replies from WACRM using Zernio's inbox API.
- Keep existing Facebook Messenger and WhatsApp behavior intact.

Out of scope: Meta credentials or a customer-owned Meta app, media/interactive DM replies, Instagram ad/dark-post comments, private comment-to-DM replies, comment automation, and reactions.

## Architecture

Each WACRM account keeps its single Zernio profile and webhook secret. `zernio_connections` becomes one row per `(account_id, provider)` and maps each Zernio account ID to its existing `meta_channels` row. The migration backfills existing rows as `messenger`; old connection and message history stays attached to its channel.

The Zernio callback identifies the connected platform (`facebook` or `instagram`). Facebook continues resolving its selected Page through Zernio. Instagram uses the callback's Zernio account ID as the Zernio-backed channel's external account key and its returned username for display.

Signed webhook events are matched to both the configured Zernio profile and unique account ID before processing. Instagram DMs normalize into the existing `MetaChannelProvider = 'instagram'` pipeline. The shared message-ID uniqueness boundary prevents retries from creating duplicate messages. Instagram comment events and API syncs store `platform = 'instagram'` in the existing comments tables.

Outbound DM transport resolves the Zernio connection from the conversation's channel. Comment replies resolve the connection from the account-owned mirrored post. Both continue to validate ownership in WACRM and use Zernio idempotency keys.

## Provider and platform mapping

| WACRM channel | Zernio platform | CRM surface |
| --- | --- | --- |
| `messenger` | `facebook` | Inbox and Comments |
| `instagram` | `instagram` | Inbox and Comments |

## Safety invariants

1. A WACRM tenant has at most one connected Zernio account per channel provider, while Facebook and Instagram can coexist under its one Zernio profile.
2. A Zernio account ID maps to at most one WACRM tenant and one CRM channel.
3. Webhook signatures are verified against the secret belonging to the payload's exact Zernio profile before event processing.
4. A webhook's platform must match the mapped channel provider; mismatched and unsupported events are ignored.
5. DM and comment replies use account-owned CRM records to select the remote connection; user-supplied IDs never select another tenant's Zernio account.
6. Existing Facebook and WhatsApp routes, schema semantics, and message paths remain compatible.
7. The migration is additive for history: existing Messenger rows become explicitly typed, and comment platform checks accept both Facebook and Instagram.

## Acceptance criteria

- An administrator can connect Instagram from Settings without replacing the Facebook connection.
- Valid Instagram inbound DMs appear in the CRM Inbox and duplicate webhook deliveries do not duplicate messages or unread increments.
- An agent can send a text reply from the CRM Inbox through the mapped Instagram Zernio account.
- Instagram post comments appear in the CRM Comments page and are visually distinguishable from Facebook comments.
- An agent can post a public reply to an account-owned Instagram comment from that page through Zernio.
- Invalid signatures, mismatched providers/accounts, and comments outside the tenant's mirrored records cannot cause writes or external replies.
- Focused tests and typecheck pass; a production build is run if local configuration permits it.
