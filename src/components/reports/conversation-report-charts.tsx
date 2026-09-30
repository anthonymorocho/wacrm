'use client';

import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale, useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/dashboard/empty-state';
import type {
  ConversationReportData,
  ReportDailyCount,
  ReportDailyOutcomes,
  ReportDailySla,
  ReportDistributionPoint,
  ReportLabeledCount,
} from '@/lib/reports/conversation-report';
import type { ReportDateRange } from '@/lib/reports/period';

const COLORS = {
  teal: 'var(--chart-1)',
  green: 'var(--color-emerald-500)',
  blue: 'var(--color-sky-500)',
  amber: 'var(--color-amber-500)',
  coral: 'var(--destructive)',
  violet: 'var(--chart-3)',
  muted: 'var(--muted-foreground)',
} as const;

const OUTCOME_COLORS = [COLORS.teal, COLORS.amber, COLORS.muted];
const CLOSURE_ACTOR_COLORS = [COLORS.teal, COLORS.violet, COLORS.muted];
const CHANNELS = ['whatsapp', 'messenger', 'instagram'] as const;
const CHANNEL_COLORS = [COLORS.green, COLORS.blue, COLORS.coral];

function ReportPanel({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartFrame({
  empty,
  children,
}: {
  empty: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="h-64 min-w-0">
      {empty ? (
        <EmptyState title="" hint={undefined} className="h-full min-h-0" />
      ) : (
        children
      )}
    </div>
  );
}

function dateKeys(from: string, to: string): string[] {
  const fromParts = from.split('-').map(Number);
  const toParts = to.split('-').map(Number);
  const current = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const end = new Date(toParts[0], toParts[1] - 1, toParts[2]);
  if (
    Number.isNaN(current.getTime()) ||
    Number.isNaN(end.getTime()) ||
    current > end
  ) {
    return [];
  }

  const keys: string[] = [];
  while (current <= end) {
    keys.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
    );
    current.setDate(current.getDate() + 1);
  }
  return keys;
}

function localizedDay(day: string, locale: string) {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(year, month - 1, date));
}

function fillDaily<T extends { day: string }>(
  range: ReportDateRange,
  input: readonly T[],
  empty: (day: string) => T
) {
  const byDay = new Map(input.map((point) => [point.day, point]));
  return dateKeys(range.from, range.to).map(
    (day) => byDay.get(day) ?? empty(day)
  );
}

function ChartTooltipBox() {
  return (
    <Tooltip
      contentStyle={{
        backgroundColor: 'var(--popover)',
        borderColor: 'var(--border)',
        color: 'var(--popover-foreground)',
        borderRadius: 'var(--radius)',
      }}
      labelStyle={{ color: 'var(--popover-foreground)' }}
      itemStyle={{ color: 'var(--popover-foreground)' }}
    />
  );
}

