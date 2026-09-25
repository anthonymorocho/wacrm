'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Power } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import type { AvailabilityStatus } from '@/lib/presence';
import { cn } from '@/lib/utils';

/**
 * The routing switch is intentionally separate from heartbeat presence:
 * the tab may be visually online while the agent has chosen not to receive
 * new conversations.
 */
export function AvailabilityControl() {
  const { user, canSendMessages, profileLoading } = useAuth();
  const { getRow } = usePresence(!!user && canSendMessages);
  const [saving, setSaving] = useState(false);
  const [optimisticAvailability, setOptimisticAvailability] =
    useState<AvailabilityStatus | null>(null);

  if (profileLoading || !user || !canSendMessages) return null;

  const persistedAvailability = getRow(user.id)?.availability ?? 'offline';
  const availability: AvailabilityStatus =
    optimisticAvailability && optimisticAvailability !== persistedAvailability
      ? optimisticAvailability
      : persistedAvailability;
  const nextAvailability: AvailabilityStatus =
    availability === 'online' ? 'offline' : 'online';

  async function changeAvailability() {
    if (saving) return;
    setOptimisticAvailability(nextAvailability);
    setSaving(true);
    try {
      const response = await fetch('/api/account/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability: nextAvailability }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not change availability'
      );
      // Revert to the last value received from Realtime after a failed save.
      setOptimisticAvailability(null);
    } finally {
      setSaving(false);
    }
  }

  const online = availability === 'online';

  return (
    <button
      type="button"
      onClick={() => void changeAvailability()}
      disabled={saving}
      aria-pressed={online}
      aria-label={online ? 'Go offline' : 'Go online'}
      title={
        online
          ? 'Stop receiving automatic assignments'
          : 'Receive automatic assignments'
      }
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-0 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 sm:w-auto sm:px-2.5',
        online
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
          : 'border-border bg-muted text-muted-foreground hover:text-foreground'
      )}
    >
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Power className="size-3.5" aria-hidden />
      )}
      <span className="hidden sm:inline">{online ? 'Online' : 'Offline'}</span>
    </button>
  );
}
