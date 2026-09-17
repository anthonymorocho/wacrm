-- ============================================================
-- 051_zernio_outbound_messaging.sql
--
-- Keep the provider conversation id alongside the CRM conversation so
-- outbound Messenger replies can target Zernio without a phone number.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_zernio_conversation
  ON public.conversations(zernio_conversation_id)
  WHERE zernio_conversation_id IS NOT NULL;
