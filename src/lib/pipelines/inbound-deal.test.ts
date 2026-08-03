import { describe, expect, it } from "vitest";
import {
  ensureInboundDeal,
  type InboundDealRepository,
} from "./inbound-deal";

function createFakeRepository(
  initialDeal?: {
    id: string;
    conversationId?: string | null;
    status?: "open" | "won" | "lost";
  },
): InboundDealRepository & {
  created: Array<Record<string, unknown>>;
  touched: Array<Record<string, unknown>>;
} {
  let deal = initialDeal
    ? {
        id: initialDeal.id,
        conversationId: initialDeal.conversationId ?? null,
        status: initialDeal.status ?? "open",
      }
    : null;
  const created: Array<Record<string, unknown>> = [];
  const touched: Array<Record<string, unknown>> = [];

  return {
    created,
    touched,
    async findOpenDeal() {
      return deal?.status === "open" ? deal : null;
    },
    async findOrCreateDefaultPipeline() {
      return { id: "pipeline-1" };
    },
    async findFirstStage() {
      return { id: "stage-new-lead" };
    },
    async touchDeal(input) {
      touched.push(input);
      if (deal) deal.conversationId = input.conversationId;
    },
    async createDeal(input) {
      created.push(input);
      deal = {
        id: "deal-created",
        conversationId: input.conversation_id,
        status: "open",
      };
      return { id: "deal-created" };
    },
  };
}

describe("ensureInboundDeal", () => {
  it("creates one open deal in the first stage for a new inbound conversation", async () => {
    const repository = createFakeRepository();

    const result = await ensureInboundDeal(repository, {
      accountId: "account-1",
      userId: "user-1",
      contactId: "contact-1",
      conversationId: "conversation-1",
      contactLabel: "Ana Pérez",
      activityAt: "2026-08-03T15:00:00.000Z",
    });

    expect(result).toEqual({ created: true, dealId: "deal-created" });
    expect(repository.created).toHaveLength(1);
    expect(repository.created[0]).toMatchObject({
      account_id: "account-1",
      user_id: "user-1",
      pipeline_id: "pipeline-1",
      stage_id: "stage-new-lead",
      contact_id: "contact-1",
      conversation_id: "conversation-1",
      title: "Ana Pérez",
      value: 0,
      status: "open",
      auto_created_from_message: true,
      last_activity_at: "2026-08-03T15:00:00.000Z",
    });
  });

  it("updates activity instead of creating a duplicate for an existing open deal", async () => {
    const repository = createFakeRepository({ id: "deal-existing" });

    const result = await ensureInboundDeal(repository, {
      accountId: "account-1",
      userId: "user-1",
      contactId: "contact-1",
      conversationId: "conversation-1",
      contactLabel: "Ana Pérez",
      activityAt: "2026-08-03T15:05:00.000Z",
    });

    expect(result).toEqual({ created: false, dealId: "deal-existing" });
    expect(repository.created).toHaveLength(0);
    expect(repository.touched).toEqual([
      {
        dealId: "deal-existing",
        conversationId: "conversation-1",
        activityAt: "2026-08-03T15:05:00.000Z",
      },
    ]);
  });
});
