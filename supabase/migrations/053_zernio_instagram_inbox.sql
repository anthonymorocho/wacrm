-- Allow one Zernio inbox account per CRM channel provider under the same
-- account-owned profile. Existing rows are the current Facebook Messenger
-- connection and are backfilled without changing their channel IDs.
ALTER TABLE public.zernio_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'messenger'
    CHECK (provider IN ('messenger', 'instagram')),
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE public.zernio_connections
SET external_account_id = facebook_page_id,
    display_name = facebook_page_name
WHERE external_account_id IS NULL;

ALTER TABLE public.zernio_connections
  ALTER COLUMN external_account_id SET NOT NULL,
  ALTER COLUMN facebook_page_id DROP NOT NULL;

ALTER TABLE public.zernio_connections
  DROP CONSTRAINT IF EXISTS zernio_connections_account_id_key,
  DROP CONSTRAINT IF EXISTS zernio_connections_zernio_profile_id_key,
  ADD CONSTRAINT zernio_connections_account_provider_key
    UNIQUE (account_id, provider);

-- A CRM account keeps one Zernio profile, which may contain both platforms.
-- The Zernio account id remains globally unique as the webhook routing key.

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_platform_check,
  ADD CONSTRAINT social_posts_platform_check
    CHECK (platform IN ('facebook', 'instagram')) NOT VALID;
ALTER TABLE public.social_posts
  VALIDATE CONSTRAINT social_posts_platform_check;

ALTER TABLE public.social_comments
  DROP CONSTRAINT IF EXISTS social_comments_platform_check,
  ADD CONSTRAINT social_comments_platform_check
    CHECK (platform IN ('facebook', 'instagram')) NOT VALID;
ALTER TABLE public.social_comments
  VALIDATE CONSTRAINT social_comments_platform_check;
