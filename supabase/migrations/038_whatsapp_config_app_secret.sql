-- Store the Meta App Secret per WhatsApp configuration.
-- It is encrypted by the server before being written.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS app_secret TEXT;

