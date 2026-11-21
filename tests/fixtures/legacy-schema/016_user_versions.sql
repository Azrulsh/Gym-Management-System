-- Profile edit versions are separate from auth_version session invalidation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1;
