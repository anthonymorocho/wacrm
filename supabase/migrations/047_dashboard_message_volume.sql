-- ============================================================
-- 047_dashboard_message_volume.sql
--
-- Aggregate dashboard message volume in PostgreSQL so the chart is not
-- truncated by the Supabase REST API max_rows setting.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON public.messages(created_at);

CREATE OR REPLACE FUNCTION public.get_message_volume_by_day(
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text DEFAULT 'UTC'
)
RETURNS TABLE(
  day date,
  incoming bigint,
  outgoing bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (m.created_at AT TIME ZONE p_timezone)::date AS day,
    COUNT(*) FILTER (WHERE m.sender_type = 'customer') AS incoming,
    COUNT(*) FILTER (WHERE m.sender_type <> 'customer') AS outgoing
  FROM public.messages AS m
  WHERE m.created_at >= p_start
    AND m.created_at < p_end
  GROUP BY 1
  ORDER BY 1;
$$;

ALTER FUNCTION public.get_message_volume_by_day(timestamptz, timestamptz, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_message_volume_by_day(timestamptz, timestamptz, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_message_volume_by_day(timestamptz, timestamptz, text)
  TO authenticated;
