-- ============================================================
-- 040_conversation_routing.sql
--
-- Automatic conversation routing. The allocator is deliberately kept in
-- PostgreSQL so queue ordering, capacity checks, stale-agent release and
-- assignment happen in one account-scoped transaction.
-- ============================================================

-- Account-wide cap. Existing accounts receive the safe default.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS max_active_conversations_per_agent INTEGER
    NOT NULL DEFAULT 400;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_max_active_conversations_per_agent_positive'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_max_active_conversations_per_agent_positive
      CHECK (max_active_conversations_per_agent > 0);
  END IF;
END $$;

-- Manual routing availability is separate from visual presence. A stale tab
-- can keep reporting online/away for the UI while remaining ineligible for
-- automatic assignment because the heartbeat is checked independently.
ALTER TABLE member_presence
  ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'offline';

ALTER TABLE member_presence
  ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_presence_availability_check'
      AND conrelid = 'public.member_presence'::regclass
  ) THEN
    ALTER TABLE member_presence
      ADD CONSTRAINT member_presence_availability_check
      CHECK (availability IN ('online', 'offline'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_routing_queue
  ON conversations(account_id, created_at, id)
  WHERE status IN ('open', 'pending') AND assigned_agent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_routing_load
  ON conversations(account_id, assigned_agent_id, status)
  WHERE assigned_agent_id IS NOT NULL AND status IN ('open', 'pending');

CREATE INDEX IF NOT EXISTS idx_messages_routing_latest
  ON messages(conversation_id, sender_type, created_at DESC);

-- ============================================================
-- route_account_conversations(account_id)
--
-- Only the service role can call this directly. Authenticated agents reach
-- it through set_agent_availability(), and conversation changes reach it
-- through the trigger below. The account row lock serializes allocator runs
-- for one tenant while FOR UPDATE SKIP LOCKED protects the queue rows.
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

  -- This lock makes all allocator invocations for an account observe and
  -- update one consistent workload snapshot. It also prevents two webhook
  -- requests from selecting the same least-loaded agent simultaneously.
  SELECT max_active_conversations_per_agent
  INTO v_capacity
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = '22023';
  END IF;

  -- Release only conversations that still await a human response. Bot
  -- messages do not satisfy this condition, so a handled conversation keeps
  -- its owner even when that owner goes stale or offline.
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

  -- Claim the oldest queued conversation repeatedly. The row lock is held
  -- until this function returns; SKIP LOCKED lets an independent allocator
  -- avoid waiting on a queue row if it is ever invoked outside the account
  -- serialization path.
  LOOP
    SELECT c.id
    INTO v_queued
    FROM conversations c
    WHERE c.account_id = p_account_id
      AND c.status IN ('open', 'pending')
      AND c.assigned_agent_id IS NULL
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    SELECT p.user_id
    INTO v_agent_id
    FROM profiles p
    JOIN member_presence mp
      ON mp.user_id = p.user_id
     AND mp.account_id = p.account_id
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS active_count
      FROM conversations load_c
      WHERE load_c.account_id = p_account_id
        AND load_c.assigned_agent_id = p.user_id
        AND load_c.status IN ('open', 'pending')
    ) load ON TRUE
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

    -- No eligible member or every member is at capacity. Keep this and all
    -- remaining queued conversations unassigned for the next routing event.
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

-- ============================================================
-- set_agent_availability(availability)
--
-- Self-only RPC. The account and target user always come from auth.uid(),
-- never from browser input. It runs routing in the same transaction so an
-- agent becoming online immediately receives queued work.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_agent_availability(
  p_availability TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_availability NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Invalid availability' USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_account_id, v_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL OR v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'Only team agents can change availability'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO member_presence (
    user_id, account_id, availability, status, last_seen_at
  )
  VALUES (
    auth.uid(), v_account_id, p_availability, 'online', now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET availability = excluded.availability,
        account_id = excluded.account_id;

  PERFORM public.route_account_conversations(v_account_id);
  RETURN p_availability;
END;
$$;

ALTER FUNCTION public.set_agent_availability(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_agent_availability(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_availability(TEXT) TO authenticated;

-- A manager's explicit unassign, or closing a conversation, can expose more
-- queue work. The depth guard prevents the allocator's own updates from
-- recursively invoking itself.
CREATE OR REPLACE FUNCTION public.route_after_conversation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_agent_id IS NULL OR NEW.status = 'closed' THEN
    PERFORM public.route_account_conversations(NEW.account_id);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Routing is important but must never make an otherwise valid manual
  -- status/assignment update fail. The next inbound or availability event
  -- retries the allocator.
  RAISE WARNING 'Conversation routing failed for account %: %', NEW.account_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.route_after_conversation_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS route_after_conversation_change ON conversations;
CREATE TRIGGER route_after_conversation_change
  AFTER UPDATE OF assigned_agent_id, status ON conversations
  FOR EACH ROW
  WHEN (
    OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id
    OR OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION public.route_after_conversation_change();
