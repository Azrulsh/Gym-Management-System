# Gym Management System

A native PHP application for managing gym members, membership agreements, payments, recurring schedules, events and attendance. It includes an operations dashboard for Admin and Staff, and a Member Portal for members to access their own records.

This project uses plain PHP and MySQLi, not Laravel. It runs through Apache in XAMPP; `php artisan serve` is not required.

## Technology

- PHP and MySQLi, with MariaDB for persistence.
- Bootstrap and jQuery for the interface.
- DataTables for searchable tables, FullCalendar for schedules, and Select2 for selection controls.
- PHP Argon2id password hashing.
- Node.js's built-in test runner for automated PHP, JavaScript and HTTP regression tests.

PHP 8.4 and Node.js 24 have been used for local testing. Node.js is needed for tests, not to run the application.

## Features and access

| Feature | Admin | Staff | Member |
| --- | --- | --- | --- |
| Operations dashboard and member profiles | Manage | Manage | No access |
| Membership registration, renewal and closure | Manage | Manage | View own history |
| Payments and Plan fee allocations | Record and view | Record and view | View own history |
| Recurring schedules | Manage | Manage | View own schedule |
| Plans, packages and trainers | Manage | No administration access | View through own membership |
| Events | Create and manage participants | Manage participants and event attendance | Register or cancel own participation |
| Gym check-in and check-out | Manage | Manage | View own attendance |
| Attendance corrections and voids | Manage, with a reason and audit | No access | No access |
| Staff/Admin user accounts | Manage | No administration access | No access |
| Member Portal invitations, recovery and access | Manage | No access | Activate own account and manage own security |
| System Settings and branding | Manage | No access | No administration access |

Members can update their own contact information, address and avatar. Names, member numbers and email corrections are handled by gym staff. The image viewer supports Settings previews and protected Member/Attendance avatars.

## Local setup with XAMPP

1. Place the project in:

   ```text
   C:\xampp\htdocs\Gym-Management-System
   ```

2. Enable the PHP extensions required by the application: `mysqli`, `mbstring` and `fileinfo`. Enable GD for image uploads. In the Apache PHP configuration, uncomment `extension=gd` if needed, then restart Apache. PHP must support `PASSWORD_ARGON2ID`.
3. Start **Apache** and **MySQL** in the XAMPP Control Panel.
4. Open phpMyAdmin and create/select a database named `gym`.
5. Import **[database/gym.sql](database/gym.sql)**. This single file includes all 17 application tables, constraints and demo records, including System Settings, Events, Member Portal and Attendance.
6. Check the connection settings in [db_connect.php](db_connect.php). The local defaults are host `localhost`, username `root`, an empty password and database `gym`.
7. Open:

   ```text
   http://localhost/Gym-Management-System/login.php
   ```

The URL's folder segment must match the folder under `htdocs`. Apache and the database service must remain running while using the application. Log out of existing sessions after resetting the database.

**Database reset:** importing `gym.sql` drops and recreates the application tables and replaces their records. Import it only when you intend to reset the selected database. No separate migration or `add_*.sql` import is required.

## Demo accounts

These credentials are for local development only.

| Role / scenario | Username | Password |
| --- | --- | --- |
| Admin | `admin` | `admin` |
| Backup Admin | `admin2` | `admin2` |
| Staff | `staff` | `staff` |
| Enabled Member: Arun, number 100007 | `member` | `member` |
| Disabled Member: Wei, number 100011 | `member_disabled` | `member_disabled` |

The disabled account cannot sign in until an Admin enables its portal access. Member accounts use the same login page and are redirected to the Member Portal. Other profiles can be provisioned through **Member Portal Accounts** by an Admin; public self-signup is not available.

## Demo scenarios

The seed includes 15 member profiles, 13 membership agreements, 15 payments, 9 recurring schedules, 9 events, 10 event participation records and 5 gym visits.

