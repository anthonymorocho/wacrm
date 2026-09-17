-- ============================================================
-- 050_zernio_account_credentials.sql
--
-- Zernio credentials belong to the CRM account that owns the connected
-- Facebook Page. They are encrypted by the application before insertion and
-- are never exposed through a browser response.
-- ============================================================

ALTER TABLE public.zernio_profiles
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT;

-- Keep this table service-role-only. Authenticated clients do not need to
-- read even the ciphertext; account routes explicitly return safe status.
REVOKE ALL ON public.zernio_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_profiles TO service_role;