function DistributionChart({
  title,
  data,
  color,
}: {
  title: string;
  data: ReportDistributionPoint[];
  color: string;
}) {
  const t = useTranslations('Reports.conversations');
  const total = data.reduce((sum, point) => sum + point.count, 0);
  return (
    <ReportPanel title={title}>
      <ChartFrame empty={total === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              angle={-35}
              textAnchor="end"
              height={48}
            />
            <YAxis
              tickFormatter={(value: number) => `${Math.round(value)}%`}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              width={38}
            />
            <ChartTooltipBox />
            <Area
              type="monotone"
              dataKey="percentage"
              name={t('share')}
              stroke={color}
              fill={color}
              fillOpacity={0.18}
              strokeWidth={2}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
      <p className="text-muted-foreground mt-2 text-xs">
        {t('bucketDescription')}
      </p>
    </ReportPanel>
  );
}

function CountDonut({
  title,
  data,
  colors,
}: {
  title: string;
  data: ReportLabeledCount[];
  colors: readonly string[];
}) {
  const t = useTranslations('Reports.conversations');
  const locale = useLocale();
  const total = data.reduce((sum, point) => sum + point.count, 0);

  return (
    <ReportPanel title={title}>
      {total === 0 ? (
        <ChartFrame empty />
      ) : (
        <div className="grid min-h-64 grid-cols-[minmax(0,1fr)_minmax(6rem,0.8fr)] items-center gap-2">
          <div className="relative h-60 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={data.length > 1 ? 2 : 0}
                  stroke="none"
                >
                  {data.map((point, index) => (
                    <Cell
                      key={`${point.label}-${index}`}
                      fill={colors[index % colors.length]}
                    />
                  ))}
                </Pie>
                <ChartTooltipBox />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-foreground text-xl font-semibold tabular-nums">
                {new Intl.NumberFormat(locale).format(total)}
              </span>
              <span className="text-muted-foreground text-xs tracking-wide uppercase">
                {t('total')}
              </span>
            </div>
          </div>
          <ul className="min-w-0 space-y-2">
            {data.map((point, index) => (
              <li
                key={`${point.label}-${index}`}
                className="flex min-w-0 gap-2 text-xs"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[index % colors.length] }}
                />
                <span className="min-w-0">
                  <span className="text-foreground block truncate">
                    {point.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Intl.NumberFormat(locale).format(point.count)} ·{' '}
                    {total === 0
                      ? '0%'
                      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format((point.count / total) * 100)}%`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ReportPanel>
  );
}

function DailyBars<T extends { day: string }>({
  title,
  range,
  data,
  valueKeys,
  labels,
  colors,
  total,
}: {
  title: string;
  range: ReportDateRange;
  data: T[];
  valueKeys: string[];
  labels: string[];
  colors: string[];
  total: number;
}) {
  const locale = useLocale();
  return (
    <ReportPanel title={title}>
      <ChartFrame empty={total === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tickFormatter={(day: string) => localizedDay(day, locale)}
              interval="preserveStartEnd"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              minTickGap={18}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              width={38}
            />
            <ChartTooltipBox />
            {valueKeys.length > 1 ? <Legend /> : null}
            {valueKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                name={labels[index]}
                fill={colors[index]}
                stackId={valueKeys.length > 1 ? 'daily' : undefined}
                radius={valueKeys.length > 1 ? undefined : [3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </ReportPanel>
  );
}

function CreatedAssignedBotChart({
  data,
}: {
  data: ConversationReportData['summary'];
}) {
  const t = useTranslations('Reports.conversations');
  const locale = useLocale();
  const points = [
    { label: t('created'), count: data.totalConversations, color: COLORS.teal },
    {
      label: t('assigned'),
      count: data.assignedConversations,
      color: COLORS.amber,
    },
    {
      label: t('botClosed'),
      count: data.botClosedConversations,
      color: COLORS.violet,
    },
  ];
  const total = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <ReportPanel title={t('createdAssignedBotTitle')}>
      <ChartFrame empty={total === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={points}
            margin={{ top: 16, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              width={42}
            />
            <ChartTooltipBox />
            <Bar
              dataKey="count"
              name={t('conversations')}
              radius={[3, 3, 0, 0]}
            >
              {points.map((point) => (
                <Cell key={point.label} fill={point.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <p className="text-muted-foreground mt-2 text-xs">
        {new Intl.NumberFormat(locale).format(data.totalConversations)}{' '}
        {t('createdInRange')}
      </p>
    </ReportPanel>
  );
}

export function ConversationReportCharts({
  data,
  range,
  canViewComments,
}: {
  data: ConversationReportData;
  range: ReportDateRange;
  canViewComments: boolean;
}) {
  const t = useTranslations('Reports.conversations');
  const tChannel = useTranslations('Inbox.channel');
  const locale = useLocale();
  const channelLabel = (channel: string) => {
    if (channel === 'messenger') return tChannel('messenger');
    if (channel === 'instagram') return tChannel('instagram');
    return tChannel('whatsapp');
  };

  const assignedDays = fillDaily<ReportDailyCount>(
    range,
    data.assignedByDay,
    (day) => ({ day, count: 0 })
  );
  const outcomeDays = fillDaily<ReportDailyOutcomes>(
    range,
    data.closedAndTransferredByDay,
    (day) => ({ day, closed: 0, transferred: 0 })
  );
  const slaDays = fillDaily<ReportDailySla>(range, data.slaByDay, (day) => ({
    day,
    within: 0,
    outside: 0,
  }));
  const assignedTotal = assignedDays.reduce(
    (sum, point) => sum + point.count,
    0
  );
  const outcomeEventTotal = outcomeDays.reduce(
    (sum, point) => sum + point.closed + point.transferred,
    0
  );
  const slaTotal = slaDays.reduce(
    (sum, point) => sum + point.within + point.outside,
    0
  );

  const outcomeLabels: ReportLabeledCount[] = data.outcomeTotals.map(
    (point) => ({
      label: t(`outcome.${point.outcome}`),
      count: point.count,
    })
  );
  const statusLabels: ReportLabeledCount[] = data.statusTotals.map((point) => ({
    label: t(`status.${point.status}`),
    count: point.count,
  }));
  const closureActorLabels: ReportLabeledCount[] = data.closureActors.map(
    (point) => ({
      label: t(`closureActor.${point.actor}`),
      count: point.count,
    })
  );
  const directCommentLabels: ReportLabeledCount[] = data.directVsComments.map(
    (point) => ({
      label: t(`interaction.${point.label}`),
      count: point.count,
    })
  );
  const channelLabels: ReportLabeledCount[] = data.byChannel.map((point) => ({
    label: channelLabel(point.channel),
    count: point.count,
  }));
  const totalConversations = data.summary.totalConversations;
  const allDays = dateKeys(range.from, range.to);
  const channelDayMap = new Map<string, number>();
  for (const point of data.channelByDay) {
    channelDayMap.set(`${point.day}:${point.channel}`, point.count);
  }
  const channelDays = allDays.map((day) => ({
    day,
    whatsapp: channelDayMap.get(`${day}:whatsapp`) ?? 0,
    messenger: channelDayMap.get(`${day}:messenger`) ?? 0,
    instagram: channelDayMap.get(`${day}:instagram`) ?? 0,
  }));

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <DistributionChart
        title={t('waitDistributionTitle')}
        data={data.waitDistribution}
        color={COLORS.teal}
      />
      <DistributionChart
        title={t('agentCloseDistributionTitle')}
        data={data.agentCloseDistribution}
        color={COLORS.amber}
      />

      <CreatedAssignedBotChart data={data.summary} />
      <DailyBars
        title={t('assignedByDayTitle')}
        range={range}
        data={assignedDays}
        valueKeys={['count']}
        labels={[t('assigned')]}
        colors={[COLORS.amber]}
        total={assignedTotal}
      />

      <CountDonut
        title={t('outcomesTitle')}
        data={outcomeLabels}
        colors={OUTCOME_COLORS}
      />
      <DailyBars
        title={t('closedTransferredByDayTitle')}
        range={range}
        data={outcomeDays}
        valueKeys={['closed', 'transferred']}
        labels={[t('closed'), t('transferred')]}
        colors={[COLORS.teal, COLORS.coral]}
        total={outcomeEventTotal}
      />

      <DailyBars
        title={t('slaByDayTitle', { low: data.lowMinutes })}
        range={range}
        data={slaDays}
        valueKeys={['within', 'outside']}
        labels={[t('withinSla'), t('outsideSla')]}
        colors={[COLORS.teal, COLORS.amber]}
        total={slaTotal}
      />

      <CountDonut
        title={t('currentStatusTitle')}
        data={statusLabels}
        colors={OUTCOME_COLORS}
      />
      <CountDonut
        title={t('closureActorsTitle')}
        data={closureActorLabels}
        colors={CLOSURE_ACTOR_COLORS}
      />

      <CountDonut
        title={t('byChannelTitle')}
        data={channelLabels}
        colors={CHANNEL_COLORS}
      />
      {canViewComments ? (
        <CountDonut
          title={t('directVsCommentsTitle')}
          data={directCommentLabels}
          colors={[COLORS.amber, COLORS.green]}
        />
      ) : null}

      <ReportPanel title={t('channelByDayTitle')} className="xl:col-span-2">
        <ChartFrame empty={totalConversations === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={channelDays}
              margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickFormatter={(day: string) => localizedDay(day, locale)}
                interval="preserveStartEnd"
                minTickGap={18}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                width={42}
              />
              <ChartTooltipBox />
              <Legend />
              {CHANNELS.map((channel, index) => (
                <Line
                  key={channel}
                  type="monotone"
                  dataKey={channel}
                  name={channelLabel(channel)}
                  stroke={CHANNEL_COLORS[index]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </ReportPanel>

      <ReportPanel title={t('byAgentTitle')} className="xl:col-span-2">
        {data.byAgent.length === 0 ? (
          <ChartFrame empty />
        ) : (
          <div
            className="min-w-0"
            style={{
              height: Math.min(480, Math.max(240, data.byAgent.length * 42)),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.byAgent}
                layout="vertical"
                margin={{ top: 8, right: 28, bottom: 8, left: 12 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={140}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <ChartTooltipBox />
                <Bar
                  dataKey="count"
                  name={t('conversations')}
                  fill={COLORS.amber}
                  radius={[0, 3, 3, 0]}
                  label={{
                    position: 'right',
                    fill: 'var(--muted-foreground)',
                    fontSize: 11,
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportPanel>
    </div>
  );
}
