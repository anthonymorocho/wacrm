-- ============================================================
-- 049_zernio_messenger.sql
--
-- Account-scoped Zernio connection metadata. The existing Meta channel
-- tables remain the Inbox channel identity so conversations/messages keep
-- their foreign keys and the shared inbound processor stays reusable.
-- ============================================================

-- A channel can now be fed either by Meta directly or by Zernio. Zernio
-- channels do not have Meta credentials; those columns are nullable only
-- for this provider path. Direct Meta routes filter integration_source.
ALTER TABLE public.meta_channels
  ADD COLUMN IF NOT EXISTS integration_source TEXT NOT NULL DEFAULT 'meta'
    CHECK (integration_source IN ('meta', 'zernio')),
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_page_id TEXT;

ALTER TABLE public.meta_channels
  ALTER COLUMN access_token DROP NOT NULL,
  ALTER COLUMN app_secret DROP NOT NULL,
  ALTER COLUMN verify_token DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_channels_source
  ON public.meta_channels(account_id, integration_source, provider);

-- One Zernio profile represents one CRM account. Profiles are created lazily
-- when an administrator starts the first Facebook connection.
CREATE TABLE IF NOT EXISTS public.zernio_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zernio_profile_id TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_zernio_profiles_account
  ON public.zernio_profiles(account_id);

ALTER TABLE public.zernio_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_profiles TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.zernio_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.zernio_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The account map is the routing boundary for Zernio inbox webhooks. Keep
-- the Zernio account id unique so a delivery can never resolve to two CRM
-- accounts, even if one profile is misconfigured.
CREATE TABLE IF NOT EXISTS public.zernio_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_channel_id UUID NOT NULL REFERENCES public.meta_channels(id) ON DELETE CASCADE,
  zernio_profile_id TEXT NOT NULL REFERENCES public.zernio_profiles(zernio_profile_id) ON DELETE CASCADE,
  zernio_account_id TEXT NOT NULL UNIQUE,
  facebook_page_id TEXT NOT NULL,
  facebook_page_name TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id),
  UNIQUE (meta_channel_id),
  UNIQUE (zernio_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_zernio_connections_account
  ON public.zernio_connections(account_id, status);
CREATE INDEX IF NOT EXISTS idx_zernio_connections_lookup
  ON public.zernio_connections(zernio_profile_id, zernio_account_id);

ALTER TABLE public.zernio_connections ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_connections TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.zernio_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.zernio_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Durable replay key for Zernio's at-least-once webhook delivery. The
-- processing columns make failures observable without exposing the payload
-- to authenticated browser clients.
CREATE TABLE IF NOT EXISTS public.zernio_webhook_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_events_pending
  ON public.zernio_webhook_events(received_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.zernio_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_webhook_events TO service_role;
