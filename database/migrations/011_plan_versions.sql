-- Compare this version on Edit to prevent stale forms overwriting newer changes.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
