'use client';

import { useEffect, useRef } from 'react';

import type { RealtimeChannel } from '@supabase/supabase-js';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { shouldPlayIncomingMessageSound } from '@/lib/incoming-message-sound';

const SOUND_DURATION_SECONDS = 0.24;
const SOUND_FREQUENCY_HZ = 880;
const MAX_SEEN_MESSAGE_IDS = 500;

function playIncomingMessageTone(audioContext: AudioContext) {
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(SOUND_FREQUENCY_HZ, now);
  oscillator.frequency.exponentialRampToValueAtTime(660, now + SOUND_DURATION_SECONDS);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + SOUND_DURATION_SECONDS);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + SOUND_DURATION_SECONDS);
}

/**
 * Listen once at the dashboard shell so an inbound message can alert the
 * user even when the Inbox is open in a different browser tab.
 */
export function useIncomingMessageSound() {
  const { accountId } = useAuth();
  const audioContextRef = useRef<AudioContext | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const getAudioContext = () => {
      if (typeof window === 'undefined' || !window.AudioContext) return null;
      if (!audioContextRef.current) {
        audioContextRef.current = new window.AudioContext();
      }
      return audioContextRef.current;
    };

    const unlockAudio = () => {
      const audioContext = getAudioContext();
      if (audioContext?.state === 'suspended') {
        void audioContext.resume().catch(() => undefined);
      }
    };

    const playTone = () => {
      const audioContext = getAudioContext();
      if (!audioContext) return;

      const play = () => {
        if (!cancelled) playIncomingMessageTone(audioContext);
      };

      if (audioContext.state === 'suspended') {
        void audioContext.resume().then(play).catch(() => undefined);
      } else {
        play();
      }
    };

    channel = supabase
      .channel(`incoming-message-sound:${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const message = payload.new as {
            id?: string;
            sender_type?: string;
          };
          if (!message.id || seenMessageIdsRef.current.has(message.id)) return;

          const seenIds = seenMessageIdsRef.current;
          seenIds.add(message.id);
          if (seenIds.size > MAX_SEEN_MESSAGE_IDS) {
            const oldestId = seenIds.values().next().value;
            if (oldestId) seenIds.delete(oldestId);
          }

          if (
            shouldPlayIncomingMessageSound({
              eventType: payload.eventType,
              senderType: message.sender_type,
              visibilityState: document.visibilityState,
            })
          ) {
            playTone();
          }
        },
      )
      .subscribe();

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext) void audioContext.close().catch(() => undefined);
    };
  }, [accountId]);
}
