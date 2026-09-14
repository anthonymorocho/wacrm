import { describe, it, expect } from "vitest";
import {
  filterVisibleConversations,
  getConversationAssignmentKind,
  isConversationVisibleToUser,
  isActiveInboxConversation,
  isQueuedInboxConversation,
  matchesContactFilters,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("isActiveInboxConversation", () => {
  it("includes only open or pending conversations with an assigned agent", () => {
    expect(
      isActiveInboxConversation({
        ...makeConversation(null),
        assigned_agent_id: "agent-1",
      }),
    ).toBe(true);
    expect(
      isActiveInboxConversation({
        ...makeConversation(null),
        status: "pending",
        assigned_agent_id: "agent-1",
      }),
    ).toBe(true);
    expect(
      isActiveInboxConversation({ ...makeConversation(null), status: "closed" }),
    ).toBe(false);
    expect(isActiveInboxConversation(makeConversation(null))).toBe(false);
  });
});

describe("isQueuedInboxConversation", () => {
  it("includes only non-closed conversations without an assigned agent", () => {
    expect(isQueuedInboxConversation(makeConversation(null))).toBe(true);
    expect(
      isQueuedInboxConversation({
        ...makeConversation(null),
        status: "pending",
      }),
    ).toBe(true);
    expect(
      isQueuedInboxConversation({
        ...makeConversation(null),
        assigned_agent_id: "agent-1",
      }),
    ).toBe(false);
    expect(
      isQueuedInboxConversation({ ...makeConversation(null), status: "closed" }),
    ).toBe(false);
  });
});

describe("conversation visibility", () => {
  it("lets owners and admins see assigned and queued conversations", () => {
    const assigned = { ...makeConversation(null), assigned_agent_id: "agent-1" };
    const queued = makeConversation(null);

    expect(isConversationVisibleToUser(assigned, "owner", "owner-1")).toBe(true);
    expect(isConversationVisibleToUser(queued, "admin", "admin-1")).toBe(true);
    expect(filterVisibleConversations([assigned, queued], "admin", "admin-1"))
      .toHaveLength(2);
  });

  it("lets an agent see their assignments and the shared queue", () => {
    const mine = { ...makeConversation(null), assigned_agent_id: "agent-1" };
    const theirs = { ...makeConversation(null), id: "c2", assigned_agent_id: "agent-2" };
    const queued = { ...makeConversation(null), id: "c3" };

    expect(isConversationVisibleToUser(mine, "agent", "agent-1")).toBe(true);
    expect(isConversationVisibleToUser(theirs, "agent", "agent-1")).toBe(false);
    expect(isConversationVisibleToUser(queued, "agent", "agent-1")).toBe(true);
    expect(filterVisibleConversations([mine, theirs, queued], "agent", "agent-1"))
      .toEqual([mine, queued]);
  });

  it("lets viewer roles see queued conversations but not assigned conversations", () => {
    const mine = { ...makeConversation(null), assigned_agent_id: "agent-1" };
    const queued = makeConversation(null);
    const closedQueued = { ...queued, id: "c3", status: "closed" as const };

    expect(isConversationVisibleToUser(mine, "viewer", "viewer-1")).toBe(false);
    expect(isConversationVisibleToUser(queued, "viewer", "viewer-1")).toBe(true);
    expect(isConversationVisibleToUser(closedQueued, "viewer", "viewer-1")).toBe(false);
    expect(isConversationVisibleToUser(closedQueued, "admin", "admin-1")).toBe(true);
    expect(filterVisibleConversations([mine, queued], "viewer", "viewer-1"))
      .toEqual([queued]);
    expect(filterVisibleConversations([queued, closedQueued], "viewer", "viewer-1"))
      .toEqual([queued]);
  });
});

describe("conversation assignment kind", () => {
  it("marks a conversation as transferred permanently after its first transfer", () => {
    expect(getConversationAssignmentKind({ was_transferred: false })).toBe("owned");
    expect(getConversationAssignmentKind({ was_transferred: true })).toBe("transferred");

    // Returning to the initial agent does not turn the conversation back into
    // an owned conversation; the database flag is historical by design.
    expect(getConversationAssignmentKind({ was_transferred: true })).toBe(
      "transferred",
    );
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});
