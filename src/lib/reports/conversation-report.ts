import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;

export interface ConversationReportSummary {
  totalConversations: number;
  averageLifeMinutes: number | null;
  averageCustomerWaitMinutes: number | null;
  averageAgentCloseMinutes: number | null;
  idealSlaPercentage: number | null;
  closedConversations: number;
  idealClosedConversations: number;
  assignedConversations: number;
  botClosedConversations: number;
}

export interface ReportDistributionPoint {
  label: string;
  count: number;
  percentage: number;
}

export interface ReportDailyCount {
  day: string;
  count: number;
}

export interface ReportDailyOutcomes {
  day: string;
  closed: number;
  transferred: number;
}

export interface ReportDailySla {
  day: string;
  within: number;
  outside: number;
}

export interface ReportChannelCount {
  channel: string;
  count: number;
}

export interface ReportChannelDay {
  day: string;
  channel: string;
  count: number;
}

export interface ReportOutcomeCount {
  outcome: 'closed' | 'transferred' | 'active';
  count: number;
}

export interface ReportStatusCount {
  status: 'open' | 'pending' | 'closed';
  count: number;
}

export interface ReportClosureActorCount {
  actor: 'agent' | 'bot' | 'system';
  count: number;
}

export interface ReportLabeledCount {
  label: string;
  count: number;
}

export interface ReportAgentCount {
  agentId: string;
  name: string;
  count: number;
}

export interface ConversationReportData {
  summary: ConversationReportSummary;
  waitDistribution: ReportDistributionPoint[];
  agentCloseDistribution: ReportDistributionPoint[];
  assignedByDay: ReportDailyCount[];
  outcomeTotals: ReportOutcomeCount[];
  statusTotals: ReportStatusCount[];
  closureActors: ReportClosureActorCount[];
  closedAndTransferredByDay: ReportDailyOutcomes[];
  slaByDay: ReportDailySla[];
  byChannel: ReportChannelCount[];
  directVsComments: ReportLabeledCount[];
  channelByDay: ReportChannelDay[];
  byAgent: ReportAgentCount[];
  trackingStartedAt: string | null;
  optimalMinutes: number;
  lowMinutes: number;
}

type RawRow = Record<string, unknown>;

function rows(value: unknown): RawRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is RawRow => typeof row === 'object' && row !== null
      )
    : [];
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCountRows<T extends RawRow>(
  source: unknown,
  map: (row: RawRow) => T
): T[] {
  return rows(source).map(map);
}

export async function loadConversationReport(
  db: DB,
  from: string,
  to: string,
  timezone: string
): Promise<ConversationReportData> {
  const { data, error } = await db.rpc('get_conversation_report', {
    p_from: from,
    p_to: to,
    p_timezone: timezone,
  });

  if (error) throw error;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Conversation report returned an invalid response');
  }

  const raw = data as RawRow;
  const rawSummary = (raw.summary ?? {}) as RawRow;
  const thresholds = (raw.slaThresholds ?? {}) as RawRow;
  const summary: ConversationReportSummary = {
    totalConversations: number(rawSummary.totalConversations),
    averageLifeMinutes: nullableNumber(rawSummary.averageLifeMinutes),
    averageCustomerWaitMinutes: nullableNumber(
      rawSummary.averageCustomerWaitMinutes
    ),
    averageAgentCloseMinutes: nullableNumber(
      rawSummary.averageAgentCloseMinutes
    ),
    idealSlaPercentage: nullableNumber(rawSummary.idealSlaPercentage),
    closedConversations: number(rawSummary.closedConversations),
    idealClosedConversations: number(rawSummary.idealClosedConversations),
    assignedConversations: number(rawSummary.assignedConversations),
    botClosedConversations: number(rawSummary.botClosedConversations),
  };

  return {
    summary,
    waitDistribution: mapCountRows(raw.waitDistribution, (row) => ({
      label: String(row.label ?? ''),
      count: number(row.count),
      percentage: number(row.percentage),
    })),
    agentCloseDistribution: mapCountRows(raw.agentCloseDistribution, (row) => ({
      label: String(row.label ?? ''),
      count: number(row.count),
      percentage: number(row.percentage),
    })),
    assignedByDay: mapCountRows(raw.assignedByDay, (row) => ({
      day: String(row.day ?? ''),
      count: number(row.count),
    })),
    outcomeTotals: mapCountRows(raw.outcomeTotals, (row) => ({
      outcome: String(row.outcome ?? 'active') as ReportOutcomeCount['outcome'],
      count: number(row.count),
    })),
    statusTotals: mapCountRows(raw.statusTotals, (row) => ({
      status: String(row.status ?? 'open') as ReportStatusCount['status'],
      count: number(row.count),
    })),
    closureActors: mapCountRows(raw.closureActors, (row) => ({
      actor: String(row.actor ?? 'system') as ReportClosureActorCount['actor'],
      count: number(row.count),
    })),
    closedAndTransferredByDay: mapCountRows(
      raw.closedAndTransferredByDay,
      (row) => ({
        day: String(row.day ?? ''),
        closed: number(row.closed),
        transferred: number(row.transferred),
      })
    ),
    slaByDay: mapCountRows(raw.slaByDay, (row) => ({
      day: String(row.day ?? ''),
      within: number(row.within),
      outside: number(row.outside),
    })),
    byChannel: mapCountRows(raw.byChannel, (row) => ({
      channel: String(row.channel ?? 'whatsapp'),
      count: number(row.count),
    })),
    directVsComments: mapCountRows(raw.directVsComments, (row) => ({
      label: String(row.label ?? ''),
      count: number(row.count),
    })),
    channelByDay: mapCountRows(raw.channelByDay, (row) => ({
      day: String(row.day ?? ''),
      channel: String(row.channel ?? 'whatsapp'),
      count: number(row.count),
    })),
    byAgent: mapCountRows(raw.byAgent, (row) => ({
      agentId: String(row.agentId ?? ''),
      name: String(row.name ?? ''),
      count: number(row.count),
    })),
    trackingStartedAt:
      typeof raw.trackingStartedAt === 'string' ? raw.trackingStartedAt : null,
    optimalMinutes: number(thresholds.optimalMinutes, 1),
    lowMinutes: number(thresholds.lowMinutes, 15),
  };
}
