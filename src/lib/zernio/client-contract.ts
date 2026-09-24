export type ZernioUiProvider = 'facebook' | 'instagram';

export interface ZernioPublicConnection {
  id: string;
  provider: 'messenger' | 'instagram';
  display_name: string | null;
  status: 'connected' | 'disconnected';
  connected_at: string | null;
}

export function indexZernioConnections(
  connections: ZernioPublicConnection[]
): Record<ZernioUiProvider, ZernioPublicConnection | null> {
  return {
    facebook:
      connections.find((connection) => connection.provider === 'messenger') ??
      null,
    instagram:
      connections.find((connection) => connection.provider === 'instagram') ??
      null,
  };
}

export function zernioCommentReplyPayload(
  socialPostId: string,
  commentId: string | null,
  message: string
) {
  return {
    social_post_id: socialPostId,
    ...(commentId ? { comment_id: commentId } : {}),
    message,
  };
}
