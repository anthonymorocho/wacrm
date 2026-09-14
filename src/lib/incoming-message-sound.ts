export type MessageVisibilityState = 'visible' | 'hidden' | 'prerender';

export interface IncomingMessageSoundEvent {
  eventType: string;
  senderType: string | undefined;
  visibilityState: MessageVisibilityState;
}

export interface IncomingMessageToneNote {
  frequencyHz: number;
  startSeconds: number;
  durationSeconds: number;
  peakGain: number;
}

/** A short ascending chime is easier to recognize than a single pitch sweep. */
export function getIncomingMessageToneNotes(): IncomingMessageToneNote[] {
  return [
    { frequencyHz: 660, startSeconds: 0, durationSeconds: 0.14, peakGain: 0.1 },
    { frequencyHz: 880, startSeconds: 0.13, durationSeconds: 0.22, peakGain: 0.12 },
  ];
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
