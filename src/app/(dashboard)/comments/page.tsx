'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { zernioCommentReplyPayload } from '@/lib/zernio/client-contract';

interface CommentRow {
  id: string;
  provider_comment_id: string;
  social_post_id: string;
  parent_comment_id: string | null;
  message: string;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  author_picture: string | null;
  is_own_account: boolean | null;
  is_reply: boolean;
  created_time: string;
  comment_url: string | null;
  like_count: number;
  reply_count: number;
  can_reply: boolean;
  is_hidden: boolean;
}

interface PostRow {
  id: string;
  platform: 'facebook' | 'instagram';
  provider_post_id: string;
  platform_post_id: string;
  content: string | null;
  picture: string | null;
  permalink: string | null;
  created_time: string | null;
  comment_count: number;
  like_count: number;
  comments: CommentRow[];
}

type ReplyTarget = { postId: string; commentId: string | null } | null;

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function initials(name: string | null, fallback: string): string {
  const value = name?.trim() || fallback;
  return value.slice(0, 2).toUpperCase();
}

function CommentAvatar({
  comment,
  fallback,
}: {
  comment: CommentRow;
  fallback: string;
}) {
  return (
    <div
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        comment.is_own_account
          ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground'
      )}
      aria-hidden="true"
    >
      {initials(comment.author_name, fallback)}
    </div>
  );
}

