import type { Conversation, Contact, Tag } from "@/types";
import type { AccountRole } from "@/lib/auth/roles";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

/**
 * Apply message activity to an existing inbox row and move it to the top.
 * Realtime can deliver events out of order, so an older event is ignored
 * instead of overwriting the latest preview or changing its position.
 */
export function updateConversationActivity(
  conversations: Conversation[],
  conversationId: string,
  activityAt: string,
  patch: Partial<Conversation> = {},
): Conversation[] {
  const index = conversations.findIndex((item) => item.id === conversationId);
  if (index < 0) return conversations;

  const current = conversations[index];
  const incomingTime = Date.parse(activityAt);
  const currentTime = Date.parse(
    current.last_message_at ?? current.updated_at ?? current.created_at,
  );
  if (
    Number.isFinite(incomingTime) &&
    Number.isFinite(currentTime) &&
    incomingTime < currentTime
  ) {
    return conversations;
  }

  const updated = {
    ...current,
    ...patch,
    last_message_at: activityAt,
  };
  return [updated, ...conversations.slice(0, index), ...conversations.slice(index + 1)];
}

/**
 * Active Inbox work is limited to open/pending conversations that already
 * have an agent. Unassigned work belongs in the explicit queue view.
 */
export function isActiveInboxConversation(
  conversation: Pick<Conversation, "status" | "assigned_agent_id">,
): boolean {
  return (
    conversation.status !== "closed" &&
    Boolean(conversation.assigned_agent_id)
  );
}

/** Queued work is open/pending and waiting for an eligible agent. */
export function isQueuedInboxConversation(
  conversation: Pick<Conversation, "status" | "assigned_agent_id">,
): boolean {
  return conversation.status !== "closed" && !conversation.assigned_agent_id;
}

/**
 * Enforce the inbox's visibility boundary in the client as well as in RLS.
 * Owners/admins have the operational overview; agents only see their current
 * assignments; viewers do not participate in the inbox.
 */
export function isConversationVisibleToUser(
  conversation: Pick<Conversation, "assigned_agent_id">,
  role: AccountRole | null,
  userId: string | null,
): boolean {
  if (role === "owner" || role === "admin") return true;
  return role === "agent" && Boolean(userId) && conversation.assigned_agent_id === userId;
}

export function filterVisibleConversations(
  conversations: Conversation[],
  role: AccountRole | null,
  userId: string | null,
): Conversation[] {
  return conversations.filter((conversation) =>
    isConversationVisibleToUser(conversation, role, userId),
  );
}

export type ConversationAssignmentKind = "owned" | "transferred";

/**
 * Assignment history is intentionally sticky. A transferred conversation
 * remains in the transferred bucket even when it is returned to its initial
 * agent, so the inbox preserves the hand-off audit signal.
 */
export function getConversationAssignmentKind(
  conversation: Pick<Conversation, "was_transferred">,
): ConversationAssignmentKind {
  return conversation.was_transferred ? "transferred" : "owned";
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
