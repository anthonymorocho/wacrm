"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  derivePresence,
  type PresenceRow,
  type PresenceStatus,
  type StoredPresence,
  type AvailabilityStatus,
} from "@/lib/presence";

// How often the viewer re-derives presence locally. The online -> offline
// transition fires no database event; it is just the clock passing the
// staleness threshold. ~15s keeps "offline" responsive without busy-spinning.
const RE_DERIVE_MS = 15_000;

type PresenceMap = Map<string, PresenceRow>;

interface PresenceSnapshot {
  accountId: string | null;
  rows: PresenceMap;
}

interface UsePresenceResult {
  /** Derived status for one member (defaults to offline if unseen). */
  getPresence: (userId: string) => PresenceStatus;
  /** Raw row for tooltips ("last seen ..."). */
  getRow: (userId: string) => PresenceRow | undefined;
  /** Clock used for presence derivation and relative labels. */
  now: number;
}

const EMPTY_PRESENCE: UsePresenceResult = {
  getPresence: () => "offline",
  getRow: () => undefined,
  now: 0,
};

const EMPTY_PRESENCE_MAP: PresenceMap = new Map();

const PresenceContext = createContext<UsePresenceResult>(EMPTY_PRESENCE);

/**
 * Build a topic for one subscription lifecycle. React Strict Mode can run
 * an effect cleanup and its next setup before Supabase finishes tearing down
 * the old channel. A generation-specific topic prevents that overlap from
 * reusing a subscribed channel when its postgres listener is registered.
 */
export function presenceChannelTopic(accountId: string, generation: number) {
  return `presence:${accountId}:${generation}`;
}

/**
 * Own the account's single live presence subscription. The header, Inbox and
 * settings roster all consume this provider, so they cannot register
 * separate callbacks on Supabase's same-named channel.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth();
  const [snapshot, setSnapshot] = useState<PresenceSnapshot>(() => ({
    accountId: null,
    rows: new Map(),
  }));
  const [now, setNow] = useState(() => Date.now());
  const channelGenerationRef = useRef(0);

  // Account changes should hide the previous account immediately, before the
  // replacement snapshot arrives. The state update itself happens only from
  // realtime/fetch callbacks, not synchronously in the effect body.
  const rows =
    snapshot.accountId === accountId ? snapshot.rows : EMPTY_PRESENCE_MAP;

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    let cancelled = false;
    const generation = ++channelGenerationRef.current;

    const updateRows = (update: (previous: PresenceMap) => PresenceMap) => {
      if (cancelled) return;
      setSnapshot((previous) => {
        const previousRows =
          previous.accountId === accountId ? previous.rows : EMPTY_PRESENCE_MAP;
        return { accountId, rows: update(previousRows) };
      });
    };

    const applyRow = (row: {
      user_id: string;
      status: StoredPresence;
      last_seen_at: string;
      availability?: AvailabilityStatus;
      last_assigned_at?: string | null;
    }) => {
      updateRows((prev) => {
        const next = new Map(prev);
        next.set(row.user_id, {
          status: row.status,
          last_seen_at: row.last_seen_at,
          availability: row.availability ?? "offline",
          last_assigned_at: row.last_assigned_at ?? null,
        });
        return next;
      });
    };

    // Subscribe first, then snapshot. The snapshot merges into whatever
    // Realtime has already delivered, preserving the newer last_seen_at.
    const channel: RealtimeChannel = supabase
      .channel(presenceChannelTopic(accountId, generation))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "member_presence",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { user_id?: string };
            if (!old.user_id) return;
            updateRows((prev) => {
              if (!prev.has(old.user_id!)) return prev;
              const next = new Map(prev);
              next.delete(old.user_id!);
              return next;
            });
            return;
          }

          applyRow(
            payload.new as {
              user_id: string;
              status: StoredPresence;
              last_seen_at: string;
              availability?: AvailabilityStatus;
              last_assigned_at?: string | null;
            },
          );
        },
      )
      .subscribe();

    supabase
      .from("member_presence")
      .select("user_id, status, last_seen_at, availability, last_assigned_at")
      .eq("account_id", accountId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[PresenceProvider] initial fetch error:", error.message);
          return;
        }

        updateRows((prev) => {
          const next = new Map(prev);
          for (const r of data ?? []) {
            const userId = r.user_id as string;
            const incoming: PresenceRow = {
              status: r.status as StoredPresence,
              last_seen_at: r.last_seen_at as string,
              availability:
                (r.availability as AvailabilityStatus | undefined) ?? "offline",
              last_assigned_at: r.last_assigned_at as string | null | undefined,
            };
            const existing = next.get(userId);

            // A live event that arrived first must win over a staler snapshot.
            if (
              !existing ||
              new Date(incoming.last_seen_at) > new Date(existing.last_seen_at)
            ) {
              next.set(userId, incoming);
            }
          }
          return next;
        });
      });

    const tick = setInterval(() => setNow(Date.now()), RE_DERIVE_MS);

    return () => {
      cancelled = true;
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [accountId]);

  const getRow = useCallback(
    (userId: string): PresenceRow | undefined => rows.get(userId),
    [rows],
  );

  const getPresence = useCallback(
    (userId: string): PresenceStatus => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now],
  );

  const value = useMemo(
    () => ({ getPresence, getRow, now }),
    [getPresence, getRow, now],
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

/**
 * Read live presence for the caller's account. `enabled: false` preserves
 * the old opt-out behavior for temporarily inactive consumers.
 */
export function usePresence(enabled = true): UsePresenceResult {
  const presence = useContext(PresenceContext);
  return enabled ? presence : EMPTY_PRESENCE;
}
