-- MariaDB: preserve unique member-facing ID numbers under concurrent saves.
-- Check first: SELECT member_id, COUNT(*) FROM members GROUP BY member_id HAVING COUNT(*) > 1;
-- Duplicate data makes this migration fail without changing member records.
ALTER TABLE members ADD UNIQUE INDEX IF NOT EXISTS members_number_unique (member_id);
