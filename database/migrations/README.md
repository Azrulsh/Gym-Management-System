Fresh installation or development reset:

1. Start Apache and MySQL in XAMPP. Open phpMyAdmin.
2. Create/select `gym`, matching `db_connect.php`.
3. Import `database/gym.sql`. It DROPS and recreates the nine application tables
   in the selected database, replacing their records with consistent demo data.
   Other databases and unrelated tables are not changed.
4. Log out of any existing browser session, then log in again:
   Admin: `admin` / `admin`; Staff: `staff` / `staff` (local development only).

`gym.sql` replaces the old `gym_db.sql` dump and integrates migrations 001, 002 and 003.
No separate migration imports are needed after this reset. Passwords use Argon2id.
There are four profiles: Ali has an Active membership, Siti has an Expired
membership that can be renewed, Kumar has a Closed membership, and Mei has no
membership yet. Kumar and Mei appear in the Add Membership Validity dropdown.
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
