-- MariaDB: keep username comparisons consistent with the existing column collation.
-- Check for duplicates before importing (case/accent variants may compare equal):
-- SELECT username, COUNT(*) FROM users GROUP BY username HAVING COUNT(*) > 1;
-- If duplicates exist this ALTER fails without deleting or renaming any accounts.
-- Re-importing is safe once the named unique index exists.
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS users_username_unique (username);
