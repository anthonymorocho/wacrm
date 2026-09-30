'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MessagesSquare,
  Timer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { canViewReports } from '@/lib/auth/roles';
import { formatResponseTime } from '@/lib/dashboard/response-time';
import { localDayKey } from '@/lib/dashboard/date-utils';
import {
  loadConversationReport,
  type ConversationReportData,
} from '@/lib/reports/conversation-report';
import { initialReportDateRange, reportPeriod } from '@/lib/reports/period';
import { createClient } from '@/lib/supabase/client';

import { ConversationReportCharts } from './conversation-report-charts';

function formatDuration(
  value: number | null,
  locale: string,
  labels: {
    second: string;
    minute: string;
    hour: string;
    separator: string;
    empty: string;
  }
) {
  if (value == null || !Number.isFinite(value)) return labels.empty;
  if (value >= 60) return formatResponseTime(Math.round(value), labels);
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)}${labels.separator}${labels.minute}`;
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

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex min-h-28 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">{title}</p>
          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
            {value}
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {detail}
          </p>
        </div>
        <span className="bg-primary/10 text-primary shrink-0 rounded-lg p-2">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function ReportLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="bg-muted h-10 animate-pulse rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="bg-muted h-28 animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="bg-muted h-80 animate-pulse rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function trackingStartLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(new Date(value));
}

export function ConversationReport() {
  const t = useTranslations('Reports.conversations');
  const locale = useLocale();
  const { accountId, accountRole, profileLoading } = useAuth();
  const canViewReport = !!accountRole && canViewReports(accountRole);
  const canViewComments = accountRole === 'owner' || accountRole === 'admin';

  const [draftRange, setDraftRange] = useState(initialReportDateRange);
  const [appliedRange, setAppliedRange] = useState(initialReportDateRange);
  const [dateError, setDateError] = useState<string | null>(null);
  const [data, setData] = useState<ConversationReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileLoading) return;
    if (!canViewReport || !accountId) {
      setLoading(false);
      return;
    }

    const period = reportPeriod(appliedRange.from, appliedRange.to);
    if (!period) {
      setDateError(t('invalidDateRange'));
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setLoading(true);
    setError(null);
    setData(null);

    void loadConversationReport(
      createClient(),
      period.from,
      period.to,
      timezone
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const details =
          typeof caught === 'object' && caught !== null
            ? (caught as Record<string, unknown>)
            : {};
        console.error('[reports] conversations report failed:', {
          message:
            typeof details.message === 'string'
              ? details.message
              : caught instanceof Error
                ? caught.message
                : String(caught),
          code: typeof details.code === 'string' ? details.code : undefined,
        });
        setError(t('loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    appliedRange.from,
    appliedRange.to,
    canViewReport,
    profileLoading,
    t,
  ]);

  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportPeriod(draftRange.from, draftRange.to)) {
      setDateError(t('invalidDateRange'));
      return;
    }
    setDateError(null);
    setAppliedRange({ ...draftRange });
  }

  if (profileLoading) return <ReportLoading />;

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

  const timeLabels = {
    second: t('secondsShort'),
    minute: t('minutesShort'),
    hour: t('hoursShort'),
    separator: t('unitSeparator'),
    empty: t('noData'),
  };
  const dateLocale = locale === 'ko' ? 'ko-KR' : locale === 'es' ? 'es' : 'en';
  const trackingStartedAt = data?.trackingStartedAt;
  const trackingDay = trackingStartedAt
    ? localDayKey(new Date(trackingStartedAt))
    : null;
  const periodStartsBeforeTracking =
    !!trackingStartedAt && appliedRange.from <= trackingDay!;

  return (
    <section className="space-y-5">
      <Link
        href="/reports"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('backToReports')}
      </Link>

      <header className="space-y-1">
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          {t('description')}
        </p>
      </header>

      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end"
            onSubmit={applyDateRange}
          >
            <DateField
              id="conversation-report-from"
              label={t('from')}
              value={draftRange.from}
              onChange={(from) =>
                setDraftRange((current) => ({ ...current, from }))
              }
            />
            <DateField
              id="conversation-report-to"
              label={t('to')}
              value={draftRange.to}
              onChange={(to) =>
                setDraftRange((current) => ({ ...current, to }))
              }
            />
            <Button type="submit" className="sm:mb-px" disabled={loading}>
              <CalendarDays aria-hidden="true" />
              {t('applyDates')}
            </Button>
          </form>
          {dateError ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {dateError}
            </p>
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

      {loading && !data ? (
        <ReportLoading />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <MetricCard
              title={t('totalConversations')}
              value={new Intl.NumberFormat(locale).format(
                data.summary.totalConversations
              )}
              detail={t('totalDescription')}
              icon={MessagesSquare}
            />
            <MetricCard
              title={t('averageLife')}
              value={formatDuration(
                data.summary.averageLifeMinutes,
                dateLocale,
                timeLabels
              )}
              detail={t('averageLifeDescription')}
              icon={Clock3}
            />
            <MetricCard
              title={t('customerWait')}
              value={formatDuration(
                data.summary.averageCustomerWaitMinutes,
                dateLocale,
                timeLabels
              )}
              detail={t('customerWaitDescription')}
              icon={Timer}
            />
            <MetricCard
              title={t('agentCloseTime')}
              value={formatDuration(
                data.summary.averageAgentCloseMinutes,
                dateLocale,
                timeLabels
              )}
              detail={t('agentCloseTimeDescription')}
              icon={Activity}
            />
            <MetricCard
              title={t('idealSla')}
              value={
                data.summary.idealSlaPercentage == null
                  ? t('noData')
                  : `${new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(data.summary.idealSlaPercentage)}%`
              }
              detail={t('idealSlaDescription', {
                ideal: data.summary.idealClosedConversations,
                closed: data.summary.closedConversations,
                optimal: data.optimalMinutes,
                low: data.lowMinutes,
              })}
              icon={CheckCircle2}
            />
          </div>

          {periodStartsBeforeTracking && trackingStartedAt ? (
            <p className="text-muted-foreground border-border bg-muted/30 rounded-lg border px-3 py-2 text-xs">
              {t('trackingNote', {
                date: trackingStartLabel(trackingStartedAt, dateLocale),
              })}
            </p>
          ) : null}

          <ConversationReportCharts
            data={data}
            range={appliedRange}
            canViewComments={canViewComments}
          />
        </>
      ) : null}
    </section>
  );
}
