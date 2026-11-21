-- Reject stale schedule forms without replacing newer edits.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
