import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
} from "./defaults";

export interface InboundDealRecord {
  id: string;
  conversationId: string | null;
  status: "open" | "won" | "lost";
}

export interface InboundDealRepository {
  findOpenDeal(accountId: string, contactId: string): Promise<InboundDealRecord | null>;
  findOrCreateDefaultPipeline(
    accountId: string,
    userId: string,
  ): Promise<{ id: string } | null>;
  findFirstStage(pipelineId: string): Promise<{ id: string } | null>;
  touchDeal(input: {
    dealId: string;
    conversationId: string;
    activityAt: string;
  }): Promise<void>;
  createDeal(input: {
    account_id: string;
    user_id: string;
    pipeline_id: string;
    stage_id: string;
    contact_id: string;
    conversation_id: string;
    title: string;
    value: number;
    status: "open";
    auto_created_from_message: true;
    last_activity_at: string;
  }): Promise<{ id: string }>;
}

export interface EnsureInboundDealInput {
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  contactLabel: string;
  activityAt: string;
}

export type EnsureInboundDealResult =
  | { created: true; dealId: string }
  | { created: false; dealId: string }
  | { created: false; dealId: null; skippedReason: "no_pipeline" | "no_stage" };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function ensureInboundDeal(
  repository: InboundDealRepository,
  input: EnsureInboundDealInput,
): Promise<EnsureInboundDealResult> {
  const existing = await repository.findOpenDeal(input.accountId, input.contactId);
  if (existing) {
    await repository.touchDeal({
      dealId: existing.id,
      conversationId: existing.conversationId ?? input.conversationId,
      activityAt: input.activityAt,
    });
    return { created: false, dealId: existing.id };
  }

  const pipeline = await repository.findOrCreateDefaultPipeline(
    input.accountId,
    input.userId,
  );
  if (!pipeline) {
    return { created: false, dealId: null, skippedReason: "no_pipeline" };
  }

  const stage = await repository.findFirstStage(pipeline.id);
  if (!stage) {
    return { created: false, dealId: null, skippedReason: "no_stage" };
  }

  try {
    const deal = await repository.createDeal({
      account_id: input.accountId,
      user_id: input.userId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      title: input.contactLabel || "New lead",
      value: 0,
      status: "open",
      auto_created_from_message: true,
      last_activity_at: input.activityAt,
    });
    return { created: true, dealId: deal.id };
  } catch (error) {
    // Two webhook deliveries can arrive at the same time. The partial
    // unique index in the migration makes the second insert safe; it then
    // reuses the row created by the first delivery.
    if (!isUniqueViolation(error)) throw error;

    const concurrentDeal = await repository.findOpenDeal(
      input.accountId,
      input.contactId,
    );
    if (!concurrentDeal) throw error;

    await repository.touchDeal({
      dealId: concurrentDeal.id,
      conversationId: concurrentDeal.conversationId ?? input.conversationId,
      activityAt: input.activityAt,
    });
    return { created: false, dealId: concurrentDeal.id };
  }
}

type DealDatabase = SupabaseClient;

export function createSupabaseInboundDealRepository(
  db: DealDatabase,
): InboundDealRepository {
  async function ensureDefaultStages(pipelineId: string) {
    const { data: firstStage } = await db
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstStage) return;

    await db.from("pipeline_stages").insert(
      DEFAULT_PIPELINE_STAGES.map((stage) => ({
        pipeline_id: pipelineId,
        name: stage.name,
        color: stage.color,
        position: stage.position,
      })),
    );
  }

  return {
    async findOpenDeal(accountId, contactId) {
      const { data, error } = await db
        .from("deals")
        .select("id, conversation_id, status")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            id: data.id as string,
            conversationId: (data.conversation_id as string | null) ?? null,
            status: data.status as InboundDealRecord["status"],
          }
        : null;
    },

    async findOrCreateDefaultPipeline(accountId, userId) {
      const { data: existing, error: lookupError } = await db
        .from("pipelines")
        .select("id")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existing) {
        await ensureDefaultStages(existing.id as string);
        return { id: existing.id as string };
      }

      const { data: created, error: createError } = await db
        .from("pipelines")
        .insert({ account_id: accountId, user_id: userId, name: DEFAULT_PIPELINE_NAME })
        .select("id")
        .single();

      if (createError) {
        // A concurrent webhook may have created the account's first
        // pipeline. Re-read it before giving up.
        const { data: raced } = await db
          .from("pipelines")
          .select("id")
          .eq("account_id", accountId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!raced) throw createError;
        await ensureDefaultStages(raced.id as string);
        return { id: raced.id as string };
      }

      await ensureDefaultStages(created.id as string);
      return { id: created.id as string };
    },

    async findFirstStage(pipelineId) {
      const { data, error } = await db
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id as string } : null;
    },

    async touchDeal({ dealId, conversationId, activityAt }) {
      const { error } = await db
        .from("deals")
        .update({
          conversation_id: conversationId,
          last_activity_at: activityAt,
          updated_at: activityAt,
        })
        .eq("id", dealId);
      if (error) throw error;
    },

    async createDeal(input) {
      const { data, error } = await db
        .from("deals")
        .insert(input)
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
  };
}
