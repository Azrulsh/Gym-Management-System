-- Prevent stale catalog forms overwriting newer edits.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
