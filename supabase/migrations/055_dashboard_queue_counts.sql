-- Return the three unassigned active queue counts in one PostgREST request.
-- SECURITY INVOKER keeps conversations RLS in force for the authenticated
-- caller; the account filter also keeps the aggregate scoped and indexable.
CREATE OR REPLACE FUNCTION public.get_queue_counts(p_account_id UUID)
RETURNS TABLE (
  whatsapp BIGINT,
  messenger BIGINT,
  instagram BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE c.channel = 'whatsapp') AS whatsapp,
    COUNT(*) FILTER (WHERE c.channel = 'messenger') AS messenger,
    COUNT(*) FILTER (WHERE c.channel = 'instagram') AS instagram
  FROM public.conversations AS c
  WHERE c.account_id = p_account_id
    AND c.assigned_agent_id IS NULL
    AND c.status IN ('open', 'pending');
$$;

REVOKE ALL ON FUNCTION public.get_queue_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_queue_counts(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
