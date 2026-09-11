export type MessageVisibilityState = 'visible' | 'hidden' | 'prerender';

export interface IncomingMessageSoundEvent {
  eventType: string;
  senderType: string | undefined;
  visibilityState: MessageVisibilityState;
}

/** Play a sound only for new inbound customer messages in another tab. */
export function shouldPlayIncomingMessageSound({
  eventType,
  senderType,
  visibilityState,
}: IncomingMessageSoundEvent): boolean {
  return (
    eventType === 'INSERT' &&
    senderType === 'customer' &&
    visibilityState !== 'visible'
  );
}
