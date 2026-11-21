Fresh installation or development reset:

1. Start Apache and MySQL in XAMPP. Open phpMyAdmin.
2. Create/select `gym`, matching `db_connect.php`.
3. Import `database/gym.sql`. It DROPS and recreates the nine application tables
   in the selected database, replacing their records with consistent demo data.
   Other databases and unrelated tables are not changed.
4. Log out of any existing browser session, then log in again:
   Admin: `admin` / `admin`; backup Admin: `admin2` / `admin2`;
   Staff: `staff` / `staff` (local development only).

`gym.sql` replaces the old `gym_db.sql` dump and integrates migrations 001 through 016.
No separate migration imports are needed after this reset. Passwords use Argon2id.
Current-password verification uses the `login_throttle` table included in `gym.sql`;
no additional SQL import is required. Manage Account, editing your own user and
self deletion share a limit of five failed verifications per account in a fixed
15-minute window. Successful verification resets the account failure count.
A separate IP bucket allows 30 admitted verifications per window, including
successful ones. These verification buckets are separate from normal login.
The consolidated dump includes these fictional demo records:

| Module | Records |
| --- | ---: |
| Users | 3 (2 Admins, 1 Staff) |
| Members | 15 |
| Plans / Packages / Trainers | 5 / 6 / 4 |
| Membership agreements | 13 |
| Payments | 15 |
| Recurring schedules | 7 |

Immediately after import, the dashboard shows **6 Active Members**, **15 profiles**
and **0 Needs attention**. Membership Validity shows 6 Active, 3 Expired,
1 Scheduled and 3 Closed agreements. Fatin has both Closed and Active history.
Kumar, Wei, Mei, Zara and Farah can be selected for a new membership; Siti,
Nur Aisyah and Priya have an open Expired agreement and can be renewed instead.
Jason starts next month. Dates stay relative to the Malaysian import day.

Payment scenarios include a fully paid Plan (Siti, Fatin, Daniel, Hakim), partial
Plan payments (Ali: RM169.50 remaining; Arun: RM150.75; Priya: RM60.00), no
payments yet, Package/Trainer-only payments, zero-fee Package/Trainer choices
and historical payments on Closed agreements. Every payment has an explicit
Plan allocation and request key. No fabricated legacy allocation is needed.
Fees/durations are captured on every agreement. Seven schedules fill the current
and next month without same-member overlaps. The 9-month Plan, Weekend Access
package and Izzat trainer are unused examples for testing deletion without
history; the used catalogs should be protected from deletion.
Login/current-password throttles start empty and versions start at 1.

Application time is set in `app_config.php`: PHP uses `Asia/Kuala_Lumpur`, and
each application database connection uses session timezone `+08:00`. The fresh
dump also sets its import session to `+08:00`. No server-wide PHP/MySQL setting or
timezone-table installation is needed. Existing DATE/DATETIME values are not
converted: their original timezone is not known, so review historical records
separately if necessary. Login throttle expiry continues to use Unix timestamps.
All membership/payment/schedule references exist. No existing application data
is changed merely by updating this file; replacing records happens only when
you explicitly import the development reset dump into the selected database.

`gym.sql` is the only application database installation/reset file. The old
application migration directory has been removed. Historical SQL is retained only
in `tests/fixtures/legacy-schema` for isolated regression fixtures; it is not an
installation or upgrade workflow. Existing installations that must keep their
records should not import this development reset dump.
