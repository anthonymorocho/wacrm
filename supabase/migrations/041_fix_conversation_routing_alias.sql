-- ============================================================
-- 041_fix_conversation_routing_alias.sql
--
-- Replaces the allocator's release query with a CTE so the target
-- conversations table is never referenced through a correlated subquery
-- from the UPDATE statement. This fixes PostgreSQL's
-- "invalid reference to FROM-clause entry for table c" error when an
-- agent changes availability.
-- ============================================================

CREATE OR REPLACE FUNCTION public.route_account_conversations(
  p_account_id UUID
) RETURNS TABLE (conversation_id UUID, agent_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity INTEGER;
  v_queued RECORD;
  v_agent_id UUID;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Account is required' USING ERRCODE = '22023';
  END IF;

  SELECT max_active_conversations_per_agent
  INTO v_capacity
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = '22023';
  END IF;

  -- Release only unanswered conversations owned by unavailable agents.
  -- The target UPDATE is intentionally separate from the CTE so no
  -- correlated subquery references its UPDATE alias.
  WITH releasable AS (
    SELECT conv.id
    FROM conversations AS conv
    LEFT JOIN member_presence AS mp
      ON mp.user_id = conv.assigned_agent_id
     AND mp.account_id = p_account_id
    LEFT JOIN LATERAL (
      SELECT
        max(m.created_at) FILTER (WHERE m.sender_type = 'customer')
          AS latest_customer_at,
        max(m.created_at) FILTER (WHERE m.sender_type = 'agent')
          AS latest_human_at
      FROM messages AS m
      WHERE m.conversation_id = conv.id
    ) AS latest ON TRUE
    WHERE conv.account_id = p_account_id
      AND conv.status IN ('open', 'pending')
      AND (
        mp.user_id IS NULL
        OR mp.availability = 'offline'
        OR mp.last_seen_at < now() - INTERVAL '75 seconds'
      )
      AND latest.latest_customer_at IS NOT NULL
      AND (
        latest.latest_human_at IS NULL
        OR latest.latest_customer_at > latest.latest_human_at
      )
  )
  UPDATE conversations AS target
  SET assigned_agent_id = NULL,
      updated_at = now()
  WHERE target.account_id = p_account_id
    AND target.assigned_agent_id IS NOT NULL
    AND target.id IN (SELECT id FROM releasable);

  -- Claim queued conversations oldest-first and distribute them to the
  -- least-loaded eligible member below the configured capacity.
  LOOP
    SELECT c.id
    INTO v_queued
    FROM conversations AS c
    WHERE c.account_id = p_account_id
      AND c.status IN ('open', 'pending')
      AND c.assigned_agent_id IS NULL
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    SELECT p.user_id
    INTO v_agent_id
    FROM profiles AS p
    JOIN member_presence AS mp
      ON mp.user_id = p.user_id
     AND mp.account_id = p.account_id
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS active_count
      FROM conversations AS load_c
      WHERE load_c.account_id = p_account_id
        AND load_c.assigned_agent_id = p.user_id
        AND load_c.status IN ('open', 'pending')
    ) AS load ON TRUE
    WHERE p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND mp.availability = 'online'
      AND mp.last_seen_at >= now() - INTERVAL '75 seconds'
      AND load.active_count < v_capacity
    ORDER BY
      load.active_count ASC,
      mp.last_assigned_at ASC NULLS FIRST,
      p.user_id ASC
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    UPDATE conversations
    SET assigned_agent_id = v_agent_id,
        updated_at = now()
    WHERE id = v_queued.id
      AND account_id = p_account_id
      AND assigned_agent_id IS NULL;

    IF FOUND THEN
      UPDATE member_presence
      SET last_assigned_at = now()
      WHERE user_id = v_agent_id
        AND account_id = p_account_id;

      conversation_id := v_queued.id;
      agent_id := v_agent_id;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION public.route_account_conversations(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.route_account_conversations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.route_account_conversations(UUID) TO service_role;
