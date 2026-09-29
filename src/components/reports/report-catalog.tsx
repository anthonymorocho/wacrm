'use client';

import Link from 'next/link';
import { ArrowRight, Clock3 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { canManageMembers } from '@/lib/auth/roles';

export function ReportCatalog() {
  const t = useTranslations('Reports.catalog');
  const tSla = useTranslations('Reports.sla');
  const { accountRole, profileLoading } = useAuth();
  const canViewReports = !!accountRole && canManageMembers(accountRole);

  if (profileLoading) {
    return (
      <section className="space-y-5" aria-busy="true">
        <div className="space-y-2">
          <div className="bg-muted h-7 w-40 animate-pulse rounded" />
          <div className="bg-muted/70 h-4 w-72 max-w-full animate-pulse rounded" />
        </div>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="bg-muted size-11 animate-pulse rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="bg-muted h-4 w-40 animate-pulse rounded" />
              <div className="bg-muted/70 h-4 w-full max-w-lg animate-pulse rounded" />
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!canViewReports) {
    return (
      <section className="border-border bg-card rounded-xl border p-6">
        <h1 className="text-foreground text-xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {tSla('accessDenied')}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          {t('description')}
        </p>
      </header>

      <div className="space-y-3">
        <h2 className="text-foreground text-base font-semibold">
          {t('availableReports')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/reports/asa-por-agente"
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full transition-colors group-hover:bg-muted/40 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <Clock3 aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="text-foreground block font-medium">
                    {tSla('title')}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {tSla('description')}
                  </span>
                </span>
                <span className="text-muted-foreground hidden shrink-0 items-center gap-1 text-sm sm:flex">
                  {t('openReport')}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0 sm:hidden"
                />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </section>
  );
}
