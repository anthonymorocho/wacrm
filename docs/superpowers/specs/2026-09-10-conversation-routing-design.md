# Automatic Conversation Routing Design

**Date:** 2026-09-10  
**Status:** Approved by the product owner for implementation planning

## Goal

Route new WhatsApp conversations to available team agents automatically,
respect a configurable active-conversation capacity, preserve ownership of
already handled work, show who sent each human reply, and expose the current
per-agent workload in the dashboard.

## Scope and product rules

- The assignment unit is a conversation, not an individual message.
- An agent explicitly chooses `online` or `offline` availability.
- Only account members with `owner`, `admin`, or `agent` roles are eligible
  for automatic assignment. `viewer` members remain read-only.
- A conversation with no assignee is queued. Incoming conversations stay in
  the queue while no eligible agent is available.
- New queued conversations are assigned oldest-first.
- The allocator chooses the eligible agent with the fewest active assigned
  conversations. Ties are resolved by rotating through the tied agents using
  their last assignment time.
- The account setting `max_active_conversations_per_agent` defaults to 400.
  Active means conversation status `open` or `pending`; `closed` rows do not
  consume capacity.
- A newly connected agent receives queued conversations but existing,
  already handled conversations are not rebalanced away from their owner.
- When an agent manually goes offline, only conversations awaiting a human
  reply are released. A conversation is awaiting a human reply when its most
  recent customer message is newer than its most recent human-agent message;
  bot messages do not count as human handling.
- When a browser disappears, the existing heartbeat staleness rule makes its
  presence offline. The next routing event releases any awaiting conversations
  owned by that stale agent before assigning the queue.
- An agent who is manually online but whose heartbeat is stale is not eligible
  for routing. An existing conversation with a human reply remains assigned.
- Manual assignment continues to be available to permitted users and is not
  overwritten by automatic routing unless the conversation is explicitly
  unassigned or released by the rules above.

## Existing code to extend

- `conversations.assigned_agent_id` already stores the current owner.
- `messages.sender_id` already exists but the human send path does not yet
  populate it consistently; the send core must receive the authenticated
  sender ID and persist it.
- `member_presence` plus `touch_presence()` and `PresenceHeartbeat` already
  provide account-scoped live presence and stale-tab detection. The feature
  adds a separate persisted availability flag rather than changing the
  existing online/away/offline display semantics.
- The existing `notifications` table and assignment trigger can notify an
  agent when a routing update assigns a conversation.
- The existing inbox realtime subscriptions already react to conversation and
  message changes.
- The dashboard currently aggregates client-side in
  `src/lib/dashboard/queries.ts`; the new workload query follows that pattern
  but keeps its account scoping and uses a compact grouped result.

## Architecture

### Availability and presence

Add an `availability` column to `member_presence` with values `online` and
`offline`, defaulting to `offline`. Keep the existing `status` column for
visual presence (`online` or `away`) and keep staleness as the derived
displayed `offline` state. `touch_presence()` updates heartbeat fields only,
so an old tab cannot overwrite a deliberate offline selection.

Add a security-definer `set_agent_availability(p_availability)` RPC. It derives
the caller's account from `profiles`, updates only the caller's availability,
and invokes the routing function in the same database transaction. Agents may
change their own availability; the account routing setting is admin/owner
only.

The dashboard shell mounts an availability control for the signed-in member.
The roster and inbox assignment dropdown reuse the existing presence query,
with availability included in the row shape. Automatic assignment checks both
manual availability and fresh heartbeat, while the existing away indicator
remains informational.

### Atomic allocator

Put assignment decisions in a database function, not in browser clients or
separate JavaScript count/update calls. The function receives an account ID,
locks the relevant queued conversations with `FOR UPDATE SKIP LOCKED`, and
locks/reads eligible member capacity in one transaction.

The allocator performs these operations in order:

1. Release assigned conversations whose agent is stale/offline and whose
   latest customer message still needs a human reply.
2. Read the account capacity setting.
3. Repeatedly select the oldest unassigned active conversation and the
   least-loaded eligible agent below capacity.
4. Update `assigned_agent_id` for each claim and let the existing assignment
   trigger create the notification.
5. Return the assignments made so the caller can refresh or report them.

The function is called after an inbound WhatsApp message, when an agent goes
online, when an agent goes offline, when a conversation is manually
unassigned, and when a conversation becomes closed. This covers queue release
without introducing a background worker. Realtime conversation updates keep
the inbox views in sync.

The allocator must not reassign conversations merely because a newly online
agent has fewer conversations. It only claims unassigned work or releases
unanswered work from unavailable agents.

### Inbound flow

After the webhook creates or updates the contact, conversation, and inbound
message, it calls the allocator for the config's account. The message insert
and the assignment decision remain account-scoped and use the service-role
client already required by the webhook. Existing automation, Flow, AI, and
deduplication behavior remains unchanged.

### Outbound attribution