export default function CommentsPage() {
  const t = useTranslations('Comments');
  const { canSendMessages, profileLoading } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const selectedPost =
    posts.find((post) => post.id === selectedPostId) ?? posts[0] ?? null;

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/zernio/comments', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.code === 'zernio_not_configured'
            ? t('noConnection')
            : body.error || t('loadFailed')
        );
      }
      const nextPosts = Array.isArray(body.posts)
        ? (body.posts as PostRow[])
        : [];
      setPosts(nextPosts);
      setSelectedPostId((current) =>
        nextPosts.some((post) => post.id === current)
          ? current
          : (nextPosts[0]?.id ?? null)
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('loadFailed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!profileLoading) void loadComments();
  }, [loadComments, profileLoading]);

  const topLevelComments = useMemo(
    () =>
      selectedPost?.comments.filter((comment) => !comment.parent_comment_id) ??
      [],
    [selectedPost]
  );

  const repliesByParent = useMemo(() => {
    const grouped = new Map<string, CommentRow[]>();
    for (const comment of selectedPost?.comments ?? []) {
      if (!comment.parent_comment_id) continue;
      const replies = grouped.get(comment.parent_comment_id) ?? [];
      replies.push(comment);
      grouped.set(comment.parent_comment_id, replies);
    }
    return grouped;
  }, [selectedPost]);

  const replyKey = (postId: string, commentId: string | null) =>
    `${postId}:${commentId ?? 'post'}`;

  const sendReply = async (postId: string, commentId: string | null) => {
    const key = replyKey(postId, commentId);
    const message = drafts[key]?.trim() ?? '';
    if (!message || sendingKey) return;
    setSendingKey(key);
    try {
      const response = await fetch('/api/zernio/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          zernioCommentReplyPayload(postId, commentId, message)
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('replyFailed'));
      const sentComment = body.comment as CommentRow;
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? { ...post, comments: [...post.comments, sentComment] }
            : post
        )
      );
      setDrafts((current) => ({ ...current, [key]: '' }));
      setReplyTarget(null);
      toast.success(t('replySent'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('replyFailed'));
    } finally {
      setSendingKey(null);
    }
  };

  const renderReplyComposer = (postId: string, commentId: string | null) => {
    if (!canSendMessages) return null;
    const key = replyKey(postId, commentId);
    const isOpen =
      replyTarget?.postId === postId && replyTarget.commentId === commentId;
    if (!isOpen) return null;
    const sending = sendingKey === key;
    return (
      <div className="mt-3 space-y-2">
        <Textarea
          autoFocus
          value={drafts[key] ?? ''}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [key]: event.target.value }))
          }
          placeholder={t('replyPlaceholder')}
          rows={2}
          disabled={sending}
          className="bg-background min-h-16 resize-none"
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReplyTarget(null)}
            disabled={sending}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void sendReply(postId, commentId)}
            disabled={sending || !drafts[key]?.trim()}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            {sending ? t('sending') : t('sendReply')}
          </Button>
        </div>
      </div>
    );
  };

  const renderComment = (comment: CommentRow, nested = false) => {
    const commentName =
      comment.author_name || comment.author_username || t('anonymous');
    return (
      <div
        key={comment.id}
        className={cn(nested && 'border-border ml-8 border-l pl-4')}
      >
        <div className="flex gap-3">
          <CommentAvatar comment={comment} fallback={commentName} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-foreground font-medium">
                {comment.is_own_account ? t('you') : commentName}
              </span>
              <span className="text-muted-foreground text-xs">
                {dateLabel(comment.created_time)}
              </span>
            </div>
            <p className="text-foreground/90 mt-1 text-sm leading-6 whitespace-pre-wrap">
              {comment.message}
            </p>
            {comment.is_hidden ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('commentHidden')}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-3">
              {canSendMessages && comment.can_reply ? (
                <button
                  type="button"
                  className="text-primary text-xs font-medium hover:underline"
                  onClick={() =>
                    setReplyTarget({
                      postId: selectedPost!.id,
                      commentId: comment.provider_comment_id,
                    })
                  }
                >
                  {t('replyToComment')}
                </button>
              ) : null}
              {comment.comment_url ? (
                <a
                  href={comment.comment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  <ExternalLink className="size-3" />
                  {t(
                    selectedPost?.platform === 'instagram'
                      ? 'instagram'
                      : 'facebook'
                  )}
                </a>
              ) : null}
            </div>
            {renderReplyComposer(selectedPost!.id, comment.provider_comment_id)}
          </div>
        </div>
        <div className="mt-3 space-y-4">
          {(repliesByParent.get(comment.provider_comment_id) ?? []).map(
            (reply) => renderComment(reply, true)
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-[50vh] items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground text-2xl font-bold tracking-tight">
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t('description')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadComments()}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
          {loading ? t('refreshing') : t('refresh')}
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5 mt-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-destructive text-sm">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadComments()}
            >
              {t('refresh')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!error && posts.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <div className="bg-primary/10 text-primary mb-4 flex size-12 items-center justify-center rounded-full">
              <MessageCircle className="size-6" />
            </div>
            <h3 className="text-foreground font-medium">{t('emptyTitle')}</h3>
            <p className="text-muted-foreground mt-1 max-w-md text-sm">
              {t('emptyDescription')}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {posts.length > 0 ? (
        <div className="mt-6 grid min-h-[calc(100vh-13rem)] gap-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.8fr)]">
          <Card className="min-h-0">
            <CardHeader className="border-border border-b">
              <CardTitle>{t('posts')}</CardTitle>
              <CardDescription>{t('refreshHint')}</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-2 overflow-y-auto pt-4">
              {posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => setSelectedPostId(post.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    selectedPost?.id === post.id
                      ? 'border-primary/40 bg-primary/10'
                      : 'hover:bg-muted border-transparent'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="bg-muted size-12 shrink-0 rounded-md bg-cover bg-center"
                      style={
                        post.picture
                          ? { backgroundImage: `url(${post.picture})` }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground line-clamp-2 text-sm font-medium">
                        {post.content || t('postWithoutText')}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t(
                          post.platform === 'instagram'
                            ? 'instagram'
                            : 'facebook'
                        )}
                        {' · '}
                        {t('commentsCount', { count: post.comments.length })}
                        {post.created_time
                          ? ` · ${dateLabel(post.created_time)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="min-h-0">
            {selectedPost ? (
              <>
                <CardHeader className="border-border border-b">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="line-clamp-2">
                        {selectedPost.content || t('postWithoutText')}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {t(
                          selectedPost.platform === 'instagram'
                            ? 'instagram'
                            : 'facebook'
                        )}
                        {' · '}
                        {t('commentsCount', {
                          count: selectedPost.comments.length,
                        })}
                      </CardDescription>
                    </div>
                    {selectedPost.permalink ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <a
                            href={selectedPost.permalink}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <ExternalLink />
                        {t('openPost', {
                          provider: t(
                            selectedPost.platform === 'instagram'
                              ? 'instagram'
                              : 'facebook'
                          ),
                        })}
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                  {canSendMessages ? (
                    <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-foreground text-sm font-medium">
                          {t('replyToPost')}
                        </p>
                        {replyTarget?.postId === selectedPost.id &&
                        replyTarget.commentId === null ? (
                          <span className="text-primary text-xs">
                            {t('sendReply')}
                          </span>
                        ) : null}
                      </div>
                      {!replyTarget ||
                      replyTarget.postId !== selectedPost.id ||
                      replyTarget.commentId !== null ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() =>
                            setReplyTarget({
                              postId: selectedPost.id,
                              commentId: null,
                            })
                          }
                        >
                          <MessageCircle />
                          {t('replyToPost')}
                        </Button>
                      ) : null}
                      {renderReplyComposer(selectedPost.id, null)}
                    </div>
                  ) : (
                    <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-3 py-2 text-xs">
                      {t('viewOnly')}
                    </p>
                  )}

                  {topLevelComments.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      {t('commentsCount', { count: 0 })}
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {topLevelComments.map((comment) =>
                        renderComment(comment)
                      )}
                    </div>
                  )}
                </CardContent>
              </>
            ) : (
              <CardContent className="text-muted-foreground flex min-h-64 items-center justify-center text-sm">
                {t('selectPost')}
              </CardContent>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
