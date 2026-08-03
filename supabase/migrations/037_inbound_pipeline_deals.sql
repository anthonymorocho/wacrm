-- Keep one automatically-created open deal per inbound conversation.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS auto_created_from_message BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE deals
SET last_activity_at = COALESCE(updated_at, created_at, NOW())
WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_activity
  ON deals (account_id, pipeline_id, last_activity_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_auto_conversation
  ON deals (conversation_id)
  WHERE auto_created_from_message = TRUE
    AND status = 'open'
    AND conversation_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'deals'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
END $$;
