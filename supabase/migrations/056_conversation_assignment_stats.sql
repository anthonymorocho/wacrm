-- Store assignment transitions so each agent can see their active, daily,
-- and transferred conversation counts without exposing other agents' rows.
-- Historical transfers cannot be reconstructed; daily transfer counts begin
-- when this migration is applied.
CREATE TABLE IF NOT EXISTS public.conversation_assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  from_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS does not repair a pre-existing table. Keep old
-- event rows undated rather than assigning them a fabricated timestamp; new
-- assignment events receive the timestamp through the column default.
ALTER TABLE public.conversation_assignment_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.conversation_assignment_events
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS conversation_assignment_events_received_idx
  ON public.conversation_assignment_events(account_id, to_agent_id, created_at)
  WHERE to_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_assignment_events_actor_idx
  ON public.conversation_assignment_events(account_id, actor_user_id, created_at)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.conversation_assignment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_assignment_events
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_conversation_assignment_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NOT NULL THEN
      INSERT INTO public.conversation_assignment_events (
        account_id,
        conversation_id,
        from_agent_id,
        to_agent_id,
        actor_user_id
      ) VALUES (
        NEW.account_id,
        NEW.id,
        NULL,
        NEW.assigned_agent_id,
        auth.uid()
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    INSERT INTO public.conversation_assignment_events (
      account_id,
      conversation_id,
      from_agent_id,
      to_agent_id,
      actor_user_id
    ) VALUES (
      NEW.account_id,
      NEW.id,
      OLD.assigned_agent_id,
      NEW.assigned_agent_id,
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_conversation_assignment_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_conversation_assignment_event()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS log_conversation_assignment_event ON public.conversations;
CREATE TRIGGER log_conversation_assignment_event
  AFTER INSERT OR UPDATE OF assigned_agent_id ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_conversation_assignment_event();

-- Only return aggregate counts for the caller. The local-day boundary comes
-- from the browser so "today" follows the user's timezone.
CREATE OR REPLACE FUNCTION public.get_my_conversation_assignment_stats(
  p_today_start TIMESTAMPTZ
)
RETURNS TABLE (
  currently_assigned BIGINT,
  assigned_today BIGINT,
  transferred_today BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_today_start IS NULL OR p_today_start < now() - INTERVAL '36 hours' THEN
    RAISE EXCEPTION 'Invalid local-day start' USING ERRCODE = '22023';
  END IF;

  SELECT profile.account_id
  INTO v_account_id
  FROM public.profiles AS profile
  WHERE profile.user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Account membership required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH current_assignments AS (
    SELECT conversation.id
    FROM public.conversations AS conversation
    WHERE conversation.account_id = v_account_id
      AND conversation.assigned_agent_id = auth.uid()
      AND conversation.status IN ('open', 'pending')
  ),
  assigned_today_conversations AS (
    SELECT assignment_event.conversation_id
    FROM public.conversation_assignment_events AS assignment_event
    WHERE assignment_event.account_id = v_account_id
      AND assignment_event.to_agent_id = auth.uid()
      AND assignment_event.created_at >= p_today_start
    UNION
    SELECT current_assignment.id
    FROM current_assignments AS current_assignment
  ),
  transferred_today_conversations AS (
    SELECT DISTINCT assignment_event.conversation_id
    FROM public.conversation_assignment_events AS assignment_event
    WHERE assignment_event.account_id = v_account_id
      AND assignment_event.actor_user_id = auth.uid()
      AND assignment_event.from_agent_id IS NOT NULL
      AND assignment_event.to_agent_id IS NOT NULL
      AND assignment_event.from_agent_id <> assignment_event.to_agent_id
      AND assignment_event.created_at >= p_today_start
  )
  SELECT
    (SELECT count(*) FROM current_assignments),
    (SELECT count(*) FROM assigned_today_conversations),
    (SELECT count(*) FROM transferred_today_conversations);
END;
$$;

ALTER FUNCTION public.get_my_conversation_assignment_stats(TIMESTAMPTZ)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_conversation_assignment_stats(TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversation_assignment_stats(TIMESTAMPTZ)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
