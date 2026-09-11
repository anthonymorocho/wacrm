-- Optional image attachments for text quick replies.
-- The URL is public so Meta can fetch it; the account-scoped path lets the
-- client clean up an image when a quick reply is replaced or deleted.

ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT;
