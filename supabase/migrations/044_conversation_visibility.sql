-- ============================================================
-- 044_conversation_visibility.sql
--
-- Conversation visibility is assignment-scoped for agents. Owners and
-- admins retain the account-wide operational view, including the queue.
-- Assignment history is sticky so a conversation returned to its initial
-- agent remains visibly classified as transferred.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS initial_assigned_agent_id UUID;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS was_transferred BOOLEAN NOT NULL DEFAULT false;

-- Backfill the first known owner for existing assignments. Historical
-- transfers cannot be reconstructed from the current schema, so existing
-- rows start as owned and future changes are tracked from this migration on.
UPDATE conversations
SET initial_assigned_agent_id = assigned_agent_id
WHERE initial_assigned_agent_id IS NULL
  AND assigned_agent_id IS NOT NULL;

UPDATE conversations
SET was_transferred = false
WHERE was_transferred IS NULL;

ALTER TABLE conversations
  ALTER COLUMN was_transferred SET DEFAULT false,
  ALTER COLUMN was_transferred SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_initial_assigned_agent
  ON conversations(account_id, initial_assigned_agent_id, was_transferred);

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent_status
  ON conversations(account_id, assigned_agent_id, status, last_message_at DESC);

-- Keep assignment history in the database, where all assignment paths
-- (routing, webhook reopening, manual UI updates and APIs) share one rule.
CREATE OR REPLACE FUNCTION public.track_conversation_assignment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NOT NULL
       AND NEW.initial_assigned_agent_id IS NULL THEN
      NEW.initial_assigned_agent_id := NEW.assigned_agent_id;
    END IF;
    -- This is a system-owned audit bit, not caller input.
    NEW.was_transferred := false;
    RETURN NEW;
  END IF;

  -- Once the first owner is known it cannot be rewritten by a client update.
  -- If an old row had no owner yet, the first non-null assignment becomes it.
  IF OLD.initial_assigned_agent_id IS NOT NULL THEN
    NEW.initial_assigned_agent_id := OLD.initial_assigned_agent_id;
  ELSIF NEW.assigned_agent_id IS NOT NULL THEN
    NEW.initial_assigned_agent_id := NEW.assigned_agent_id;
  ELSE
    NEW.initial_assigned_agent_id := NULL;
  END IF;

  NEW.was_transferred := COALESCE(OLD.was_transferred, false);
  IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    -- Releasing work for a stale/offline agent is also a hand-off event.
    -- This flag never goes back to false, even when the original agent gets
    -- the conversation again later.
    IF OLD.assigned_agent_id IS NOT NULL THEN
      NEW.was_transferred := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.track_conversation_assignment_history() OWNER TO postgres;

DROP TRIGGER IF EXISTS track_conversation_assignment_history ON conversations;
CREATE TRIGGER track_conversation_assignment_history
  BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.track_conversation_assignment_history();

