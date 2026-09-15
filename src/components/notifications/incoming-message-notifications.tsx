'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useRealtime } from '@/hooks/use-realtime';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  claimMessageNotification,
  getNotificationPreview,
  isIncomingMessage,
} from '@/lib/notifications/incoming-message';

type BrowserNotificationPermission = NotificationPermission | 'unsupported';

interface ContactLabel {
  name?: string | null;
  phone?: string | null;
}

function getStoredNotificationPermission(): BrowserNotificationPermission {
  return typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'unsupported';
}

const notificationPermissionListeners = new Set<() => void>();

function subscribeToNotificationPermission(listener: () => void) {
  notificationPermissionListeners.add(listener);
  return () => notificationPermissionListeners.delete(listener);
}

function getServerNotificationPermission(): BrowserNotificationPermission {
  return 'default';
}

function notifyPermissionListeners() {
  notificationPermissionListeners.forEach((listener) => listener());
}

export function IncomingMessageNotifications() {
  const t = useTranslations('MessageNotifications');
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const permission = useSyncExternalStore(
    subscribeToNotificationPermission,
    getStoredNotificationPermission,
    getServerNotificationPermission
  );
  const userId = user?.id;

  const activeConversationId =
    pathname === '/inbox' ? searchParams.get('c') : null;

  const openConversation = useCallback(
    (conversationId: string) => {
      router.push(`/inbox?c=${encodeURIComponent(conversationId)}`);
    },
    [router]
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    if (Notification.permission === 'denied') {
      toast.info(t('permissionDenied'));
      return;
    }

    const nextPermission = await Notification.requestPermission();
    notifyPermissionListeners();

    if (nextPermission === 'granted') {
      toast.success(t('permissionGranted'));
    } else if (nextPermission === 'denied') {
      toast.info(t('permissionDenied'));
    }
  }, [t]);

  const findContactLabel = useCallback(
    async (conversationId: string): Promise<string> => {
      const { data, error } = await createClient()
        .from('conversations')
        .select('contact:contacts(name, phone)')
        .eq('id', conversationId)
        .maybeSingle();

      if (error) {
        console.error(
          'Failed to load contact for message notification:',
          error
        );
      }

      const contact = data?.contact as ContactLabel | ContactLabel[] | null;
      const label = Array.isArray(contact) ? contact[0] : contact;
      return label?.name?.trim() || label?.phone?.trim() || t('unknownContact');
    },
    [t]
  );

  const handleMessageEvent = useCallback(
    async (
      message: Parameters<
        NonNullable<Parameters<typeof useRealtime>[0]['onMessageEvent']>
      >[0]['new']
    ) => {
      if (!userId || !isIncomingMessage(message)) return;

      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        // Some privacy modes disable localStorage. The notification can
        // still be shown, but cross-tab deduplication is unavailable.
      }

      const claimed = storage
        ? claimMessageNotification(storage, userId, message.id)
        : true;
      if (!claimed) return;

      // The open thread already renders this message, so it should not also
      // announce it as a notification. The claim still suppresses duplicate
      // notices from other CRM tabs.
      if (activeConversationId === message.conversation_id) return;

      const [who, preview] = await Promise.all([
        findContactLabel(message.conversation_id),
        Promise.resolve(getNotificationPreview(message, t('messageFallback'))),
      ]);
      const title = t('newMessageFrom', { who });

      if (
        typeof Notification !== 'undefined' &&
        permission === 'granted' &&
        document.visibilityState === 'hidden'
      ) {
        try {
          const notification = new Notification(title, {
            body: preview,
            icon: '/logo.webp',
            tag: `wacrm-message-${message.id}`,
          });
          notification.onclick = () => {
            window.focus();
            openConversation(message.conversation_id);
            notification.close();
          };
          return;
        } catch (error) {
          console.error('Failed to show browser message notification:', error);
        }
      }

      toast(title, {
        id: `wacrm-message-${message.id}`,
        description: preview,
        duration: 8_000,
        action: {
          label: t('openConversation'),
          onClick: () => openConversation(message.conversation_id),
        },
      });
    },
    [
      activeConversationId,
      findContactLabel,
      openConversation,
      permission,
      t,
      userId,
    ]
  );

  useRealtime({
    channelName: 'message-notifications',
    enabled: Boolean(userId),
    onMessageEvent: (event) => {
      if (event.eventType === 'INSERT') void handleMessageEvent(event.new);
    },
  });

  if (permission === 'unsupported') return null;

  const isEnabled = permission === 'granted';
  const isBlocked = permission === 'denied';
  const label = isEnabled
    ? t('permissionEnabled')
    : isBlocked
      ? t('permissionBlocked')
      : t('enableNotifications');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={
        isEnabled ? () => toast.info(t('permissionEnabled')) : requestPermission
      }
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {isEnabled ? (
        <BellRing className="text-primary h-4 w-4" />
      ) : isBlocked ? (
        <BellOff className="h-4 w-4" />
      ) : (
        <Bell className="h-4 w-4" />
      )}
      <span className="sr-only">{label}</span>
    </Button>
  );
}