The authenticated dashboard send route passes its `userId` to
`sendMessageToConversation`. The send core persists that ID as `messages.sender_id`
for manual text, media, template, and interactive messages. Automation sends
remain `sender_type = 'bot'` and do not appear as human-agent replies.

The inbox hydrates account member profiles and resolves `sender_id` to the
agent's display name. Outbound human bubbles show an agent label (for example,
`Anthony respondió`) while bot messages retain their AI/bot distinction.
Optimistic bubbles may show the current agent immediately and reconcile with
the persisted row through the existing realtime INSERT.

### Dashboard workload

Add an account-scoped workload query that returns every eligible team member,
their availability/presence, active assigned count, configured capacity, and
remaining capacity. Include members with zero conversations so the dashboard
shows all agents rather than only agents found through a grouped conversation
query.

Add a dashboard card/section for “Agent workload” with live-enough refresh on
initial load and realtime/resync events already used by the dashboard. Keep
historical charts unchanged; this widget is a current snapshot, not a report
of historical assignment time.

### Settings

Add an admin-only setting under team/workspace settings for
`max_active_conversations_per_agent`. Validate an integer greater than zero,
use 400 as the default, and save it through an account-scoped server route or
RPC. The server enforces the same constraint; the UI is not a trust boundary.

Add each member's availability control to the shared dashboard header or
profile area. The control calls the self-only RPC and shows the persisted
state, while the existing Members tab continues to show presence details.

## Data model and security

Migration adds:

- `accounts.max_active_conversations_per_agent integer NOT NULL DEFAULT 400`
  with a positive-value check and an account index only if needed by the
  chosen query plan.
- `member_presence.availability text NOT NULL DEFAULT 'offline'` with an
  `online`/`offline` check.
- Supporting indexes for active conversations by account/assignee/status and
  the latest message lookup used by release decisions.
- Security-definer RPCs for self availability and atomic routing, with
  `search_path = public`, explicit caller/account checks, and restricted
  execute grants.
- Realtime remains enabled for `member_presence` and `conversations`.

All client reads remain protected by account membership RLS. Clients never
provide an account ID to determine tenancy, an agent ID to impersonate a
presence update, or a capacity value to bypass the configured limit. Automatic
assignment uses service-side/database authorization because inbound webhooks
have no authenticated browser user.

Migration rollout is additive. Existing conversations with a null assignee
remain queued; existing assignments are preserved. Existing presence rows
start unavailable until each agent selects online, which prevents a deployment
from unexpectedly routing new work to stale tabs. The migration is reversible
by removing the new column/function objects after traffic is stopped, but
conversation assignment values are intentionally not destructively rewritten.

## Error handling and edge cases

- No online, fresh, below-capacity agent: leave the conversation unassigned.
- All agents at capacity: leave the conversation queued and show the queued
  count in workload/dashboard surfaces.
- Concurrent inbound webhooks: row locks and `SKIP LOCKED` prevent duplicate
  claims; the next allocator invocation drains any remaining queue.
- Repeated webhook delivery: existing WhatsApp message-id deduplication must
  remain authoritative; routing must run only after the canonical message
  path.
- Agent goes offline after a claim but before responding: the next routing
  event releases the unanswered conversation; it is not silently lost.
- Manual reassignment to an offline agent remains allowed for an explicit
  manager action, but automatic routing never chooses that agent.
- If `sender_id` is missing on legacy messages, the UI displays a neutral
  “Agent” label rather than guessing from the conversation owner.
- Viewer and unauthorized users cannot alter availability, assignments, or
  capacity.

## Testing strategy

Pure routing helpers will cover:

- active-count calculation,
- capacity eligibility,
- least-load selection and tie rotation,
- FIFO queue ordering,
- latest-customer-vs-latest-human-reply detection,
- stale/offline release rules.

Database/API tests will cover:

- self-only availability updates,
- account isolation,
- capacity validation and admin-only settings,
- atomic assignment under concurrent claims,
- inbound webhook assignment and no-agent queue behavior,
- reassignment on offline only for unanswered conversations,
- preservation of answered conversations,
- sender ID persistence for every manual send type,
- dashboard workload counts including zero-load agents.

UI tests will cover:

- availability toggle state and error rollback,
- disabled/free queue indicators,
- agent attribution in message bubbles,
- template-independent inbox behavior,
- workload widget rendering and capacity display.

Verification will include the focused tests, typecheck, lint, production
build, and an end-to-end manual scenario with two agents: zero online, one
online, second online, one agent at capacity, disconnect before reply, and a
customer response that opens a fresh assignment opportunity.

## Out of scope

- Rebalancing already handled conversations whenever a new agent connects.
- Historical SLA/agent performance reports.
- A separate assignment-history table; current ownership plus sender-of-record
  satisfies the requested control for this slice.
- Bypassing WhatsApp's 24-hour window or template rules.
- Replacing the existing manual Cloud API/Embedded Signup configuration.
