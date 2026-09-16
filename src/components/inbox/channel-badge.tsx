'use client';

import { useTranslations } from 'next-intl';

import type { Conversation } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  getInboxChannelLabelKey,
  normalizeInboxChannel,
  type InboxChannel,
} from '@/lib/inbox/channels';

const CHANNEL_STYLES: Record<InboxChannel, string> = {
  whatsapp:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  instagram:
    'border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-300',
  messenger:
    'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300',
};

export function ConversationChannelBadge({
  channel,
  className,
}: {
  channel?: Conversation['channel'];
  className?: string;
}) {
  const t = useTranslations('Inbox.channel');
  const normalizedChannel = normalizeInboxChannel(channel);
  const label = t(getInboxChannelLabelKey(normalizedChannel));

  return (
    <Badge
      variant="outline"
      data-channel={normalizedChannel}
      aria-label={label}
      title={label}
      className={cn(
        'h-5 shrink-0 px-1.5 text-[10px]',
        CHANNEL_STYLES[normalizedChannel],
        className
      )}
    >
      {label}
    </Badge>
  );
}
