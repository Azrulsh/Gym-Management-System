-- Reject stale profile forms without overwriting newer changes.
ALTER TABLE members ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
