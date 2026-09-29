'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, CalendarDays, Clock3, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { daysAgoStart, localDayKey } from '@/lib/dashboard/date-utils';
import {
  canEditSettings,
  canViewReports,
} from '@/lib/auth/roles';
import {
  loadSlaAgentMetrics,
  loadSlaThresholds,
  saveSlaThresholds,
  type SlaAgentMetric,
} from '@/lib/reports/queries';
import {
  DEFAULT_SLA_THRESHOLDS,
  validateSlaThresholds,
  type SlaThresholds,
} from '@/lib/reports/sla';

interface AgentProfile {
  user_id: string;
  full_name: string | null;
}

interface AgentReportRow extends SlaAgentMetric {
  name: string;
}

class SlaReportRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly originalError: unknown
  ) {
    super(`SLA report request failed: ${operation}`);
    this.name = 'SlaReportRequestError';
  }
}

async function withSlaReportContext<T>(
  operation: string,
  request: () => Promise<T>
): Promise<T> {
  try {
    return await request();
  } catch (originalError) {
    throw new SlaReportRequestError(operation, originalError);
  }
}

function logSlaReportFailure(prefix: string, caught: unknown) {
  const contextualError =
    caught instanceof SlaReportRequestError ? caught : null;
  const originalError = contextualError?.originalError ?? caught;
  const fields =
    typeof originalError === 'object' && originalError !== null
      ? (originalError as Record<string, unknown>)
      : {};
  const message =
    typeof fields.message === 'string'
      ? fields.message
      : originalError instanceof Error
        ? originalError.message
        : String(originalError);

  console.error(prefix, {
    operation: contextualError?.operation ?? 'unknown',
    name:
      typeof fields.name === 'string'
        ? fields.name
        : originalError instanceof Error
          ? originalError.name
          : undefined,
    message,
    code: typeof fields.code === 'string' ? fields.code : undefined,
    details: typeof fields.details === 'string' ? fields.details : undefined,
    hint: typeof fields.hint === 'string' ? fields.hint : undefined,
  });
}

function initialDateRange() {
  const to = localDayKey(new Date());
  const from = localDayKey(daysAgoStart(29));
  return { from, to };
}

function dateAtLocalMidnight(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) || localDayKey(date) !== value
    ? null
    : date;
}

