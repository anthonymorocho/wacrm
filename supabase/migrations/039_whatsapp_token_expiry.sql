-- Embedded Signup returns a finite token lifetime. Manual configurations
-- remain valid with NULL because their token expiry is not known here.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_token_expires_at
  ON whatsapp_config (token_expires_at)
  WHERE token_expires_at IS NOT NULL;
