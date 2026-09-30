-- Record conversation lifecycle boundaries for accurate duration and close
-- reports. Existing closed conversations cannot be backfilled reliably;
-- active conversations receive a tracking start at migration time.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS conversation_report_tracking_started_at TIMESTAMPTZ
    NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.conversation_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_order BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'closed')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'bot', 'system')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_lifecycle_account_time_idx
  ON public.conversation_lifecycle_events(account_id, occurred_at);
CREATE INDEX IF NOT EXISTS conversation_lifecycle_cycle_idx
  ON public.conversation_lifecycle_events(conversation_id, event_order);

ALTER TABLE public.conversation_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_lifecycle_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_lifecycle_events
  TO service_role;

-- Start an observation window for existing conversations that are active at
-- rollout. Their earlier start and prior closure dates are not reconstructable.
INSERT INTO public.conversation_lifecycle_events (
  account_id, conversation_id, event_type, actor_type, occurred_at
)
SELECT
  conversation.account_id,
  conversation.id,
  'started',
  'system',
  now()
FROM public.conversations AS conversation
WHERE conversation.status IN ('open', 'pending')
;

CREATE OR REPLACE FUNCTION public.log_conversation_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('open', 'pending') THEN
      INSERT INTO public.conversation_lifecycle_events (
        account_id, conversation_id, event_type, actor_type, occurred_at
      ) VALUES (
        NEW.account_id, NEW.id, 'started', 'system', COALESCE(NEW.created_at, now())
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'closed' THEN
    v_actor_type := NULLIF(
      current_setting('app.conversation_lifecycle_actor_type', true), ''
    );
    IF v_actor_type IS NULL OR v_actor_type NOT IN ('agent', 'bot', 'system') THEN
      v_actor_type := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'agent' END;
    END IF;

    INSERT INTO public.conversation_lifecycle_events (
      account_id, conversation_id, event_type, actor_type, actor_user_id,
      occurred_at
    ) VALUES (
      NEW.account_id,
      NEW.id,
      'closed',
      v_actor_type,
      CASE WHEN v_actor_type = 'agent' THEN auth.uid() ELSE NULL END,
      clock_timestamp()
    );
  ELSIF OLD.status = 'closed' AND NEW.status IN ('open', 'pending') THEN
    INSERT INTO public.conversation_lifecycle_events (
      account_id, conversation_id, event_type, actor_type, occurred_at
    ) VALUES (
      NEW.account_id,
      NEW.id,
      'started',
      'system',
      CASE
        WHEN NEW.last_message_at IS DISTINCT FROM OLD.last_message_at
          AND NEW.last_message_at > OLD.updated_at
          THEN NEW.last_message_at
        ELSE clock_timestamp()
      END
    );
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_conversation_lifecycle_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_conversation_lifecycle_event()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS log_conversation_lifecycle_event ON public.conversations;
CREATE TRIGGER log_conversation_lifecycle_event
  AFTER INSERT OR UPDATE OF status ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_conversation_lifecycle_event();

-- Automation closes use the service-role client, so set an explicit actor
-- within the same transaction before the lifecycle trigger records the event.
CREATE OR REPLACE FUNCTION public.close_conversations_from_automation(
  p_account_id UUID,
  p_contact_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'Account and contact are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.conversation_lifecycle_actor_type', 'bot', true);

  UPDATE public.conversations
  SET status = 'closed', updated_at = now()
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND status IN ('open', 'pending');
END;
$$;

ALTER FUNCTION public.close_conversations_from_automation(UUID, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_conversations_from_automation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_conversations_from_automation(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_conversation_report(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT profile.account_id, profile.account_role::TEXT
  INTO v_account_id, v_role
  FROM public.profiles AS profile
  WHERE profile.user_id = v_user_id;

  IF v_account_id IS NULL OR v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'Report access required' USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'A valid report period is required' USING ERRCODE = '22023';
  END IF;

  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_timezone
  ) THEN
    RAISE EXCEPTION 'A valid timezone is required' USING ERRCODE = '22023';
  END IF;

  WITH scoped_conversations AS (
    SELECT conversation.*
    FROM public.conversations AS conversation
    WHERE conversation.account_id = v_account_id
      AND (
        v_role IN ('owner', 'admin')
        OR conversation.initial_assigned_agent_id = v_user_id
        OR conversation.assigned_agent_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.conversation_assignment_events AS assignment_event
          WHERE assignment_event.account_id = v_account_id
            AND assignment_event.conversation_id = conversation.id
            AND (
              assignment_event.from_agent_id = v_user_id
              OR assignment_event.to_agent_id = v_user_id
            )
        )
      )
  ),
  scoped_assignments AS (
    SELECT event.*
    FROM public.conversation_assignment_events AS event
    JOIN scoped_conversations AS conversation
      ON conversation.id = event.conversation_id
     AND conversation.account_id = event.account_id
    WHERE event.account_id = v_account_id
      AND (
        v_role IN ('owner', 'admin')
        OR event.to_agent_id = v_user_id
        OR event.from_agent_id = v_user_id
      )
  ),
  scoped_lifecycle AS (
    SELECT event.*
    FROM public.conversation_lifecycle_events AS event
    JOIN scoped_conversations AS conversation
      ON conversation.id = event.conversation_id
     AND conversation.account_id = event.account_id
    WHERE event.account_id = v_account_id
      AND (
        v_role IN ('owner', 'admin')
        OR conversation.initial_assigned_agent_id = v_user_id
        OR conversation.assigned_agent_id = v_user_id
        OR event.actor_user_id = v_user_id
        OR EXISTS (
          SELECT 1 FROM scoped_assignments AS assignment_event
          WHERE assignment_event.conversation_id = event.conversation_id
            AND (
              assignment_event.from_agent_id = v_user_id
              OR assignment_event.to_agent_id = v_user_id
            )
            AND assignment_event.created_at <= event.occurred_at
            AND assignment_event.created_at >= COALESCE((
              SELECT max(start_event.occurred_at)
              FROM public.conversation_lifecycle_events AS start_event
              WHERE start_event.account_id = v_account_id
                AND start_event.conversation_id = event.conversation_id
                AND start_event.event_type = 'started'
                AND start_event.occurred_at <= event.occurred_at
            ), '-infinity'::TIMESTAMPTZ)
        )
        OR (
          event.event_type = 'started'
          AND EXISTS (
            SELECT 1 FROM scoped_assignments AS assignment_event
            WHERE assignment_event.conversation_id = event.conversation_id
              AND (
                assignment_event.from_agent_id = v_user_id
                OR assignment_event.to_agent_id = v_user_id
              )
              AND assignment_event.created_at >= event.occurred_at
              AND assignment_event.created_at < COALESCE((
                SELECT min(close_event.occurred_at)
                FROM public.conversation_lifecycle_events AS close_event
                WHERE close_event.account_id = v_account_id
                  AND close_event.conversation_id = event.conversation_id
                  AND close_event.event_type = 'closed'
                  AND close_event.occurred_at > event.occurred_at
              ), 'infinity'::TIMESTAMPTZ)
          )
        )
      )
  ),
  first_inbound AS (
    SELECT DISTINCT ON (message.conversation_id)
      message.conversation_id,
      message.id AS message_id,
      message.created_at AS customer_at
    FROM public.messages AS message
    JOIN scoped_conversations AS conversation
      ON conversation.id = message.conversation_id
    WHERE message.sender_type = 'customer'
      AND message.status <> 'failed'
    ORDER BY message.conversation_id, message.created_at, message.id
  ),
  first_responses AS (
    SELECT
      inbound.conversation_id,
      inbound.message_id,
      inbound.customer_at,
      response.created_at AS response_at,
      response.sender_id AS responding_agent_id,
      EXTRACT(EPOCH FROM (response.created_at - inbound.customer_at)) / 60.0
        AS response_minutes
    FROM first_inbound AS inbound
    LEFT JOIN LATERAL (
      SELECT message.created_at, message.sender_id
      FROM public.messages AS message
      WHERE message.conversation_id = inbound.conversation_id
        AND message.sender_type = 'agent'
        AND message.sender_id IS NOT NULL
        AND message.status IN ('sent', 'delivered', 'read')
        AND (message.created_at, message.id) >
          (inbound.customer_at, inbound.message_id)
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS response ON true
  ),
  response_samples AS (
    SELECT *
    FROM first_responses
    WHERE customer_at >= p_from
      AND customer_at < p_to
      AND response_at IS NOT NULL
      AND response_minutes >= 0
      AND response_at < p_to
      AND (v_role IN ('owner', 'admin') OR responding_agent_id = v_user_id)
  ),
  cycle_starts AS (
    SELECT
      event.conversation_id,
      event.event_order AS start_event_order,
      event.occurred_at AS started_at
    FROM scoped_lifecycle AS event
    WHERE event.event_type = 'started'
      AND event.occurred_at < p_to
  ),
  cycle_closures AS (
    SELECT
      start.conversation_id,
      start.start_event_order,
      start.started_at,
      closing.occurred_at AS closed_at,
      closing.actor_type,
      closing.actor_user_id
    FROM cycle_starts AS start
    JOIN LATERAL (
      SELECT event.occurred_at, event.actor_type, event.actor_user_id
      FROM scoped_lifecycle AS event
      WHERE event.conversation_id = start.conversation_id
        AND event.event_type = 'closed'
        AND event.event_order > start.start_event_order
      ORDER BY event.event_order
      LIMIT 1
    ) AS closing ON true
  ),
  closing_responses AS (
    SELECT
      cycle.*,
      inbound.customer_at,
      response.response_at,
      response.sender_id AS responding_agent_id,
      CASE WHEN response.response_at IS NULL THEN NULL::NUMERIC
        ELSE EXTRACT(EPOCH FROM (response.response_at - inbound.customer_at)) / 60.0
      END AS response_minutes,
      assignment.assigned_at,
      assignment.agent_id
    FROM cycle_closures AS cycle
    LEFT JOIN LATERAL (
      SELECT message.created_at AS customer_at, message.id AS message_id
      FROM public.messages AS message
      WHERE message.conversation_id = cycle.conversation_id
        AND message.sender_type = 'customer'
        AND message.status <> 'failed'
        AND message.created_at >= cycle.started_at
        AND message.created_at < cycle.closed_at
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS inbound ON true
    LEFT JOIN LATERAL (
      SELECT message.created_at AS response_at, message.sender_id
      FROM public.messages AS message
      WHERE inbound.customer_at IS NOT NULL
        AND message.conversation_id = cycle.conversation_id
        AND message.sender_type = 'agent'
        AND message.sender_id IS NOT NULL
        AND message.status IN ('sent', 'delivered', 'read')
        AND (message.created_at, message.id) >
          (inbound.customer_at, inbound.message_id)
        AND message.created_at < cycle.closed_at
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS response ON true
    LEFT JOIN LATERAL (
      SELECT event.created_at AS assigned_at, event.to_agent_id AS agent_id
      FROM scoped_assignments AS event
      WHERE event.conversation_id = cycle.conversation_id
        AND event.to_agent_id IS NOT NULL
        AND event.created_at >= cycle.started_at
        AND event.created_at < cycle.closed_at
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
    ) AS assignment ON true
  ),
  close_samples AS (
    SELECT sample.*
    FROM closing_responses AS sample
    WHERE sample.closed_at >= p_from AND sample.closed_at < p_to
      AND (
        v_role IN ('owner', 'admin')
        OR sample.actor_user_id = v_user_id
        OR sample.agent_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM scoped_conversations AS conversation
          WHERE conversation.id = sample.conversation_id
            AND (
              conversation.initial_assigned_agent_id = v_user_id
              OR conversation.assigned_agent_id = v_user_id
            )
        )
      )
  ),
  created_daily AS (
    SELECT (conversation.created_at AT TIME ZONE p_timezone)::DATE AS day,
      COUNT(*)::BIGINT AS count
    FROM scoped_conversations AS conversation
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY 1
  ),
  assigned_daily AS (
    SELECT (event.created_at AT TIME ZONE p_timezone)::DATE AS day,
      COUNT(DISTINCT event.conversation_id)::BIGINT AS count
    FROM scoped_assignments AS event
    WHERE event.to_agent_id IS NOT NULL
      AND (v_role IN ('owner', 'admin') OR event.to_agent_id = v_user_id)
      AND event.created_at >= p_from AND event.created_at < p_to
    GROUP BY 1
  ),
  closure_daily AS (
    SELECT (sample.closed_at AT TIME ZONE p_timezone)::DATE AS day,
      COUNT(*)::BIGINT AS count
    FROM close_samples AS sample
    GROUP BY 1
  ),
  transfer_daily AS (
    SELECT (event.created_at AT TIME ZONE p_timezone)::DATE AS day,
      COUNT(DISTINCT event.conversation_id)::BIGINT AS count
    FROM scoped_assignments AS event
    WHERE event.from_agent_id IS NOT NULL
      AND event.from_agent_id IS DISTINCT FROM event.to_agent_id
      AND event.to_agent_id IS NOT NULL
      AND event.created_at >= p_from AND event.created_at < p_to
    GROUP BY 1
  ),
  sla_daily AS (
    SELECT (sample.response_at AT TIME ZONE p_timezone)::DATE AS day,
      COUNT(*) FILTER (WHERE sample.response_minutes <= COALESCE(settings.low_minutes, 15))::BIGINT AS within_sla,
      COUNT(*) FILTER (WHERE sample.response_minutes > COALESCE(settings.low_minutes, 15))::BIGINT AS outside_sla
    FROM response_samples AS sample
    LEFT JOIN public.account_sla_settings AS settings
      ON settings.account_id = v_account_id
    GROUP BY 1
  ),
  channel_daily AS (
    SELECT (conversation.created_at AT TIME ZONE p_timezone)::DATE AS day,
      conversation.channel,
      COUNT(*)::BIGINT AS count
    FROM scoped_conversations AS conversation
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY 1, 2
  ),
  channel_totals AS (
    SELECT conversation.channel, COUNT(*)::BIGINT AS count
    FROM scoped_conversations AS conversation
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY conversation.channel
  ),
  outcomes AS (
    SELECT
      CASE
        WHEN conversation.status = 'closed' THEN 'closed'
        WHEN COALESCE(conversation.was_transferred, false) THEN 'transferred'
        ELSE 'active'
      END AS outcome,
      COUNT(*)::BIGINT AS count
    FROM scoped_conversations AS conversation
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY 1
  ),
  status_totals AS (
    SELECT conversation.status, COUNT(*)::BIGINT AS count
    FROM scoped_conversations AS conversation
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY conversation.status
  ),
  closure_actors AS (
    SELECT sample.actor_type, COUNT(*)::BIGINT AS count
    FROM close_samples AS sample
    GROUP BY sample.actor_type
  ),
  agent_totals AS (
    SELECT
      agent.user_id AS agent_id,
      COALESCE(NULLIF(BTRIM(agent.full_name), ''), 'Unnamed agent') AS name,
      COUNT(DISTINCT conversation.id)::BIGINT AS count
    FROM scoped_conversations AS conversation
    JOIN public.profiles AS agent
      ON v_role IN ('owner', 'admin')
     AND agent.user_id = COALESCE(
        conversation.initial_assigned_agent_id,
        conversation.assigned_agent_id
      )
     AND agent.account_id = v_account_id
     AND agent.account_role IN ('owner', 'admin', 'agent')
    WHERE conversation.created_at >= p_from AND conversation.created_at < p_to
    GROUP BY agent.user_id, agent.full_name
    UNION ALL
    SELECT
      agent.user_id AS agent_id,
      COALESCE(NULLIF(BTRIM(agent.full_name), ''), 'Unnamed agent') AS name,
      COUNT(DISTINCT event.conversation_id)::BIGINT AS count
    FROM scoped_assignments AS event
    JOIN public.profiles AS agent
      ON agent.user_id = v_user_id
     AND agent.account_id = v_account_id
     AND agent.account_role = 'agent'
    WHERE v_role = 'agent'
      AND event.to_agent_id = v_user_id
      AND event.created_at >= p_from AND event.created_at < p_to
    GROUP BY agent.user_id, agent.full_name
  ),
  comment_total AS (
    SELECT COUNT(*)::BIGINT AS count
    FROM public.social_comments AS comment
    WHERE v_role IN ('owner', 'admin')
      AND comment.account_id = v_account_id
      AND comment.is_hidden = false
      AND comment.created_time >= p_from AND comment.created_time < p_to
  ),
  thresholds AS (
    SELECT
      COALESCE(settings.optimal_minutes, 1)::NUMERIC AS optimal_minutes,
      COALESCE(settings.low_minutes, 15)::NUMERIC AS low_minutes
    FROM (SELECT 1) AS singleton
    LEFT JOIN public.account_sla_settings AS settings
      ON settings.account_id = v_account_id
  ),
  closure_summary AS (
    SELECT
      COUNT(*)::BIGINT AS closed_count,
      AVG(EXTRACT(EPOCH FROM (sample.closed_at - sample.started_at)) / 60.0)
        AS average_life_minutes,
      AVG(EXTRACT(EPOCH FROM (sample.closed_at - sample.assigned_at)) / 60.0)
        FILTER (WHERE sample.actor_type = 'agent' AND sample.assigned_at IS NOT NULL)
        AS average_agent_close_minutes,
      COUNT(*) FILTER (
        WHERE sample.response_minutes > thresholds.optimal_minutes
          AND sample.response_minutes <= thresholds.low_minutes
      )::BIGINT AS ideal_count,
      COUNT(*) FILTER (
        WHERE sample.actor_type = 'bot'
      )::BIGINT AS bot_closed_count
    FROM close_samples AS sample
    CROSS JOIN thresholds
  ),
  waits AS (
    SELECT
      AVG(sample.response_minutes) AS average_minutes,
      COUNT(*)::BIGINT AS response_count
    FROM response_samples AS sample
  ),
  summary AS (
    SELECT
      (SELECT COUNT(*)::BIGINT FROM scoped_conversations AS conversation
       WHERE conversation.created_at >= p_from AND conversation.created_at < p_to)
        AS created_count,
      closure.closed_count,
      closure.average_life_minutes,
      closure.average_agent_close_minutes,
      waits.average_minutes AS average_customer_wait_minutes,
      CASE WHEN closure.closed_count = 0 THEN NULL
        ELSE (closure.ideal_count::NUMERIC / closure.closed_count) * 100
      END AS ideal_sla_percentage,
      closure.bot_closed_count,
      (SELECT COUNT(DISTINCT event.conversation_id)::BIGINT
       FROM scoped_assignments AS event
       WHERE event.to_agent_id IS NOT NULL
         AND (v_role IN ('owner', 'admin') OR event.to_agent_id = v_user_id)
         AND event.created_at >= p_from AND event.created_at < p_to)
        AS assigned_count
    FROM closure_summary AS closure
    CROSS JOIN waits
  ),
  minute_buckets AS (
    SELECT bucket.order_key, bucket.label, bucket.min_minutes, bucket.max_minutes
    FROM (VALUES
      (0, '0', 0::NUMERIC, 1::NUMERIC),
      (1, '1', 1::NUMERIC, 2::NUMERIC),
      (2, '2', 2::NUMERIC, 3::NUMERIC),
      (3, '3', 3::NUMERIC, 4::NUMERIC),
      (4, '4', 4::NUMERIC, 5::NUMERIC),
      (5, '5', 5::NUMERIC, 6::NUMERIC),
      (6, '6', 6::NUMERIC, 7::NUMERIC),
      (7, '7', 7::NUMERIC, 8::NUMERIC),
      (8, '8', 8::NUMERIC, 9::NUMERIC),
      (9, '9', 9::NUMERIC, 10::NUMERIC),
      (10, '10–15', 10::NUMERIC, 15::NUMERIC),
      (11, '15–20', 15::NUMERIC, 20::NUMERIC),
      (12, '20–25', 20::NUMERIC, 25::NUMERIC),
      (13, '25–30', 25::NUMERIC, 30::NUMERIC),
      (14, '30–45', 30::NUMERIC, 45::NUMERIC),
      (15, '45–60', 45::NUMERIC, 60::NUMERIC),
      (16, '60–75', 60::NUMERIC, 75::NUMERIC),
      (17, '75–90', 75::NUMERIC, 90::NUMERIC),
      (18, '90–105', 90::NUMERIC, 105::NUMERIC),
      (19, '105–120', 105::NUMERIC, 120::NUMERIC),
      (20, '120–135', 120::NUMERIC, 135::NUMERIC),
      (21, '135–150', 135::NUMERIC, 150::NUMERIC),
      (22, '150–180', 150::NUMERIC, 180::NUMERIC),
      (23, '180+', 180::NUMERIC, NULL::NUMERIC)
    ) AS bucket(order_key, label, min_minutes, max_minutes)
  ),
  wait_distribution AS (
    SELECT bucket.order_key, bucket.label,
      COUNT(sample.response_minutes)::BIGINT AS count
    FROM minute_buckets AS bucket
    LEFT JOIN response_samples AS sample
      ON sample.response_minutes >= bucket.min_minutes
     AND (bucket.max_minutes IS NULL OR sample.response_minutes < bucket.max_minutes)
    GROUP BY bucket.order_key, bucket.label
  ),
  agent_duration_distribution AS (
    SELECT bucket.order_key, bucket.label,
      COUNT(sample.assigned_at)::BIGINT AS count
    FROM minute_buckets AS bucket
    LEFT JOIN close_samples AS sample
      ON sample.actor_type = 'agent'
     AND sample.assigned_at IS NOT NULL
     AND sample.closed_at >= sample.assigned_at
     AND (EXTRACT(EPOCH FROM (sample.closed_at - sample.assigned_at)) / 60.0) >= bucket.min_minutes
     AND (bucket.max_minutes IS NULL OR
       (EXTRACT(EPOCH FROM (sample.closed_at - sample.assigned_at)) / 60.0) < bucket.max_minutes)
    GROUP BY bucket.order_key, bucket.label
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'totalConversations', summary.created_count,
      'averageLifeMinutes', summary.average_life_minutes,
      'averageCustomerWaitMinutes', summary.average_customer_wait_minutes,
      'averageAgentCloseMinutes', summary.average_agent_close_minutes,
      'idealSlaPercentage', summary.ideal_sla_percentage,
      'closedConversations', summary.closed_count,
      'idealClosedConversations', closure.ideal_count,
      'assignedConversations', summary.assigned_count,
      'botClosedConversations', summary.bot_closed_count
    ),
    'waitDistribution', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'label', bucket.label,
        'count', bucket.count,
        'percentage', CASE WHEN waits.response_count = 0 THEN 0
          ELSE (bucket.count::NUMERIC / waits.response_count) * 100 END
      ) ORDER BY bucket.order_key), '[]'::JSONB)
      FROM wait_distribution AS bucket CROSS JOIN waits
    ),
    'agentCloseDistribution', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'label', bucket.label,
        'count', bucket.count,
        'percentage', CASE WHEN closure.agent_close_count = 0 THEN 0
          ELSE (bucket.count::NUMERIC / closure.agent_close_count) * 100 END
      ) ORDER BY bucket.order_key), '[]'::JSONB)
      FROM agent_duration_distribution AS bucket
      CROSS JOIN (
        SELECT COUNT(*)::BIGINT AS agent_close_count FROM close_samples
        WHERE actor_type = 'agent' AND assigned_at IS NOT NULL
          AND closed_at >= assigned_at
      ) AS closure
    ),
    'createdAssignedBotTotals', jsonb_build_array(
      jsonb_build_object('label', 'created', 'count', summary.created_count),
      jsonb_build_object('label', 'assigned', 'count', summary.assigned_count),
      jsonb_build_object('label', 'botClosed', 'count', summary.bot_closed_count)
    ),
    'assignedByDay', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day::TEXT, 'count', count)
        ORDER BY day), '[]'::JSONB) FROM assigned_daily
    ),
    'outcomeTotals', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('outcome', outcome, 'count', count)
        ORDER BY outcome), '[]'::JSONB) FROM outcomes
    ),
    'statusTotals', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', count)
        ORDER BY status), '[]'::JSONB) FROM status_totals
    ),
    'closureActors', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('actor', actor_type, 'count', count)
        ORDER BY actor_type), '[]'::JSONB) FROM closure_actors
    ),
    'closedAndTransferredByDay', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', dates.day::TEXT,
        'closed', COALESCE(closed.count, 0),
        'transferred', COALESCE(transferred.count, 0)
      ) ORDER BY dates.day), '[]'::JSONB)
      FROM (
        SELECT day FROM created_daily UNION
        SELECT day FROM closure_daily UNION
        SELECT day FROM transfer_daily
      ) AS dates
      LEFT JOIN closure_daily AS closed USING (day)
      LEFT JOIN transfer_daily AS transferred USING (day)
    ),
    'slaByDay', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day::TEXT, 'within', within_sla, 'outside', outside_sla
      ) ORDER BY day), '[]'::JSONB) FROM sla_daily
    ),
    'byChannel', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('channel', channel, 'count', count)
        ORDER BY channel), '[]'::JSONB) FROM channel_totals
    ),
    'directVsComments', jsonb_build_array(
      jsonb_build_object('label', 'direct', 'count', summary.created_count),
      jsonb_build_object('label', 'comments', 'count', (SELECT count FROM comment_total))
    ),
    'channelByDay', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day::TEXT, 'channel', channel, 'count', count
      ) ORDER BY day, channel), '[]'::JSONB) FROM channel_daily
    ),
    'byAgent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'agentId', agent_id, 'name', name, 'count', count
      ) ORDER BY count DESC, name), '[]'::JSONB) FROM agent_totals
    ),
    'trackingStartedAt', (
      SELECT account.conversation_report_tracking_started_at
      FROM public.accounts AS account WHERE account.id = v_account_id
    ),
    'slaThresholds', jsonb_build_object(
      'optimalMinutes', thresholds.optimal_minutes,
      'lowMinutes', thresholds.low_minutes
    )
  ) INTO v_result
  FROM summary
  CROSS JOIN closure_summary AS closure
  CROSS JOIN thresholds;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_conversation_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_conversation_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