function reportPeriod(from: string, to: string) {
  const start = dateAtLocalMidnight(from);
  const end = dateAtLocalMidnight(to);
  if (!start || !end || start > end) return null;

  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function formatMinutes(value: number | null, locale: string, noData: string) {
  if (value == null || !Number.isFinite(value)) return noData;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)} min`;
}

function countFor<K extends keyof SlaAgentMetric>(
  rows: AgentReportRow[],
  key: K
): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

export function SlaReport() {
  const t = useTranslations('Reports.sla');
  const locale = useLocale();
  const { accountId, accountRole, profileLoading, user } = useAuth();
  const canConfigure = !!accountRole && canEditSettings(accountRole);
  const canViewReport = !!accountRole && canViewReports(accountRole);
  const currentUserId = user?.id ?? null;

  const [draftRange, setDraftRange] = useState(initialDateRange);
  const [appliedRange, setAppliedRange] = useState(initialDateRange);
  const [dateError, setDateError] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentReportRow[]>([]);
  const [thresholds, setThresholds] = useState<SlaThresholds>(
    DEFAULT_SLA_THRESHOLDS
  );
  const [thresholdDraft, setThresholdDraft] = useState<SlaThresholds>(
    DEFAULT_SLA_THRESHOLDS
  );
  const [isEditingThresholds, setIsEditingThresholds] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!accountId) return;
    const period = reportPeriod(appliedRange.from, appliedRange.to);
    if (!period) {
      setError(t('invalidDateRange'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const db = createClient();
      const [metrics, members, settings] = await Promise.all([
        withSlaReportContext('metrics RPC', () =>
          loadSlaAgentMetrics(db, period.from, period.to)
        ),
        withSlaReportContext('agent profiles query', async () => {
          if (accountRole === 'agent' && !currentUserId) {
            throw new Error('Could not identify the current agent');
          }

          let profilesQuery = db
            .from('profiles')
            .select('user_id, full_name')
            .eq('account_id', accountId)
            .in('account_role', ['owner', 'admin', 'agent']);

          if (accountRole === 'agent') {
            profilesQuery = profilesQuery.eq('user_id', currentUserId!);
          }

          const { data, error } = await profilesQuery.order('full_name', {
            ascending: true,
          });

          if (error) throw error;
          return (data ?? []) as AgentProfile[];
        }),
        withSlaReportContext('SLA thresholds query', () =>
          loadSlaThresholds(db, accountId)
        ),
      ]);

      const metricsByAgent = new Map(
        metrics.map((metric) => [metric.agentId, metric])
      );
      const knownAgentIds = new Set(members.map((member) => member.user_id));
      const nextRows: AgentReportRow[] = members.map((member) => ({
        ...(metricsByAgent.get(member.user_id) ?? emptyMetric(member.user_id)),
        agentId: member.user_id,
        name: member.full_name?.trim() || t('unnamedAgent'),
      }));

      // Keep aggregate rows for an account member who was removed from the
      // roster after handling conversations; the message audit still exists.
      for (const metric of metrics) {
        if (knownAgentIds.has(metric.agentId)) continue;
        nextRows.push({ ...metric, name: t('formerAgent') });
      }

      nextRows.sort((a, b) =>
        a.name.localeCompare(b.name, locale, { sensitivity: 'base' })
      );
      setRows(nextRows);
      setThresholds(settings);
      setThresholdDraft(settings);
    } catch (caught) {
      logSlaReportFailure('[reports] SLA report failed:', caught);
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [
    accountId,
    accountRole,
    appliedRange.from,
    appliedRange.to,
    currentUserId,
    locale,
    t,
  ]);

  useEffect(() => {
    if (profileLoading) return;
    if (!canViewReport) {
      setLoading(false);
      return;
    }
    void loadReport();
  }, [canViewReport, loadReport, profileLoading]);

  const totals = useMemo(() => {
    const answered =
      countFor(rows, 'totalConversations') - countFor(rows, 'pendingCount');
    const weightedMinutes = rows.reduce(
      (total, row) =>
        total +
        (row.averageMinutes ?? 0) * (row.totalConversations - row.pendingCount),
      0
    );
    return {
      conversations: countFor(rows, 'totalConversations'),
      averageMinutes: answered > 0 ? weightedMinutes / answered : null,
    };
  }, [rows]);

  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportPeriod(draftRange.from, draftRange.to)) {
      setDateError(t('invalidDateRange'));
      return;
    }
    setDateError(null);
    setAppliedRange({ ...draftRange });
  }

  async function saveThresholdChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || !canConfigure) return;

    const validation = validateSlaThresholds(thresholdDraft);
    if (validation) {
      toast.error(
        t(validation === 'ordered' ? 'thresholdsOrdered' : 'thresholdsPositive')
      );
      return;
    }

    setSaving(true);
    try {
      await withSlaReportContext('save SLA thresholds', () =>
        saveSlaThresholds(createClient(), accountId, thresholdDraft)
      );
      setThresholds(thresholdDraft);
      setIsEditingThresholds(false);
      toast.success(t('thresholdsSaved'));
      await loadReport();
    } catch (caught) {
      logSlaReportFailure(
        '[reports] saving SLA thresholds failed:',
        caught
      );
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="bg-muted h-7 w-48 animate-pulse rounded" />
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
            <div className="bg-muted/70 h-10 animate-pulse rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canViewReport) {
    return (
      <section className="border-border bg-card rounded-xl border p-6">
        <h1 className="text-foreground text-xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {t('accessDenied')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/reports"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('backToReports')}
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            {t('description')}
          </p>
        </div>
        {canConfigure ? (
          <Button
            type="button"
            variant={isEditingThresholds ? 'secondary' : 'outline'}
            onClick={() => {
              setThresholdDraft(thresholds);
              setIsEditingThresholds((value) => !value);
            }}
          >
            <Settings2 aria-hidden="true" />
            {isEditingThresholds ? t('closeSettings') : t('configure')}
          </Button>
        ) : null}
      </header>

      {isEditingThresholds && canConfigure ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('thresholdsTitle')}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t('thresholdsDescription')}
            </p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={saveThresholdChanges}>
              <div className="grid gap-3 sm:grid-cols-2">
                <ThresholdField
                  id="sla-optimal"
                  label={t('optimalThreshold')}
                  value={thresholdDraft.optimalMinutes}
                  onChange={(value) =>
                    setThresholdDraft((current) => ({
                      ...current,
                      optimalMinutes: value,
                    }))
                  }
                />
                <ThresholdField
                  id="sla-low"
                  label={t('lowThreshold')}
                  value={thresholdDraft.lowMinutes}
                  onChange={(value) =>
                    setThresholdDraft((current) => ({
                      ...current,
                      lowMinutes: value,
                    }))
                  }
                />
              </div>
              <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-xs">
                  {t('thresholdsHelp')}
                </p>
                <div className="flex gap-2 sm:shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsEditingThresholds(false)}
                    disabled={saving}
                  >
                    {t('cancel')}
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? t('saving') : t('saveThresholds')}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end"
            onSubmit={applyDateRange}
          >
            <DateField
              id="sla-date-from"
              label={t('from')}
              value={draftRange.from}
              onChange={(from) =>
                setDraftRange((current) => ({ ...current, from }))
              }
            />
            <DateField
              id="sla-date-to"
              label={t('to')}
              value={draftRange.to}
              onChange={(to) =>
                setDraftRange((current) => ({ ...current, to }))
              }
            />
            <Button type="submit" className="sm:mb-px">
              <CalendarDays aria-hidden="true" />
              {t('applyDates')}
            </Button>
          </form>
          {dateError ? (
            <p className="text-destructive mt-2 text-sm">{dateError}</p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard
          title={t('totalConversations')}
          value={loading ? '—' : totals.conversations.toLocaleString(locale)}
          detail={t('totalDescription')}
          icon={<CalendarDays aria-hidden="true" className="size-4" />}
        />
        <SummaryCard
          title={t('averageResponse')}
          value={
            loading
              ? '—'
              : formatMinutes(totals.averageMinutes, locale, t('noData'))
          }
          detail={t('averageDescription')}
          icon={<Clock3 aria-hidden="true" className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader className="border-border border-b">
          <CardTitle>{t('tableTitle')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('tableDescription', {
              optimal: thresholds.optimalMinutes,
              low: thresholds.lowMinutes,
            })}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-5" aria-label={t('loading')}>
              <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
              <div className="bg-muted/70 h-10 animate-pulse rounded" />
              <div className="bg-muted/70 h-10 animate-pulse rounded" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground px-5 py-10 text-center text-sm">
              {t('empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('agent')}</TableHead>
                  <TableHead>{t('customers')}</TableHead>
                  <TableHead className="text-right">
                    {t('averageResponse')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('compliance')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('totalConversations')}
                  </TableHead>
                  <TableHead className="text-right">{t('optimal')}</TableHead>
                  <TableHead className="text-right">{t('ideal')}</TableHead>
                  <TableHead className="text-right">{t('low')}</TableHead>
                  <TableHead className="text-right">{t('pending')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.agentId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.customerNames.length > 0 ? (
                        <details className="group max-w-56">
                          <summary className="text-primary focus-visible:ring-ring cursor-pointer text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                            {t('customerCount', {
                              count: row.customerNames.length,
                            })}
                          </summary>
                          <ul className="text-muted-foreground mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                            {row.customerNames.map((customer) => (
                              <li
                                key={customer}
                                className="truncate"
                                title={customer}
                              >
                                {customer}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-muted-foreground">
                          {t('noData')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(row.averageMinutes, locale, t('noData'))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCompliance(row, locale, t('noData'))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.totalConversations.toLocaleString(locale)}
                    </TableCell>
                    <CountCell
                      value={row.optimalCount}
                      className="text-emerald-500"
                    />
                    <CountCell
                      value={row.idealCount}
                      className="text-sky-500"
                    />
                    <CountCell
                      value={row.lowCount}
                      className="text-amber-500"
                    />
                    <TableCell className="text-right tabular-nums">
                      {row.pendingCustomerNames.length > 0 ? (
                        <div className="flex flex-col items-end gap-1">
                          <span>{row.pendingCount.toLocaleString(locale)}</span>
                          <details className="max-w-56 text-right">
                            <summary className="text-primary focus-visible:ring-ring cursor-pointer text-xs underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                              {t('viewPendingCustomers', {
                                count: row.pendingCustomerNames.length,
                              })}
                            </summary>
                            <ul className="text-muted-foreground mt-2 max-h-40 space-y-1 overflow-auto text-left text-xs">
                              {row.pendingCustomerNames.map((customer) => (
                                <li
                                  key={customer}
                                  className="truncate"
                                  title={customer}
                                >
                                  {customer}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      ) : (
                        row.pendingCount.toLocaleString(locale)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">{t('attributionNote')}</p>
    </div>
  );
}

function emptyMetric(agentId: string): SlaAgentMetric {
  return {
    agentId,
    totalConversations: 0,
    averageMinutes: null,
    optimalCount: 0,
    idealCount: 0,
    lowCount: 0,
    pendingCount: 0,
    customerNames: [],
    pendingCustomerNames: [],
  };
}

function formatCompliance(
  metric: SlaAgentMetric,
  locale: string,
  noData: string
) {
  const answered = metric.optimalCount + metric.idealCount + metric.lowCount;
  if (answered === 0) return noData;

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(((metric.optimalCount + metric.idealCount) / answered) * 100)}%`;
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="text-foreground grid gap-1.5 text-sm font-medium"
    >
      {label}
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="min-w-40"
      />
    </label>
  );
}

function ThresholdField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="text-foreground grid gap-1.5 text-sm font-medium"
    >
      {label}
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0.01"
          step="0.1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          required
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
          min
        </span>
      </div>
    </label>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium">{title}</p>
          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
            {value}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
        </div>
        <span className="bg-primary/10 text-primary rounded-lg p-2">
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

function CountCell({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <TableCell
      className={`text-right font-medium tabular-nums ${className ?? ''}`}
    >
      {value.toLocaleString()}
    </TableCell>
  );
}
