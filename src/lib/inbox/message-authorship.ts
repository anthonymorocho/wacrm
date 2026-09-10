export interface MessageAuthorProfile {
  user_id: string;
  full_name: string | null | undefined;
}

/** Resolve an inbox author without consulting conversation ownership. */
export function messageAuthorLabel(
  senderType: 'customer' | 'agent' | 'bot',
  senderId: string | null | undefined,
  profiles: readonly MessageAuthorProfile[],
  currentUserId: string | null | undefined,
  currentUserName: string | null | undefined
): string | null {
  if (senderType === 'customer') return null;
  if (senderType === 'bot') return 'AI';

  const profile = senderId
    ? profiles.find((candidate) => candidate.user_id === senderId)
    : null;
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  if (senderId && senderId === currentUserId && currentUserName?.trim()) {
    return currentUserName.trim();
  }
  return 'Agent';
}