-- SECURITY DEFINER helpers avoid repeating profile lookups in every child
-- table policy and prevent a policy subquery from accidentally broadening
-- access through the profiles table's own RLS rules.
CREATE OR REPLACE FUNCTION public.can_view_conversation(
  p_account_id UUID,
  p_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles AS caller
    WHERE caller.user_id = auth.uid()
      AND caller.account_id = p_account_id
      AND (
        caller.account_role IN ('owner', 'admin')
        OR (
          caller.account_role = 'agent'
          AND p_assigned_agent_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION public.can_view_conversation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_view_conversation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_conversation(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_modify_conversation(
  p_account_id UUID,
  p_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles AS caller
    WHERE caller.user_id = auth.uid()
      AND caller.account_id = p_account_id
      AND (
        caller.account_role IN ('owner', 'admin')
        OR (
          caller.account_role = 'agent'
          AND p_assigned_agent_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION public.can_modify_conversation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_modify_conversation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_modify_conversation(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_valid_conversation_assignee(
  p_account_id UUID,
  p_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_assigned_agent_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM profiles AS target
      WHERE target.user_id = p_assigned_agent_id
        AND target.account_id = p_account_id
        AND target.account_role IN ('owner', 'admin', 'agent')
    );
$$;

ALTER FUNCTION public.is_valid_conversation_assignee(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_valid_conversation_assignee(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_conversation_assignee(UUID, UUID)
  TO authenticated, service_role;

-- Bulk transfer needs a security-definer write path. A normal
-- UPDATE ... RETURNING would update the row and then hide it from the source
-- agent's SELECT policy because the new assignee is somebody else, making a
-- successful transfer look like an empty batch to PostgREST.
CREATE OR REPLACE FUNCTION public.transfer_conversations(
  p_target_agent_id UUID,
  p_conversation_ids UUID[]
) RETURNS TABLE (id UUID)
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

  SELECT account_id, account_role
  INTO v_account_id, v_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL OR v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'Only team agents can transfer conversations'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_agent_id IS NULL OR p_target_agent_id = auth.uid() THEN
    RAISE EXCEPTION 'Choose another agent as the transfer destination'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_valid_conversation_assignee(
    v_account_id,
    p_target_agent_id
  ) THEN
    RAISE EXCEPTION 'Destination agent was not found in this account'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE conversations
  SET assigned_agent_id = p_target_agent_id,
      updated_at = now()
  WHERE account_id = v_account_id
    AND assigned_agent_id = auth.uid()
    AND status IN ('open', 'pending')
    AND conversations.id = ANY(COALESCE(p_conversation_ids, ARRAY[]::UUID[]))
  RETURNING conversations.id;
END;
$$;

ALTER FUNCTION public.transfer_conversations(UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_conversations(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_conversations(UUID, UUID[])
  TO authenticated, service_role;

-- Replace the account-wide conversation policies created by 017.
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;

CREATE POLICY conversations_select ON conversations
FOR SELECT USING (
  public.can_view_conversation(account_id, assigned_agent_id)
);

CREATE POLICY conversations_insert ON conversations
FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
  AND public.is_valid_conversation_assignee(account_id, assigned_agent_id)
);

-- An agent can update a conversation only while it is theirs. The WITH CHECK
-- clause deliberately allows the new assignee to be another eligible member,
-- which is the secure shape needed for one-step transfers.
CREATE POLICY conversations_update ON conversations
FOR UPDATE
USING (
  public.can_modify_conversation(account_id, assigned_agent_id)
)
WITH CHECK (
  is_account_member(account_id, 'agent')
  AND public.is_valid_conversation_assignee(account_id, assigned_agent_id)
);

CREATE POLICY conversations_delete ON conversations
FOR DELETE USING (
  public.can_modify_conversation(account_id, assigned_agent_id)
);

-- Child rows inherit the conversation boundary. This prevents an agent from
-- bypassing the inbox filter by selecting messages/reactions directly.
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;

CREATE POLICY messages_select ON messages
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM conversations AS c
    WHERE c.id = messages.conversation_id
      AND public.can_view_conversation(c.account_id, c.assigned_agent_id)
  )
);

CREATE POLICY messages_modify ON messages
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM conversations AS c
    WHERE c.id = messages.conversation_id
      AND public.can_modify_conversation(c.account_id, c.assigned_agent_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM conversations AS c
    WHERE c.id = messages.conversation_id
      AND public.can_modify_conversation(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;

CREATE POLICY message_reactions_select ON message_reactions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM messages AS m
    JOIN conversations AS c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND public.can_view_conversation(c.account_id, c.assigned_agent_id)
  )
);

CREATE POLICY message_reactions_modify ON message_reactions
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM messages AS m
    JOIN conversations AS c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND public.can_modify_conversation(c.account_id, c.assigned_agent_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM messages AS m
    JOIN conversations AS c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND public.can_modify_conversation(c.account_id, c.assigned_agent_id)
  )
);
