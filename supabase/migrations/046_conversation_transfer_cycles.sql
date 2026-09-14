-- ============================================================
-- 046_conversation_transfer_cycles.sql
--
-- A transfer label belongs to the current active conversation cycle.
-- Closing a conversation ends that cycle; the next inbound message starts
-- fresh and only a later hand-off marks it as transferred again.
-- ============================================================

-- Repair rows created under migration 044 whose transfer bit remained set
-- after the conversation was closed.
UPDATE conversations
SET was_transferred = false
WHERE status = 'closed'
  AND was_transferred = true;

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
    NEW.was_transferred := false;
    RETURN NEW;
  END IF;

  -- The first owner is historical and remains stable across work cycles.
  IF OLD.initial_assigned_agent_id IS NOT NULL THEN
    NEW.initial_assigned_agent_id := OLD.initial_assigned_agent_id;
  ELSIF NEW.assigned_agent_id IS NOT NULL THEN
    NEW.initial_assigned_agent_id := NEW.assigned_agent_id;
  ELSE
    NEW.initial_assigned_agent_id := NULL;
  END IF;

  NEW.was_transferred := COALESCE(OLD.was_transferred, false);

  -- Closing ends the current cycle. Reopening a closed conversation from a
  -- new inbound message also starts a fresh cycle, even though the routing
  -- update clears the old assignment in the same statement.
  IF OLD.status = 'closed' OR NEW.status = 'closed' THEN
    NEW.was_transferred := false;
  ELSIF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id
    AND OLD.assigned_agent_id IS NOT NULL THEN
    -- An active assignment changing owner is a real hand-off.
    NEW.was_transferred := true;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.track_conversation_assignment_history() OWNER TO postgres;
