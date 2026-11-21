Fresh installation or development reset:

1. Start Apache and MySQL in XAMPP. Open phpMyAdmin.
2. Create/select `gym`, matching `db_connect.php`.
3. Import `database/gym.sql`. It DROPS and recreates the fifteen application tables
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
| System Settings | 1 shared gym profile |
| Members | 15 |
| Plans / Packages / Trainers | 5 / 6 / 4 |
| Membership agreements | 13 |
| Payments | 15 |
| Recurring schedules | 7 |
| Events / participation records | 4 / 5 |
| Portal accounts / tokens / audit entries | 0 / 0 / 0 (activate by invitation) |

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

System Settings on an existing installation:

1. Import `database/add_system_settings.sql` once into the existing application
   database. It adds one table and a default record; re-importing preserves the
   saved Settings and all other application records. Fresh `gym.sql` already
   includes this table, so no additional import is needed after a reset.
2. Enable PHP GD and Fileinfo for the PHP installation used by Apache. On XAMPP,
   enable `extension=gd` in `php.ini` and restart Apache. Keep PHP's upload and
   POST limits above the application's 2 MB per-image / 5 MB request limits.
   Missing GD disables image selection while keeping text updates available.
3. Branding files use `C:\xampp\gym-storage\branding` on the standard Windows
   checkout, outside `htdocs`. Set the server environment variable
   `GYM_BRANDING_STORAGE` to an absolute directory outside the webroot when
   deploying elsewhere. Give only the application service account the required
   read/write access; include this directory alongside the database in backups.
4. Open **Settings** as Admin. Staff cannot read this page or save Settings.
   Public branding is shown on Login; changes reach existing sessions on their
   next page load. Uploaded images are served only through `branding_image.php`
   using the current logo/cover reference. Remove restores the bundled default.

Settings has one versioned record. Stale forms return 409 instead of overwriting
another Admin's change. Uploaded images are validated, resized and re-encoded;
filenames are generated by the application. Old images are removed after the
database commit; pre-commit failures remove newly created files. An uncertain
commit outcome can leave an unreferenced file for later maintenance, rather than
delete an image that may already be referenced. SQL errors and filesystem paths
are not returned to users. The old commented `save_settings()` in
`admin_class.php` remains reference code; the active endpoint uses the separate
Settings service and does not call that handler.

Events on an existing installation:

1. Import `database/add_events.sql` into the existing application database.
   It only adds the two Events tables; repeat imports preserve their records.
   Fresh `gym.sql` includes the schema and four fictional events already.
2. Open **Events** as Admin or Staff. Admins create/edit/cancel/complete events;
   both roles register members, cancel registrations and record attendance.
   A member must have an open membership covering the event start date when
   registering. A later membership change does not silently remove participation.
3. Drafts accept no registrations. Published events accept registrations before
   start/deadline and while capacity remains. Blank capacity means unlimited.
   Cancelled events preserve participant records and disallow further changes.
   Completion is available after the scheduled end. Attendance is allowed from
   start; no-show is allowed after end, including corrections on Completed events.
4. Only Drafts without participant history can be deleted. Member deletion is
   restricted by participant history, including cancelled registrations.

Times use Malaysia time. Events are independent of recurring Schedule, membership
fees and payments; creating or joining an event changes none of those records.
The page displays Upcoming/Ongoing/Ended from the current clock; these labels do
not require a scheduled job. An ended Published event still needs an Admin to
mark it Completed. Event details lock after start, cancellation or completion.
Time/location changes with participants require explicit confirmation; moving
the date also checks current participants' membership eligibility. Notifications
are manual: this version does not send email or WhatsApp messages.

Writes use transactions, actor revalidation and event/member locks. Every
participant change increments both participation and event versions; stale forms
return 409 and must be reviewed after reload. Event creation has a unique request
key so retrying the same successful form does not create a second event. The old
commented Events implementation remains in `events.php` for reference.

Optional posters, event fees, public registration and automated notifications
are outside the current Events scope. Back up both Events tables with the rest
of the application database.

