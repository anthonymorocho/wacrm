import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SLA_THRESHOLDS, type SlaThresholds } from './sla';

type DB = SupabaseClient;

export interface SlaAgentMetric {
  agentId: string;
  totalConversations: number;
  averageMinutes: number | null;
  optimalCount: number;
  idealCount: number;
  lowCount: number;
  pendingCount: number;
  customerNames: string[];
  pendingCustomerNames: string[];
}

interface SlaAgentMetricRow {
  agent_id: string;
  total_conversations: number;
  average_minutes: number | null;
  optimal_count: number;
  ideal_count: number;
  low_count: number;
  pending_count: number;
  customer_names: string[] | null;
  pending_customer_names: string[] | null;
}

interface SlaThresholdRow {
  optimal_minutes: number;
  low_minutes: number;
}

export async function loadSlaThresholds(
  db: DB,
  accountId: string
): Promise<SlaThresholds> {
  const { data, error } = await db
    .from('account_sla_settings')
    .select('optimal_minutes, low_minutes')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_SLA_THRESHOLDS;

  const row = data as SlaThresholdRow;
  return {
    optimalMinutes: Number(row.optimal_minutes),
    lowMinutes: Number(row.low_minutes),
  };
}

export async function saveSlaThresholds(
  db: DB,
  accountId: string,
  thresholds: SlaThresholds
): Promise<void> {
  const { error } = await db.from('account_sla_settings').upsert(
    {
      account_id: accountId,
      optimal_minutes: thresholds.optimalMinutes,
      low_minutes: thresholds.lowMinutes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' }
  );

  if (error) throw error;
}

export async function loadSlaAgentMetrics(
  db: DB,
  from: string,
  to: string
): Promise<SlaAgentMetric[]> {
  const { data, error } = await db.rpc('get_agent_first_response_sla_report', {
    p_from: from,
    p_to: to,
  });

  if (error) throw error;

  return ((data ?? []) as SlaAgentMetricRow[]).map((row) => ({
    agentId: row.agent_id,
    totalConversations: Number(row.total_conversations),
    averageMinutes:
      row.average_minutes == null ? null : Number(row.average_minutes),
    optimalCount: Number(row.optimal_count),
    idealCount: Number(row.ideal_count),
    lowCount: Number(row.low_count),
    pendingCount: Number(row.pending_count),
    customerNames: row.customer_names ?? [],
    pendingCustomerNames: row.pending_customer_names ?? [],
  }));
}
