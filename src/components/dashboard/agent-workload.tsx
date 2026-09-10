import { Circle, UsersRound } from 'lucide-react';

import type { AgentWorkloadBundle } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';

interface AgentWorkloadProps {
  data: AgentWorkloadBundle | null;
  loading: boolean;
}

export function AgentWorkload({ data, loading }: AgentWorkloadProps) {
  return (
    <section
      aria-labelledby="agent-workload-title"
      className="border-border bg-card rounded-xl border p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="agent-workload-title"
            className="text-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <UsersRound className="text-primary size-4" aria-hidden />
            Agent workload
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Active conversations per available team member
          </p>
        </div>
        <div className="bg-muted rounded-lg px-2.5 py-1.5 text-right">
          <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Queued
          </p>
          <p className="text-foreground text-lg font-semibold tabular-nums">
            {loading || !data ? '—' : data.queueCount}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3" aria-label="Loading agent workload">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="bg-muted h-10 animate-pulse rounded-lg"
            />
          ))}
        </div>
      ) : data?.agents.length ? (
        <div className="divide-border mt-5 divide-y">
          {data.agents.map((agent) => (
            <div
              key={agent.userId}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <Circle
                className={cn(
                  'size-2.5 fill-current',
                  agent.presence === 'online'
                    ? 'text-emerald-400'
                    : agent.presence === 'away'
                      ? 'text-amber-400'
                      : 'text-muted-foreground'
                )}
                aria-label={agent.presence}
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {agent.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {agent.availability === 'online' ? 'Available' : 'Offline'} ·{' '}
                  {agent.role}
                </p>
              </div>
              <div className="text-right">
                <p className="text-foreground text-sm font-semibold tabular-nums">
                  {agent.activeCount} / {agent.capacity}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {agent.remaining} remaining
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mt-5 text-sm">
          No eligible team members yet.
        </p>
      )}
    </section>
  );
}
