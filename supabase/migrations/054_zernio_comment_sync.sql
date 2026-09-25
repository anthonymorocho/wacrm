-- ============================================================
-- 054_zernio_comment_sync.sql
--
-- Share the Zernio comments mirror sync state across all CRM users and
-- app instances. A single atomic claim prevents every page load from
-- repeating the same provider requests.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zernio_comment_syncs (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  zernio_account_id TEXT NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  lease_token UUID,
  PRIMARY KEY (account_id, zernio_account_id)
);

ALTER TABLE public.zernio_comment_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zernio_comment_syncs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zernio_comment_syncs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_zernio_comment_sync(
  p_account_id UUID,
  p_zernio_account_id TEXT,
  p_lease_token UUID
)
RETURNS TABLE (claimed BOOLEAN, syncing BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.zernio_comment_syncs AS sync (
    account_id,
    zernio_account_id,
    last_attempt_at,
    lease_expires_at,
    lease_token
  )
  VALUES (
    p_account_id,
    p_zernio_account_id,
    NOW(),
    NOW() + INTERVAL '20 minutes',
    p_lease_token
  )
  ON CONFLICT (account_id, zernio_account_id) DO UPDATE
  SET last_attempt_at = NOW(),
      lease_expires_at = NOW() + INTERVAL '20 minutes',
      lease_token = EXCLUDED.lease_token
  WHERE (sync.last_attempt_at IS NULL OR sync.last_attempt_at <= NOW() - INTERVAL '5 minutes')
    AND (sync.lease_expires_at IS NULL OR sync.lease_expires_at <= NOW());

  RETURN QUERY
  SELECT
    sync.lease_token = p_lease_token AS claimed,
    COALESCE(sync.lease_expires_at > NOW(), FALSE) AS syncing
  FROM public.zernio_comment_syncs AS sync
  WHERE sync.account_id = p_account_id
    AND sync.zernio_account_id = p_zernio_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_zernio_comment_sync(
  p_account_id UUID,
  p_zernio_account_id TEXT,
  p_lease_token UUID,
  p_succeeded BOOLEAN
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.zernio_comment_syncs
  SET last_synced_at = CASE WHEN p_succeeded THEN NOW() ELSE last_synced_at END,
      lease_expires_at = NULL,
      lease_token = NULL
  WHERE account_id = p_account_id
    AND zernio_account_id = p_zernio_account_id
    AND lease_token = p_lease_token;
$$;

REVOKE ALL ON FUNCTION public.claim_zernio_comment_sync(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zernio_comment_sync(UUID, TEXT, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.finish_zernio_comment_sync(UUID, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_zernio_comment_sync(UUID, TEXT, UUID, BOOLEAN)
  TO service_role;
