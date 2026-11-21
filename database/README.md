Single-file installation or development reset:

`database/gym.sql` includes core tables, System Settings, Events, Member Portal
and Attendance with their constraints and complete demo records. Import only this
file. Historical `add_*.sql` files are retained under `tests/fixtures/legacy-schema`
solely for automated regression tests; they are not installation steps.

1. Start Apache and MySQL in XAMPP. Open phpMyAdmin.
2. Create/select `gym`, matching `db_connect.php`.
3. Import `database/gym.sql`. It DROPS and recreates the seventeen application tables
   in the selected database, replacing their records with consistent demo data.
   Other databases and unrelated tables are not changed.
4. Log out of any existing browser session, then log in again:
   Admin: `admin` / `admin`; backup Admin: `admin2` / `admin2`;
   Staff: `staff` / `staff`; Member: `member` / `member` (Arun, member 100007).
   `member_disabled` / `member_disabled` deliberately cannot log in until Admin
   enables portal access (Wei, member 100011). All are local development accounts.

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
| Users | 5 (2 Admins, 1 Staff, 2 Members) |
| System Settings | 1 shared gym profile |
| Members | 15 |
| Plans / Packages / Trainers | 5 / 6 / 4 |
| Membership agreements | 13 |
| Payments | 15 |
| Recurring schedules | 9 (past, current and future) |
| Events / participation records | 9 / 10 |
| Portal accounts / tokens / audit entries | 2 / 0 / 2 (enabled and disabled accounts) |
| Gym visits / attendance audit entries | 5 / 10 (one inside, three valid checked out, one voided) |

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
Fees/durations are captured on every agreement. Nine schedules cover past, current
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

System Settings (included in gym.sql):

1. Import `database/gym.sql` as described above; Settings needs no extra SQL.
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

Events (included in gym.sql):

1. Import `database/gym.sql` as described above; the nine demo events are included.
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

Member Portal (included in gym.sql):

1. Import `database/gym.sql` as described above. `member/member` is ready to log in.
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

Gym Attendance (included in gym.sql):

Both Attendance tables and their demo records are included in the single reset.
No separate SQL import is required.

Admin and Staff use Dashboard or Attendance to search an exact member number,
verify identity and check in. The server requires an Active membership and permits
one open visit per member, including overnight visits. Check-out is allowed after
membership expiry or closure. Attendance is independent of Schedule and Events.
Lookup returns minimal identity information; avatars remain protected by login.

Only Admin can correct times or void a visit, with a mandatory reason. Versions
reject stale edits; transactions save the visit and its audit together. Voiding
retains history, and there is no attendance-delete action. An existing visit keeps
its original membership reference. Used members and agreements remain protected
by foreign keys. Members see only their own latest 200 visits in My Attendance;
they cannot check themselves in or out or read the staff audit.

Attendance history is limited to 200 records per query and a maximum 366-day date
range. The Inside filter includes all open visits regardless of date. There is no
automatic overnight checkout: staff must confirm departures or Admin must record
a correction. Do not automatically purge attendance/audit records; agree a data
retention policy before adding a scheduled cleanup.

`home.php` retains the legacy tracking form concept and its control IDs, now
implemented in `attendance_form.php` and `assets/js/attendance.js`. Queries live in
`attendance_repository.php`; admission, checkout and correction rules live in
`attendance_service.php`. The obsolete person-tracking AJAX route is removed.

Fresh demo verification guide (after importing gym.sql):

| Module | Scenario / where to verify |
| --- | --- |
| Login and RBAC | admin/admin manages everything; staff/staff handles operations; member/member sees only Arun's own portal records. admin2/admin2 permits testing the last-Admin protection. |
| Member profiles | Ali 100001 is Active; Siti 100002 is Expired; Kumar 100003 has Closed history; Mei 100004 has no agreement; Jason 100006 starts next month. Inactive is a business description, not an extra membership status column. |
| Membership Validity | 6 Active, 3 Expired, 1 Scheduled, 3 Closed; Fatin has previous Closed and current Active history. Expired open agreements can be renewed; profiles without an open agreement can receive a new one. |
| Catalogs | Positive/decimal fees, zero Package/Trainer fees, no-Trainer agreements; unused Plan 5, Package 6 and Trainer 4 allow deletion tests. Used resources retain history. |
| Payments | Ali partial Plan payment; Arun multiple instalments; Aina no payments; Daniel Plan paid then Package/Trainer-only payments; Hakim zero Package and no Trainer. Every amount has explicit Plan allocation. |
| Schedule | Current recurring sessions, Siti's historical sessions and Jason's future sessions. No overlapping sessions for the same member. |
| Events | Community Fitness Morning is open/upcoming; Nutrition Workshop is Draft; Past Fitness Challenge is Completed; Outdoor Bootcamp is Cancelled; other events demonstrate a passed deadline, full capacity, Ongoing, Ended and unlimited capacity. |
| Event participants | Registered, Cancelled, Attended and No-show examples. Arun can register for open events or cancel Open Community Session; Fully Booked Coaching cannot accept another member. |
| Gym Attendance | Daniel 100009 is currently inside; Siti has a historical visit from when her agreement was valid; Arun has a checked-out visit; one incorrect Daniel visit is voided with a reason and audit. |
| Member Portal | member/member is enabled; member_disabled/member_disabled is disabled; other profiles are available for invitation. Membership expiry and portal access are independent. No fake activation/recovery tokens are seeded. |
| System Settings / media | Complete gym profile and portable bundled default images. Admin can upload logo/cover; Member can upload an avatar. No seed refers to missing private files. |

All five passwords are Argon2id hashes. All agreements have captured prices and
recorded durations, and every payment has a known allocation and request key.
There are no migration_baseline prices, unallocated payments, orphaned membership
references, duplicate open agreements or artificial throttle blocks in this seed.
Defensive compatibility checks in application code remain available; importing
this fresh data does not require those fallbacks or the historical SQL fixtures.

Dates are calculated when the SQL is imported, using Malaysia time. Upcoming,
ongoing and expired states naturally change as time passes; reimport the reset
only when you intentionally want to restore the demo scenarios. Importing replaces
existing application data. This file does not import itself into your live database.
