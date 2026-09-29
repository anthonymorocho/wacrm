-- Account-wide, first-human-response SLA report and its shared thresholds.

CREATE TABLE IF NOT EXISTS public.account_sla_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  optimal_minutes NUMERIC(8, 2) NOT NULL DEFAULT 1,
  low_minutes NUMERIC(8, 2) NOT NULL DEFAULT 15,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_sla_settings_ordered_thresholds
    CHECK (
      optimal_minutes > 0
      AND optimal_minutes < low_minutes
    )
  );

-- Upgrade an earlier draft that stored a third, independent ideal threshold.
-- Keep any existing ideal_minutes values, but stop using them to validate SLA
-- settings: Ideal is now the interval between Optimal and Low.
ALTER TABLE public.account_sla_settings
  DROP CONSTRAINT IF EXISTS account_sla_settings_ordered_thresholds;
ALTER TABLE public.account_sla_settings
  ADD CONSTRAINT account_sla_settings_ordered_thresholds
    CHECK (optimal_minutes > 0 AND optimal_minutes < low_minutes);

ALTER TABLE public.account_sla_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_sla_settings_select ON public.account_sla_settings;
CREATE POLICY account_sla_settings_select ON public.account_sla_settings
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS account_sla_settings_insert ON public.account_sla_settings;
CREATE POLICY account_sla_settings_insert ON public.account_sla_settings
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_sla_settings_update ON public.account_sla_settings;
CREATE POLICY account_sla_settings_update ON public.account_sla_settings
  FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- PostgreSQL cannot change a table-returning function's OUT row type through
-- CREATE OR REPLACE. Drop the previous draft before installing this signature.
DROP FUNCTION IF EXISTS public.get_agent_first_response_sla_report(
  TIMESTAMPTZ,
  TIMESTAMPTZ
);

