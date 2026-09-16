-- ============================================================
-- 048_meta_messaging_inbound.sql
--
-- Additive support for inbound Instagram and Facebook Messenger
-- messages. Existing WhatsApp rows keep their historical shape and
-- receive channel = 'whatsapp' through the defaults below.
--
-- Secrets in meta_channels are encrypted application-side with the
-- same AES-256-GCM helper used by whatsapp_config. This migration
-- intentionally does not attempt to encrypt or rewrite existing data.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meta_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'messenger')),
  external_account_id TEXT NOT NULL,
  -- access_token, app_secret, and verify_token contain encrypted values.
  access_token TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_channels_account
  ON public.meta_channels(account_id, provider);
CREATE INDEX IF NOT EXISTS idx_meta_channels_lookup
  ON public.meta_channels(provider, external_account_id);

ALTER TABLE public.meta_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_channels_select ON public.meta_channels;
DROP POLICY IF EXISTS meta_channels_insert ON public.meta_channels;
DROP POLICY IF EXISTS meta_channels_update ON public.meta_channels;
DROP POLICY IF EXISTS meta_channels_delete ON public.meta_channels;

-- Credentials must never be readable through the browser's authenticated
-- Supabase client, even in encrypted form. API routes authenticate the
-- caller with requireRole() and use the service-role client with explicit
-- account filters; the webhook is service-role only by design.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_channels TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.meta_contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.meta_channels(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_contact_identities_contact
  ON public.meta_contact_identities(contact_id);

ALTER TABLE public.meta_contact_identities ENABLE ROW LEVEL SECURITY;
-- Social identities are an inbound integration detail. They are read and
-- written by the service-role webhook only; contacts remain the Inbox API.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.meta_contact_identities TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_contact_identities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_contact_identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.contacts
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS channel_id UUID
    REFERENCES public.meta_channels(id) ON DELETE SET NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS channel_id UUID
    REFERENCES public.meta_channels(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_channel_check'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'instagram', 'messenger'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_channel_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_channel_check
      CHECK (channel IN ('whatsapp', 'instagram', 'messenger'));
  END IF;
END $$;

-- WhatsApp message ids are intentionally not globally unique. Social
-- provider ids are replay keys only within the configured channel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_channel_message_id
  ON public.messages(channel_id, message_id)
  WHERE channel_id IS NOT NULL AND message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_channel
  ON public.conversations(account_id, channel, channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel
  ON public.messages(channel_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'meta_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_channels;
  END IF;
END $$;