- **Memberships:** Active, Expired, Scheduled and Closed agreements, renewal history, and profiles without a membership. Immediately after import, the dashboard shows 6 Active Members and 0 Needs attention.
- **Payments:** full and partial Plan payments, multiple instalments, no payments, Package/Trainer-only payments, and zero-fee choices. Every payment has an explicit Plan allocation.
- **Schedules:** past, current and future recurring sessions without same-member overlaps.
- **Events:** Draft, upcoming, ongoing, ended, Completed and Cancelled events; passed registration deadlines, full capacity and unlimited capacity.
- **Participants:** Registered, Cancelled, Attended and No-show records.
- **Gym attendance:** a member currently inside, checked-out visits and a voided visit with an audit reason.
- **Portal access:** enabled, disabled and unprovisioned member profiles. Arun's demo portal includes membership, payment, schedule, event and attendance data.

Dates are generated relative to the Malaysian import day. Statuses naturally change as time passes. System Settings starts with the gym name and bundled default images; description and contact fields are blank until an Admin fills them in.

See [database/README.md](database/README.md) for the full scenario guide, business rules and module details.

## Images and private storage

Branding images and member avatars are stored outside the webroot. On the standard XAMPP layout, the defaults are:

```text
C:\xampp\gym-storage\branding
C:\xampp\gym-storage\avatars
```

The application service account needs permission to create and write these directories. For a different server layout, configure these server environment variables with private absolute paths:

| Variable | Purpose |
| --- | --- |
| `GYM_BRANDING_STORAGE` | Logo and login cover files |
| `GYM_MEMBER_AVATAR_STORAGE` | Private member avatar files |

Uploads accept JPEG/PNG images up to 2 MB and are validated, resized and re-encoded. Without GD, image uploads are unavailable. Back up the private image directories together with the database.

## Security and business rules

- Server-side role checks, Member ownership checks and CSRF protection on write actions.
- Prepared queries for application data operations, input validation and escaped output.
- Argon2id for new passwords; legacy MD5 verification exists only to upgrade older accounts after successful login. The fresh seed contains no MD5 hashes.
- Login and current-password attempt throttling, with retry timing in user messages.
- Authentication versions invalidate sessions after relevant account/security changes.
- Transactions, record versions and locking protect relevant writes against conflicts and duplicate requests.
- Membership agreements retain captured prices and duration. Later catalog edits do not change those recorded terms.
- Gym check-in requires an Active membership and allows one open visit per member. Check-out remains available after membership expiry or closure.
- Attendance corrections require Admin access and a reason; voiding retains history instead of deleting it.

These safeguards do not constitute a security certification. Before deploying publicly, replace demo credentials, configure database credentials and HTTPS, review server permissions and error logging, and establish backup and recovery procedures.

## Tests

Start MariaDB and ensure PHP CLI can connect to the test database server. From the project root, run:

```powershell
node --test tests/*.test.mjs
```

The suite uses disposable databases and temporary files. The test database account must be allowed to create and drop the isolated test databases. Keep it separate from production services.

On Windows, the default PHP CLI path is `C:/xampp/php/php.exe`. Override it with `GYM_TEST_PHP` when needed. Database test helpers support `GYM_TEST_DB_HOST`, `GYM_TEST_DB_USER` and `GYM_TEST_DB_PASSWORD`; check individual fixtures before using a nonstandard setup.

To run the database and demo checks only:

```powershell
node --test tests/database-seed.test.mjs tests/demo-scenarios.test.mjs
```

Historical SQL under `tests/fixtures/legacy-schema` is used only for isolated regression fixtures. It is not part of application installation.

## Project layout

| Location | Purpose |
| --- | --- |
| `index.php`, `header.php`, `navbar.php`, `topbar.php` | Operations shell and shared interface |
| `auth.php`, `passwords.php`, `login_throttle.php` | Access control and authentication helpers |
| `ajax.php`, `admin_class.php` | Action routing and existing core operations |
| `membership_read.php`, `membership_dates.php`, `payment_read.php` | Membership state, date and payment calculations |
| `settings_*`, `events_*`, `attendance_*`, `member_portal_*` | Module handlers, rules, repositories and supporting UI |
| `assets/js` | Application JavaScript and bundled libraries |
| `assets/css` | Application styles and bundled stylesheets |
| `database/gym.sql` | Complete installation/reset schema and demo data |
| `tests` | Automated regression tests and isolated fixtures |

Application dates use `Asia/Kuala_Lumpur`; database connections use `+08:00`. Events, recurring schedules and gym attendance are separate records. Payments are recorded by staff; online payment processing, automated notifications and Member self-service renewals are not implemented.