CREATE FUNCTION public.get_agent_first_response_sla_report(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  agent_id UUID,
  total_conversations BIGINT,
  average_minutes NUMERIC,
  optimal_count BIGINT,
  ideal_count BIGINT,
  low_count BIGINT,
  pending_count BIGINT,
  customer_names TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT profile.account_id, profile.account_role::TEXT
  INTO v_account_id, v_role
  FROM public.profiles AS profile
  WHERE profile.user_id = auth.uid();

  IF v_account_id IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'A valid report period is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH assignment_events AS (
    SELECT
      event.id AS event_id,
      event.conversation_id,
      event.from_agent_id,
      event.to_agent_id,
      event.created_at AS event_at,
      LEAD(event.created_at) OVER (
        PARTITION BY event.conversation_id
        ORDER BY event.created_at, event.id
      ) AS next_event_at,
      LAG(event.created_at) OVER (
        PARTITION BY event.conversation_id
        ORDER BY event.created_at, event.id
      ) AS previous_event_at,
      LAG(event.to_agent_id) OVER (
        PARTITION BY event.conversation_id
        ORDER BY event.created_at, event.id
      ) AS previous_to_agent_id
    FROM public.conversation_assignment_events AS event
    WHERE event.account_id = v_account_id
      AND event.created_at IS NOT NULL
  ),
  assignment_boundaries AS (
    SELECT
      event.*,
      (
        (event.from_agent_id IS NOT NULL
          AND event.from_agent_id <> event.to_agent_id)
        OR (
          event.from_agent_id IS NULL
          AND event.previous_event_at IS NOT NULL
          AND event.previous_to_agent_id IS NULL
        )
      ) AS is_transfer
    FROM assignment_events AS event
    WHERE event.to_agent_id IS NOT NULL
  ),
  first_customer_message AS (
    SELECT DISTINCT ON (message.conversation_id)
      message.conversation_id,
      message.id AS message_id,
      message.created_at AS customer_at
    FROM public.messages AS message
    JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
     AND conversation.account_id = v_account_id
    WHERE message.sender_type = 'customer'
      AND message.status <> 'failed'
    ORDER BY message.conversation_id, message.created_at, message.id
  ),
  event_cycles AS (
    SELECT
      event.conversation_id,
      event.to_agent_id AS assigned_agent_id,
      event.event_at,
      event.next_event_at,
      event.is_transfer,
      COALESCE(
        CASE WHEN event.is_transfer THEN event.event_at END,
        customer_before.created_at,
        customer_after.created_at
      ) AS cycle_started_at,
      CASE
        WHEN event.is_transfer THEN NULL::UUID
        ELSE COALESCE(customer_before.id, customer_after.id)
      END AS start_message_id
    FROM assignment_boundaries AS event
    LEFT JOIN LATERAL (
      SELECT message.id, message.created_at
      FROM public.messages AS message
      WHERE message.conversation_id = event.conversation_id
        AND message.sender_type = 'customer'
        AND message.status <> 'failed'
        AND message.created_at <= event.event_at
        AND (
          event.previous_event_at IS NULL
          OR message.created_at > event.previous_event_at
        )
      ORDER BY
        CASE WHEN event.previous_event_at IS NULL THEN message.created_at END,
        message.created_at DESC,
        message.id DESC
      LIMIT 1
    ) AS customer_before ON true
    LEFT JOIN LATERAL (
      SELECT message.id, message.created_at
      FROM public.messages AS message
      WHERE message.conversation_id = event.conversation_id
        AND message.sender_type = 'customer'
        AND message.status <> 'failed'
        AND message.created_at > event.event_at
        AND (
          event.next_event_at IS NULL
          OR message.created_at < event.next_event_at
        )
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS customer_after ON true
    WHERE event.to_agent_id IS NOT NULL
      AND (
        event.is_transfer
        OR customer_before.id IS NOT NULL
        OR customer_after.id IS NOT NULL
      )
  ),
  legacy_cycles AS (
    -- Older conversations may have transfer events but no event for the
    -- original assignment. Preserve that first cycle up to the first known
    -- transfer; use the current assignee when it is still unanswered.
    SELECT
      conversation.id AS conversation_id,
      COALESCE(
        first_response.sender_id,
        first_transfer.from_agent_id,
        conversation.initial_assigned_agent_id,
        conversation.assigned_agent_id
      )
        AS assigned_agent_id,
      customer.customer_at AS event_at,
      first_transfer.event_at AS next_event_at,
      false AS is_transfer,
      customer.customer_at AS cycle_started_at,
      customer.message_id AS start_message_id
    FROM public.conversations AS conversation
    JOIN first_customer_message AS customer
      ON customer.conversation_id = conversation.id
    LEFT JOIN LATERAL (
      SELECT event.from_agent_id, event.event_at
      FROM assignment_events AS event
        WHERE event.conversation_id = conversation.id
        AND event.from_agent_id IS NOT NULL
        AND event.to_agent_id IS NOT NULL
        AND event.from_agent_id <> event.to_agent_id
      ORDER BY event.event_at, event.event_id
      LIMIT 1
    ) AS first_transfer ON true
    LEFT JOIN LATERAL (
      SELECT message.sender_id
      FROM public.messages AS message
      WHERE message.conversation_id = conversation.id
        AND message.sender_type = 'agent'
        AND message.sender_id IS NOT NULL
        AND message.status IN ('sent', 'delivered', 'read')
        AND (message.created_at, message.id) >
          (customer.customer_at, customer.message_id)
        AND (
          first_transfer.event_at IS NULL
          OR message.created_at < first_transfer.event_at
        )
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS first_response ON true
    WHERE conversation.account_id = v_account_id
      AND NOT EXISTS (
        SELECT 1
        FROM assignment_events AS event
      WHERE event.conversation_id = conversation.id
          AND event.to_agent_id IS NOT NULL
          AND event.from_agent_id IS NULL
      )
      AND COALESCE(
        first_response.sender_id,
        first_transfer.from_agent_id,
        conversation.initial_assigned_agent_id,
        conversation.assigned_agent_id
      ) IS NOT NULL
  ),
  cycles AS (
    SELECT * FROM event_cycles
    UNION ALL
    SELECT * FROM legacy_cycles
  ),
  cycle_responses AS (
    SELECT
      cycle.conversation_id,
      cycle.assigned_agent_id,
      cycle.event_at,
      cycle.cycle_started_at,
      cycle.next_event_at,
      cycle.is_transfer,
      response.sender_id AS responding_agent_id,
      response.created_at AS response_at,
      CASE WHEN response.created_at IS NULL THEN NULL::NUMERIC
        ELSE EXTRACT(EPOCH FROM (response.created_at - cycle.cycle_started_at)) / 60.0
      END AS response_minutes
    FROM cycles AS cycle
    LEFT JOIN LATERAL (
      SELECT message.sender_id, message.created_at
      FROM public.messages AS message
      WHERE message.conversation_id = cycle.conversation_id
        AND message.sender_type = 'agent'
        AND message.sender_id IS NOT NULL
        AND message.status IN ('sent', 'delivered', 'read')
        AND (
          message.created_at > cycle.cycle_started_at
          OR (
            message.created_at = cycle.cycle_started_at
            AND (
              cycle.start_message_id IS NULL
              OR message.id > cycle.start_message_id
            )
          )
        )
        AND (
          cycle.next_event_at IS NULL
          OR message.created_at < cycle.next_event_at
        )
        AND message.created_at < p_to
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS response ON true
  ),
  attributed_cycles AS (
    SELECT
      cycle.conversation_id,
      CASE
        WHEN cycle.is_transfer THEN cycle.assigned_agent_id
        ELSE COALESCE(cycle.responding_agent_id, cycle.assigned_agent_id)
      END AS agent_id,
      cycle.cycle_started_at,
      cycle.response_minutes
    FROM cycle_responses AS cycle
    WHERE cycle.cycle_started_at >= p_from
      AND cycle.cycle_started_at < p_to
  ),
  thresholds AS (
    SELECT
      COALESCE(settings.optimal_minutes, 1)::NUMERIC AS optimal_minutes,
      COALESCE(settings.low_minutes, 15)::NUMERIC AS low_minutes
    FROM (SELECT 1) AS singleton
    LEFT JOIN public.account_sla_settings AS settings
      ON settings.account_id = v_account_id
  )
  SELECT
    cycle.agent_id,
    COUNT(*)::BIGINT,
    AVG(cycle.response_minutes)::NUMERIC,
    COUNT(*) FILTER (
      WHERE cycle.response_minutes IS NOT NULL
        AND cycle.response_minutes <= thresholds.optimal_minutes
    )::BIGINT,
    COUNT(*) FILTER (
      WHERE cycle.response_minutes > thresholds.optimal_minutes
        AND cycle.response_minutes <= thresholds.low_minutes
    )::BIGINT,
    COUNT(*) FILTER (WHERE cycle.response_minutes > thresholds.low_minutes)::BIGINT,
    COUNT(*) FILTER (WHERE cycle.response_minutes IS NULL)::BIGINT,
    ARRAY_AGG(
      DISTINCT COALESCE(NULLIF(BTRIM(contact.name), ''), contact.phone)
      ORDER BY COALESCE(NULLIF(BTRIM(contact.name), ''), contact.phone)
    ) FILTER (WHERE contact.id IS NOT NULL)
  FROM attributed_cycles AS cycle
  JOIN public.conversations AS conversation
    ON conversation.id = cycle.conversation_id
   AND conversation.account_id = v_account_id
  JOIN public.contacts AS contact
    ON contact.id = conversation.contact_id
   AND contact.account_id = v_account_id
  JOIN public.profiles AS agent
    ON agent.user_id = cycle.agent_id
   AND agent.account_id = v_account_id
   AND agent.account_role IN ('owner', 'admin', 'agent')
  CROSS JOIN thresholds
  GROUP BY cycle.agent_id;
END;
$$;

ALTER FUNCTION public.get_agent_first_response_sla_report(TIMESTAMPTZ, TIMESTAMPTZ)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_agent_first_response_sla_report(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_first_response_sla_report(TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
