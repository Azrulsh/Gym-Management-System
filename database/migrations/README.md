Fresh installation or development reset:

1. Start Apache and MySQL in XAMPP. Open phpMyAdmin.
2. Create/select `gym`, matching `db_connect.php`.
3. Import `database/gym.sql`. It DROPS and recreates the nine application tables
   in the selected database, replacing their records with consistent demo data.
   Other databases and unrelated tables are not changed.
4. Log out of any existing browser session, then log in again:
   Admin: `admin` / `admin`; Staff: `staff` / `staff` (local development only).

`gym.sql` replaces the old `gym_db.sql` dump and integrates migrations 001 through 009.
No separate migration imports are needed after this reset. Passwords use Argon2id.
There are four profiles: Ali has an Active membership, Siti has an Expired
membership that can be renewed, Kumar has a Closed membership, and Mei has no
membership yet. Kumar and Mei appear in the Add Membership Validity dropdown.

Application time is set in `app_config.php`: PHP uses `Asia/Kuala_Lumpur`, and
each application database connection uses session timezone `+08:00`. The fresh
dump also sets its import session to `+08:00`. No server-wide PHP/MySQL setting or
timezone-table installation is needed. Existing DATE/DATETIME values are not
converted: their original timezone is not known, so review historical records
separately if necessary. Login throttle expiry continues to use Unix timestamps.
All membership/payment references exist. Dates are relative to import day.
Immediately after import, expect 1 Active Member, 4 profiles total and no
Needs attention warning on the dashboard.

Existing installations keeping their data: do NOT import the reset dump. Select
the application database in phpMyAdmin and import `001_login_throttle.sql` once.
It only adds the `login_throttle` table.

Also import `002_payment_amount_decimal.sql` to store payment amounts as
`DECIMAL(12,2)`. Existing integer values are preserved, including any historical
negative records; the new payment handler only permits positive amounts. The
updated full database dump includes the decimal column for fresh installations.

Import `003_user_auth_version.sql` on existing MariaDB installations before using
the updated login/session handlers. It adds `users.auth_version` (default 1) and
preserves accounts and hashes; re-importing is safe. Existing browser sessions
without a version must sign in again after deployment. Password resets through
Users invalidate all previous sessions for that account. Password changes through
Manage Account keep the current session with a rotated session ID, while other
sessions are rejected on their next request. Profile-only edits and automatic
MD5/Argon2id rehashes during login do not increment the version. Importing the full
`gym.sql` reset is not necessary for this upgrade.

Import `004_unique_usernames.sql` to enforce unique usernames in the database,
including concurrent Manage Account saves. Check first with:
`SELECT username, COUNT(*) FROM users GROUP BY username HAVING COUNT(*) > 1;`.
Comparisons use the existing username collation (including case/accent handling).
If duplicates exist, the migration fails without deleting or renaming accounts;
review those accounts before choosing new usernames. The migration is safe to
re-import once its index exists. The updated save handlers return a duplicate
username message when the database rejects a conflicting write.

Import `005_unique_member_numbers.sql` to enforce unique member-facing ID No.
values (`members.member_id`). Check first with:
`SELECT member_id, COUNT(*) FROM members GROUP BY member_id HAVING COUNT(*) > 1;`.
Existing duplicates must be reviewed; the migration never renumbers or deletes
profiles automatically. Re-importing is safe once the index exists. Internal
`members.id` values and membership/payment relationships remain unchanged.
Explicit ID conflicts return "ID No. already exists."; automatically generated
8-digit numbers retry up to ten candidates, including conflicts during INSERT.

Import `006_catalog_prices_decimal.sql` to convert Plan/Package amounts and
Trainer rates from FLOAT to DECIMAL(12,2). Audit all three columns before import:
values outside -9999999999.99 through 9999999999.99 must be reviewed first.
The migration enables strict mode for conversion so overflow is rejected rather
than clipped. DDL is not transactional; resolve preflight issues before import.
Re-importing is safe. Record IDs, historical negative values and relationships
are retained. Prices are rounded to two decimals from the values currently stored;
digits already lost by FLOAT cannot be recovered automatically. Review affected
test/legacy prices manually. New saves accept 0 through 9999999999.99 with up to
two decimal places; catalog amount/rate arrow buttons retain their increment of 1.

Import `007_membership_price_snapshots.sql` before using membership price snapshots.
New memberships capture current Plan, Package and Trainer fees within the creation
transaction. Renew closes the previous membership and captures current catalog
fees in the new row. Editing catalog prices never changes recorded fees or payments.
No trainer means a recorded trainer fee of 0.00.

Existing records receive an explicitly labelled `migration_baseline`: the prices
available at upgrade time, not a claim about their original signup prices. Missing
references retain NULL fees; original fees are never inferred from payment totals.
Incomplete fees require review before accepting new payments. Migration re-imports
never overwrite captured/baselined fees. Existing IDs, dates, statuses and payment
records are preserved. The fresh dump's demo records have known captured fees.

Import `008_payment_plan_allocation.sql` before using payment allocations.
Each new payment records `plan_amount`, the portion of its total amount applied
to the one-time Plan fee. The remainder is for Package/Trainer. Only recorded
Plan allocations reduce the Plan balance; the number of transactions never
marks a Plan paid. Amounts are calculated in integer cents and allocations cannot
exceed either the payment total or the remaining Plan fee. A membership row lock
serializes simultaneous payment submissions before checking the balance.

Existing payments (including demo payments) retain NULL allocations and are shown
as `Unallocated (legacy)`. Never infer their purpose or collect the displayed Plan
balance without checking original receipts. This migration preserves their totals,
dates and remarks. Re-importing does not change existing allocations. The monthly
Package/Trainer reference is not an arrears ledger or a record of paid months.

Import `009_payment_request_keys.sql` before using replay-safe payment forms.
Each newly opened payment form receives a random request key. Retrying the same
key and payment details returns success for the original record, without inserting
or allocating Plan fees again. A reused key with changed details returns 409.
The unique database index also protects concurrent requests; distinct keys permit
legitimate separate payments with identical amounts. Existing payments retain NULL
keys and all existing data. Re-importing the migration preserves recorded keys.
After a connection failure, retry the same form without changing its details.
Opening another form creates a new key, so check history before starting a new
payment when the previous result is uncertain. Existing duplicate records are not
automatically removed or guessed to be retries.

The login handler requires this table and returns a generic 503 if storage fails;
it never falls back to unlimited login attempts. No schema changes run during login.

Policy is defined in `login_throttle.php`: five failed attempts per account and
30 total admitted attempts per IP in a fixed 15-minute window. Successful login
resets the account counter, but keeps the IP counter. Blocked requests do not
extend the window. Correct passwords are also blocked until the window expires.
Account-wide limits can temporarily prevent the owner from logging in if someone
deliberately exhausts their attempts; blocks expire automatically.

The server uses `REMOTE_ADDR`, never client-supplied forwarded headers. A deployment
behind a reverse proxy must configure trusted client address handling at the server.
Counter keys are SHA-256 digests; passwords and raw usernames/IP addresses are not
stored in this table. Expired counters are removed in bounded batches during login.

Run `node --test tests/*.test.mjs` with local MariaDB available. The throttle tests
create randomly named `gym_throttle_test_*` databases, exercise real InnoDB locks,
and drop only those test databases afterwards. They do not use application accounts.
Test connection defaults to localhost/root with an empty password; override via
`GYM_TEST_DB_HOST`, `GYM_TEST_DB_USER`, and `GYM_TEST_DB_PASSWORD` if needed.
HTTP smoke checks against the application do consume its login attempt counters.
