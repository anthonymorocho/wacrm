-- ============================================================
-- 045_queue_visibility.sql
--
-- Every member may read the shared unassigned queue. Assigned
-- conversations remain restricted to owners/admins or the assigned agent,
-- and the existing write policies are unchanged. Queue visibility is limited
-- to open/pending rows so closed history is not exposed by the shared queue.
-- ============================================================

-- Remove the read policies before replacing the helper they depend on.
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS message_reactions_select ON message_reactions;

DROP FUNCTION IF EXISTS public.can_view_conversation(UUID, UUID);

CREATE OR REPLACE FUNCTION public.can_view_conversation(
  p_account_id UUID,
  p_assigned_agent_id UUID,
  p_status TEXT
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
          p_assigned_agent_id IS NULL
          AND p_status IN ('open', 'pending')
        )
        OR (
          caller.account_role = 'agent'
          AND p_assigned_agent_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION public.can_view_conversation(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_view_conversation(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_conversation(UUID, UUID, TEXT)
  TO authenticated, service_role;

-- The helper owns the full read invariant: owners/admins retain their
-- operational overview, while unassigned rows are shared only while they are
-- active queue work.
CREATE POLICY conversations_select ON conversations
FOR SELECT USING (
  public.can_view_conversation(account_id, assigned_agent_id, status)
);

CREATE POLICY messages_select ON messages
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM conversations AS c
    WHERE c.id = messages.conversation_id
      AND public.can_view_conversation(
        c.account_id,
        c.assigned_agent_id,
        c.status
      )
  )
);

CREATE POLICY message_reactions_select ON message_reactions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM messages AS m
    JOIN conversations AS c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND public.can_view_conversation(
        c.account_id,
        c.assigned_agent_id,
        c.status
      )
  )
);
