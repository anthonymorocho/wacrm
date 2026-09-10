'use client';

import { useEffect, useState } from 'react';
import { Loader2, Route } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { parseCapacity } from '@/lib/conversations/routing-settings';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

const DEFAULT_CAPACITY = 400;

export function RoutingSettings() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const [value, setValue] = useState(String(DEFAULT_CAPACITY));
  const [savedValue, setSavedValue] = useState(DEFAULT_CAPACITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;

    let cancelled = false;
    createClient()
      .from('accounts')
      .select('max_active_conversations_per_agent')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error('Could not load routing settings');
        } else {
          const capacity = Number(
            data?.max_active_conversations_per_agent ?? DEFAULT_CAPACITY
          );
          const safeCapacity = capacity > 0 ? capacity : DEFAULT_CAPACITY;
          setSavedValue(safeCapacity);
          setValue(String(safeCapacity));
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function save() {
    if (!accountId || !canEditSettings) return;
    const capacity = parseCapacity(value);
    if (capacity === null) {
      toast.error('Capacity must be a positive whole number');
      return;
    }

    setSaving(true);
    const { error } = await createClient()
      .from('accounts')
      .update({ max_active_conversations_per_agent: capacity })
      .eq('id', accountId);
    setSaving(false);

    if (error) {
      toast.error('Could not save routing settings');
      return;
    }
    setSavedValue(capacity);
    setValue(String(capacity));
    toast.success('Routing capacity saved');
  }

  const dirty = parseCapacity(value) !== savedValue;

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title="Conversation routing"
        description="Choose how many active conversations automatic assignment can place with one team member."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Route className="text-primary size-4" />
            Active conversations per agent
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            New conversations stay queued when every eligible agent reaches this
            limit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="routing-capacity" className="text-muted-foreground">
              Maximum active conversations
            </Label>
            <input
              id="routing-capacity"
              type="number"
              min={1}
              step={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={!canEditSettings || profileLoading || loading || saving}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          {!canEditSettings && (
            <p className="text-muted-foreground text-xs">
              Only account admins can change routing capacity.
            </p>
          )}
          {canEditSettings && (
            <Button
              onClick={() => void save()}
              disabled={saving || loading || !dirty}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save capacity'}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
