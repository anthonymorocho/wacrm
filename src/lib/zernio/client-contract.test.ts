import { describe, expect, it } from 'vitest';

import {
  indexZernioConnections,
  zernioCommentReplyPayload,
} from './client-contract';

describe('Zernio client contracts', () => {
  it('indexes Messenger under Facebook and keeps Instagram separate', () => {
    expect(
      indexZernioConnections([
        {
          id: 'page-connection',
          provider: 'messenger',
          display_name: 'Acme Page',
          status: 'connected',
          connected_at: null,
        },
        {
          id: 'ig-connection',
          provider: 'instagram',
          display_name: 'Acme IG',
          status: 'connected',
          connected_at: null,
        },
      ])
    ).toEqual({
      facebook: expect.objectContaining({ id: 'page-connection' }),
      instagram: expect.objectContaining({ id: 'ig-connection' }),
    });
  });

  it('omits comment_id for a public reply to the selected local post', () => {
    expect(zernioCommentReplyPayload('local-post-1', null, 'Hello')).toEqual({
      social_post_id: 'local-post-1',
      message: 'Hello',
    });
  });

  it('includes comment_id for a public reply to a comment', () => {
    expect(
      zernioCommentReplyPayload('local-post-1', 'remote-comment-1', 'Hello')
    ).toEqual({
      social_post_id: 'local-post-1',
      comment_id: 'remote-comment-1',
      message: 'Hello',
    });
  });
});
