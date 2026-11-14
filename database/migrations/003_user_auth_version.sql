-- MariaDB: invalidate old sessions when a password is changed.
-- Safe to re-import; preserves accounts and password hashes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INT UNSIGNED NOT NULL DEFAULT 1;