Member Portal on an existing installation:

1. Import `database/add_member_portal.sql` once into the selected application
   database. Re-importing preserves existing accounts and data. Fresh `gym.sql`
   already contains these three tables; no reset is needed to add portal access.
2. Admin opens **Member Portal Accounts**, verifies the member's identity and
   chooses **Invite Member**. Deliver the private link securely to that member.
   Use an incognito window or log out before opening the link. Choose a username
   and a unique password; activation does not automatically sign the member in.
3. The same Login page accepts Admin, Staff and Member accounts. Admin/Staff reach
   the operations dashboard; Members reach `member_portal.php`. Expired/Closed
   membership does not disable portal login. Events still check eligibility on
   the event start date when accepting a registration.
4. Admin can disable/re-enable portal access or issue a recovery link after
   verifying identity. Access changes revoke old sessions and unused links.
   Password changes/recovery increment `auth_version`, invalidating all existing
   sessions; the member signs in again. There is no public email-only account
   claim or automatic email delivery in this version.

Roles and boundaries:

| Capability | Admin | Staff | Member |
| --- | --- | --- | --- |
| Existing operations pages/actions | Existing Admin rights | Existing Staff rights | Denied |
| Invite/recover/enable/disable portal access | Yes | No | No |
| Read member portal records | No portal impersonation | No portal impersonation | Own profile only |
| Update portal profile | Through Members operations | Through Members operations | Own contact/address/avatar |
| Read memberships/payments/schedules | Existing operations | Existing operations | Own records, read only |
| Events participation | Manage participants | Manage participants | Register/cancel self only |
| Attendance / event administration | Existing Events rights | Existing Events rights | Denied |

`users.type=3` requires an enabled row in `member_portal_accounts` linked to an
existing `members.id`. The unique profile/user relationship is never supplied
by a Member request. Admin/Staff Users forms cannot convert/delete portal users;
portal access is managed through its dedicated page. No duplicated alumni/profile
table or full-profile session cache remains. Old login/signup/account handlers,
AJAX routes and orphaned alumni Schedule controls have been removed.

Code map:

- `member_portal_auth.php`: fresh Member identity, role, status and auth-version checks.
- `member_portal_repository.php`: queries scoped by the verified profile ID.
- `member_portal_service.php`: invitation/recovery, profile and account security rules.
- `member_portal_action.php`: explicit action dispatch, POST/CSRF and safe JSON errors.
- `portal_accounts.php`: Admin account provisioning; `activate_member.php`: activation/recovery.
- `member_portal.php`: Member views; `member_avatar.php`: private owner-only avatar delivery.
- `database_queries.php`: shared prepared-query execution; repositories own their SQL.
- `events_service.php`: the same event business rules for operations and self-registration.

Tokens contain 256 random bits, expire after 24 hours, are single-use, and are stored
as hashes. Activation links carry tokens in URL fragments; the page moves the
token into the POST form and removes it from the address bar. Keep shared links
private. New links revoke previous unused links. Token submissions and current
password checks are throttled. Audit entries contain actor/member IDs and action
names; they contain no passwords or token values.

Member avatar files use `C:\xampp\gym-storage\avatars`, outside the webroot. For
other deployments configure `GYM_MEMBER_AVATAR_STORAGE` to a private absolute
directory writable by the application service account. Include it in backups.
Uploads use the shared GD JPEG/PNG validation, resizing and re-encoding pipeline
(2 MB, 4096 pixels per side, 8 megapixels). Avatars are never served by the public
branding endpoint. GD is required for uploads; profile text changes still work
without it. Names, member numbers and email corrections go through gym staff;
email/username changes, online payments and self-service renewals are not enabled.

Tests use disposable databases and profiles. Run `node --test tests/*.test.mjs`.
Optional Chromium smoke: set `GYM_PORTAL_BROWSER_AUDIT=1` and run
`node --test tests/member-portal-http.test.mjs`; `GYM_TEST_BROWSER` can specify
a Chromium executable. The browser uses its own temporary profile.
