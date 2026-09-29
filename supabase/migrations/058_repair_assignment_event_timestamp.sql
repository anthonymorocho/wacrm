-- Repair databases where conversation_assignment_events predated migration 056.
-- Keep existing rows undated; their transfer time cannot be recovered safely.
ALTER TABLE public.conversation_assignment_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

ALTER TABLE public.conversation_assignment_events
  ALTER COLUMN created_at SET DEFAULT now();

NOTIFY pgrst, 'reload schema';
