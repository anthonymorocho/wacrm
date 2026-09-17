-- ============================================================
-- 052_zernio_comments.sql
--
-- Account-scoped Facebook posts/comments mirrored from Zernio. Browser
-- clients use the authenticated API routes; the raw provider data remains
-- service-role-only and is never exposed through Supabase directly.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meta_channel_id UUID REFERENCES public.meta_channels(id) ON DELETE SET NULL,
  zernio_account_id TEXT NOT NULL,
  provider_post_id TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform = 'facebook'),
  content TEXT,
  picture TEXT,
  permalink TEXT,
  created_time TIMESTAMPTZ,
  comment_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, zernio_account_id, provider_post_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_account_time
  ON public.social_posts(account_id, created_time DESC);

CREATE TABLE IF NOT EXISTS public.social_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  social_post_id UUID NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  zernio_account_id TEXT NOT NULL,
  provider_comment_id TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  parent_comment_id TEXT,
  platform TEXT NOT NULL CHECK (platform = 'facebook'),
  message TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  author_username TEXT,
  author_picture TEXT,
  is_own_account BOOLEAN,
  is_reply BOOLEAN NOT NULL DEFAULT FALSE,
  created_time TIMESTAMPTZ NOT NULL,
  comment_url TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  can_reply BOOLEAN NOT NULL DEFAULT TRUE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, zernio_account_id, provider_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comments_post_time
  ON public.social_comments(social_post_id, created_time ASC);

CREATE INDEX IF NOT EXISTS idx_social_comments_account_time
  ON public.social_comments(account_id, created_time DESC);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts FROM anon, authenticated;
REVOKE ALL ON public.social_comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_comments TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.social_posts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON public.social_comments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
