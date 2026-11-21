-- DEVELOPMENT RESET: replaces application tables and data in the SELECTED database.
-- phpMyAdmin: select `gym` (matching db_connect.php), then import this entire file.
-- Includes migrations 001 through 016. Not an upgrade script for existing records.
-- Local demo accounts: admin / admin, admin2 / admin2 (Admins); staff / staff (Staff).
-- No CREATE DATABASE or USE: the caller chooses the target database.
SET NAMES utf8mb4;
SET SESSION time_zone = '+08:00';

DROP TABLE IF EXISTS attendance_audit;
DROP TABLE IF EXISTS attendance_visits;
DROP TABLE IF EXISTS member_portal_tokens;
DROP TABLE IF EXISTS member_portal_accounts;
DROP TABLE IF EXISTS member_portal_audit;
DROP TABLE IF EXISTS event_registrations;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS registration_info;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS trainers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS login_throttle;

CREATE TABLE members (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  firstname VARCHAR(100) NOT NULL,
  middlename VARCHAR(100) NOT NULL,
  lastname VARCHAR(100) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  contact VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  email VARCHAR(100) NOT NULL,
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY members_number_unique (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE plans (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plan INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE packages (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  package VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trainers (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  contact VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  rate DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE registration_info (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  plan_id INT NOT NULL,
  package_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  trainer_id INT NOT NULL DEFAULT 0 COMMENT '0 = no trainer',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '0=Closed; 1=open (dates determine Active/Expired/Scheduled)',
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY member_status (member_id, status),
  plan_fee DECIMAL(12,2) NULL,
  package_fee DECIMAL(12,2) NULL,
  trainer_fee_snapshot DECIMAL(12,2) NULL,
  price_source VARCHAR(24) NOT NULL DEFAULT 'legacy_unrecorded',
  prices_recorded_at DATETIME NULL,
  plan_months INT NULL,
  KEY plan_id (plan_id),
  KEY package_id (package_id),
  KEY trainer_id (trainer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration 002 integrated.
CREATE TABLE payments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  registration_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  plan_amount DECIMAL(12,2) NULL,
  request_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  UNIQUE KEY payments_request_key_unique (request_key),
  remarks TEXT NOT NULL,
  type TINYINT NOT NULL DEFAULT 2 COMMENT '1=registration, 2=monthly payment',
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY registration_id (registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE schedules (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  dow TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  time_from TIME NOT NULL,
  time_to TIME NOT NULL,
  KEY member_id (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  version INT UNSIGNED NOT NULL DEFAULT 1,
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  username VARCHAR(200) NOT NULL,
  password TEXT NOT NULL,
  type TINYINT NOT NULL DEFAULT 2 COMMENT '1=Admin, 2=Staff, 3=Member (requires portal account link)',
  auth_version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration 001 integrated.
CREATE TABLE login_throttle (
  bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (bucket),
  KEY expires_at (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  gym_name VARCHAR(100) NOT NULL DEFAULT 'Gym Management System',
  email VARCHAR(254) NOT NULL DEFAULT '',
  contact VARCHAR(50) NOT NULL DEFAULT '',
  address VARCHAR(1000) NOT NULL DEFAULT '',
  about TEXT NOT NULL,
  logo_filename VARCHAR(68) NULL,
  cover_filename VARCHAR(68) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INT NULL,
  CONSTRAINT system_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(250) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  registration_closes_at DATETIME NULL,
  capacity INT UNSIGNED NULL,
  status ENUM('draft','published','cancelled','completed') NOT NULL DEFAULT 'draft',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  request_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  created_by INT NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY events_status_start (status, starts_at),
  CONSTRAINT events_times CHECK (ends_at > starts_at),
  CONSTRAINT events_capacity CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT events_deadline CHECK (registration_closes_at IS NULL OR registration_closes_at <= starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_registrations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  member_id INT NOT NULL,
  status ENUM('registered','cancelled','attended','no_show') NOT NULL DEFAULT 'registered',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY event_member_unique (event_id, member_id),
  KEY event_participant_status (event_id, status),
  CONSTRAINT event_registration_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  CONSTRAINT event_registration_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS member_portal_accounts (
  user_id INT NOT NULL PRIMARY KEY,
  member_id INT NOT NULL UNIQUE,
  enabled TINYINT NOT NULL DEFAULT 1,
  avatar_filename VARCHAR(68) NULL,
  CONSTRAINT portal_enabled CHECK (enabled IN (0,1)),
  CONSTRAINT portal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT portal_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS member_portal_tokens (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  purpose ENUM('activate','reset') NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY portal_token_member (member_id, purpose),
  CONSTRAINT portal_token_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS member_portal_audit (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL,
  member_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY portal_audit_member (member_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS attendance_visits (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  registration_id INT NOT NULL,
  checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_at DATETIME NULL,
  checked_in_by INT NOT NULL,
  checked_out_by INT NULL,
  checkin_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  checkout_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  voided_at DATETIME NULL,
  updated_by INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  open_member_id INT GENERATED ALWAYS AS (CASE WHEN checked_out_at IS NULL AND voided_at IS NULL THEN member_id ELSE NULL END) STORED,
  UNIQUE KEY attendance_one_open_visit (open_member_id),
  KEY attendance_member_time (member_id, checked_in_at),
  KEY attendance_time (checked_in_at),
  CONSTRAINT attendance_times CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
  CONSTRAINT attendance_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT attendance_agreement FOREIGN KEY (registration_id) REFERENCES registration_info(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_audit (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  visit_id INT NOT NULL,
  actor_id INT NOT NULL,
  action ENUM('checkin','checkout','correction','void') NOT NULL,
  reason VARCHAR(1000) NOT NULL DEFAULT '',
  before_state TEXT NULL,
  after_state TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY attendance_audit_visit (visit_id,id),
  CONSTRAINT attendance_audit_visit FOREIGN KEY (visit_id) REFERENCES attendance_visits(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- All sample people, contacts and transactions below are fictional.
-- Anchor dates to Malaysian import day so demo statuses remain useful on future imports.
SET @demo_today = CURDATE();
SET @demo_month = DATE_SUB(@demo_today, INTERVAL DAYOFMONTH(@demo_today) - 1 DAY);
START TRANSACTION;
INSERT INTO system_settings (id,gym_name,email,contact,address,about) VALUES
(1,'Gym Management System','gym@example.test','03-0000 0000','Demo Gym, Kuala Lumpur','Welcome to our demo gym. Train at your own pace with our team.');

INSERT INTO users (id, name, username, password, type) VALUES
(1, 'Demo Admin', 'admin', '$argon2id$v=19$m=19456,t=2,p=1$OVV2dEpOZkFmdmVHN3NmUg$wSUtNYJnlfgG1pMRvdQswyDlBdkhUQgQDHHqxV6pR6g', 1),
(2, 'Demo Staff', 'staff', '$argon2id$v=19$m=19456,t=2,p=1$dk5hSmN0MDR2QzRsQU9Ycw$FuQCiGXpenFZ3LZjdD/8zR6Yg5wNGe0Z9/YH8UP2Y5M', 2),
(3, 'Demo Backup Admin', 'admin2', '$argon2id$v=19$m=19456,t=2,p=1$b1g5akU5VjgxMDMuRGs3Rw$HqOYYd6PfQSNUNGrxU0Do2++EjG6rtjleGM2U7eQwqo', 1);

INSERT INTO plans (id, plan, amount) VALUES
(1, 1, 100.00), (2, 3, 270.00), (3, 12, 960.00), (4, 6, 450.75), (5, 9, 675.00);
INSERT INTO packages (id, package, description, amount) VALUES
(1, 'Basic', 'Gym equipment access per month.', 30.00),
(2, 'Premium', 'Gym equipment and group classes per month.', 60.00),
(3, 'Strength', 'Gym equipment and strength programme per month.', 75.50),
(4, 'Studio', 'Studio and mobility classes per month.', 45.25),
(5, 'Complimentary Access', 'Complimentary monthly access; membership Plan fee still applies.', 0.00),
(6, 'Weekend Access', 'Unused demo package for testing edit and delete.', 25.00);
INSERT INTO trainers (id, name, contact, email, rate) VALUES
(1, 'Hafiz Rahman', '0120000101', 'hafiz.trainer@example.test', 50.00),
(2, 'Nadia Ismail', '0120000102', 'nadia.trainer@example.test', 65.25),
(3, 'Marcus O''Neil', '0120000103', 'marcus.trainer@example.test', 0.00),
(4, 'Izzat Hamdan', '0120000104', 'izzat.trainer@example.test', 80.00);

INSERT INTO members (id, member_id, firstname, middlename, lastname, gender, contact, address, email) VALUES
(1, 100001, 'Ali', '', 'Ahmad', 'Male', '0120000001', 'Kuala Lumpur', 'ali@example.test'),
(2, 100002, 'Siti', '', 'Aminah', 'Female', '0120000002', 'Kuantan', 'siti@example.test'),
(3, 100003, 'Kumar', '', 'Ravi', 'Male', '0120000003', 'Ipoh', 'kumar@example.test'),
(4, 100004, 'Mei', '', 'Tan', 'Female', '0120000004', 'Melaka', 'mei@example.test'),
(5, 100005, 'Fatin', '', 'Hassan', 'Female', '0120000005', 'Shah Alam', 'fatin@example.test'),
(6, 100006, 'Jason', '', 'Lee', 'Male', '0120000006', 'Petaling Jaya', 'jason@example.test'),
(7, 100007, 'Arun', '', 'Kumar', 'Male', '0120000007', 'Seremban', 'arun@example.test'),
(8, 100008, 'Nur', 'Aisyah', 'Abdullah', 'Female', '0120000008', 'Kuantan', 'nur.aisyah@example.test'),
(9, 100009, 'Daniel', '', 'Wong', 'Male', '0120000009', 'Kuala Lumpur', 'daniel@example.test'),
(10, 100010, 'Aina', '', 'Zulkifli', 'Female', '0120000010', 'Putrajaya', 'aina@example.test'),
(11, 100011, 'Wei', '', 'Lim', 'Male', '0120000011', 'Ipoh', 'wei.lim@example.test'),
(12, 100012, 'Zara', '', 'Aziz', 'Female', '0120000012', 'Bangi', 'zara@example.test'),
(13, 100013, 'Hakim', '', 'Osman', 'Male', '0120000013', 'Kajang', 'hakim@example.test'),
(14, 100014, 'Priya', '', 'Devi', 'Female', '0120000014', 'Klang', 'priya@example.test'),
(15, 100015, 'Farah', '', 'Yusof', 'Female', '0120000015', 'Cyberjaya', 'farah@example.test');

-- 6 Active; 3 Expired/renewable; 1 Scheduled; 3 Closed history records.
-- Fatin has a Closed agreement followed by a current agreement (renewal history).
-- Kumar/Wei have only Closed history; Mei/Zara/Farah have no membership yet.
INSERT INTO registration_info (id, member_id, plan_id, package_id, trainer_id, start_date, end_date, status) VALUES
(1, 1, 2, 2, 1, @demo_month, DATE_ADD(@demo_month, INTERVAL 3 MONTH), 1),
(2, 2, 1, 1, 0, DATE_SUB(@demo_month, INTERVAL 2 MONTH), DATE_SUB(@demo_month, INTERVAL 1 MONTH), 1),
(3, 3, 1, 1, 0, DATE_SUB(@demo_month, INTERVAL 3 MONTH), DATE_SUB(@demo_month, INTERVAL 2 MONTH), 0),
(4, 5, 1, 1, 0, DATE_SUB(@demo_month, INTERVAL 2 MONTH), DATE_SUB(@demo_month, INTERVAL 1 MONTH), 0),
(5, 5, 2, 1, 2, @demo_month, DATE_ADD(@demo_month, INTERVAL 3 MONTH), 1),
(6, 6, 2, 2, 0, DATE_ADD(@demo_month, INTERVAL 1 MONTH), DATE_ADD(@demo_month, INTERVAL 4 MONTH), 1),
(7, 7, 4, 3, 1, @demo_month, DATE_ADD(@demo_month, INTERVAL 6 MONTH), 1),
(8, 8, 1, 1, 0, DATE_SUB(@demo_month, INTERVAL 2 MONTH), DATE_SUB(@demo_month, INTERVAL 1 MONTH), 1),
(9, 9, 3, 2, 2, DATE_SUB(@demo_month, INTERVAL 1 MONTH), DATE_ADD(@demo_month, INTERVAL 11 MONTH), 1),
(10, 10, 1, 4, 3, @demo_month, DATE_ADD(@demo_month, INTERVAL 1 MONTH), 1),
(11, 11, 3, 1, 0, DATE_SUB(@demo_month, INTERVAL 14 MONTH), DATE_SUB(@demo_month, INTERVAL 2 MONTH), 0),
(12, 13, 1, 5, 0, @demo_month, DATE_ADD(@demo_month, INTERVAL 1 MONTH), 1),
(13, 14, 1, 1, 0, DATE_SUB(@demo_month, INTERVAL 2 MONTH), DATE_SUB(@demo_month, INTERVAL 1 MONTH), 1);

-- These agreements were created using known catalog fees. No guessed legacy prices.
UPDATE registration_info r JOIN plans p ON p.id=r.plan_id
JOIN packages pp ON pp.id=r.package_id LEFT JOIN trainers t ON t.id=r.trainer_id
SET r.plan_fee=p.amount, r.package_fee=pp.amount, r.plan_months=p.plan,
    r.trainer_fee_snapshot=CASE WHEN r.trainer_id=0 THEN 0 ELSE t.rate END,
    r.price_source='captured', r.prices_recorded_at=LEAST(r.start_date, @demo_today),
    r.date_created=LEAST(r.start_date, @demo_today);

-- plan_amount is part of amount, not an additional charge.
-- Every payment has an explicit allocation and unique request key; no legacy warning.
INSERT INTO payments (id, registration_id, amount, plan_amount, request_key, remarks, type, date_created) VALUES
(1, 1, 100.50, 100.50, SHA2('gym-demo-payment-01',256), 'Partial Plan fee; remaining RM169.50.', 2, @demo_month),
(2, 1, 110.00, 0.00, SHA2('gym-demo-payment-02',256), 'Package RM60 and Trainer RM50; no Plan allocation.', 2, LEAST(@demo_today, DATE_ADD(@demo_month, INTERVAL 7 DAY))),
(3, 2, 130.00, 100.00, SHA2('gym-demo-payment-03',256), 'Plan RM100 and Package RM30; previous expired agreement.', 2, DATE_SUB(@demo_month, INTERVAL 2 MONTH)),
(4, 3, 130.00, 100.00, SHA2('gym-demo-payment-04',256), 'Plan and Package paid; agreement later closed.', 2, DATE_SUB(@demo_month, INTERVAL 3 MONTH)),
(5, 4, 130.00, 100.00, SHA2('gym-demo-payment-05',256), 'Previous agreement settled before renewal.', 2, DATE_SUB(@demo_month, INTERVAL 2 MONTH)),
(6, 5, 365.25, 270.00, SHA2('gym-demo-payment-06',256), 'Renewed Plan RM270, Package RM30 and Trainer RM65.25.', 2, @demo_month),
(7, 7, 200.00, 200.00, SHA2('gym-demo-payment-07',256), 'First Plan instalment.', 2, @demo_month),
(8, 7, 100.00, 100.00, SHA2('gym-demo-payment-08',256), 'Second Plan instalment; remaining RM150.75.', 2, LEAST(@demo_today, DATE_ADD(@demo_month, INTERVAL 7 DAY))),
(9, 7, 125.50, 0.00, SHA2('gym-demo-payment-09',256), 'Package RM75.50 and Trainer RM50.', 2, LEAST(@demo_today, DATE_ADD(@demo_month, INTERVAL 14 DAY))),
(10, 9, 1085.25, 960.00, SHA2('gym-demo-payment-10',256), 'Plan RM960, Package RM60 and Trainer RM65.25.', 2, DATE_SUB(@demo_month, INTERVAL 1 MONTH)),
(11, 9, 125.25, 0.00, SHA2('gym-demo-payment-11',256), 'Package and Trainer only; Plan already paid.', 2, @demo_month),
(12, 11, 990.00, 960.00, SHA2('gym-demo-payment-12',256), 'Historical annual Plan and first Package payment.', 2, DATE_SUB(@demo_month, INTERVAL 14 MONTH)),
(13, 12, 100.00, 100.00, SHA2('gym-demo-payment-13',256), 'Plan paid; complimentary Package and no Trainer.', 2, @demo_month),
(14, 13, 40.00, 40.00, SHA2('gym-demo-payment-14',256), 'Partial Plan fee; remaining RM60 on expired agreement.', 2, DATE_SUB(@demo_month, INTERVAL 2 MONTH)),
(15, 13, 30.00, 0.00, SHA2('gym-demo-payment-15',256), 'Package only; does not settle the remaining Plan fee.', 2, DATE_ADD(DATE_SUB(@demo_month, INTERVAL 2 MONTH), INTERVAL 7 DAY));

-- Recurring sessions cover this month and next month. Same-member sessions do not overlap.
-- dow: Sunday=0, Monday=1, ... Saturday=6. End date is inclusive.
INSERT INTO schedules (id, member_id, dow, date_from, date_to, time_from, time_to) VALUES
(1, 1, '1,3', @demo_month, LAST_DAY(DATE_ADD(@demo_month, INTERVAL 1 MONTH)), '08:00:00', '09:00:00'),
(2, 1, '5', @demo_month, LAST_DAY(DATE_ADD(@demo_month, INTERVAL 1 MONTH)), '09:00:00', '10:00:00'),
(3, 5, '2,4', @demo_month, LAST_DAY(DATE_ADD(@demo_month, INTERVAL 1 MONTH)), '10:00:00', '11:00:00'),
(4, 7, '1,3', @demo_month, LAST_DAY(DATE_ADD(@demo_month, INTERVAL 1 MONTH)), '18:00:00', '19:00:00'),
(5, 9, '2,4', @demo_month, LAST_DAY(DATE_ADD(@demo_month, INTERVAL 1 MONTH)), '19:00:00', '20:00:00'),
(6, 10, '6', @demo_month, LAST_DAY(@demo_month), '09:00:00', '10:00:00'),
(7, 13, '5', @demo_month, LAST_DAY(@demo_month), '18:00:00', '19:00:00');

-- No stale sessions, artificial login blocks or incomplete/orphaned demo records.
-- login_throttle intentionally starts empty; all edit/auth versions start at 1.
-- Events are separate group activities; no payments or membership changes are implied.
INSERT INTO events (id,title,description,location,starts_at,ends_at,capacity,status,request_key,created_by,updated_by) VALUES
(1,'Community Fitness Morning','A friendly group workout. Bring water and a towel.','Main Studio',TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 1 DAY),'09:00:00'),TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 1 DAY),'11:00:00'),20,'published',REPEAT('a',64),1,1),
(2,'Nutrition Workshop','Draft programme for review.','Meeting Room',TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 7 DAY),'14:00:00'),TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 7 DAY),'16:00:00'),15,'draft',REPEAT('b',64),1,1),
(3,'Past Fitness Challenge','Completed demo activity with attendance history.','Main Studio',TIMESTAMP(DATE_SUB(@demo_month,INTERVAL 1 MONTH),'09:00:00'),TIMESTAMP(DATE_SUB(@demo_month,INTERVAL 1 MONTH),'11:00:00'),30,'completed',REPEAT('c',64),1,1),
(4,'Outdoor Bootcamp','Cancelled because the venue is unavailable.','Outdoor Court',TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 3 DAY),'08:00:00'),TIMESTAMP(DATE_ADD(@demo_today,INTERVAL 3 DAY),'10:00:00'),20,'cancelled',REPEAT('d',64),1,1);
INSERT INTO event_registrations (event_id,member_id,status,created_by,updated_by)
SELECT 1,m.id,'registered',1,1 FROM members m WHERE EXISTS
(SELECT 1 FROM registration_info r WHERE r.member_id=m.id AND r.status=1 AND r.start_date<=DATE_ADD(@demo_today,INTERVAL 1 DAY) AND r.end_date>=DATE_ADD(@demo_today,INTERVAL 1 DAY)) ORDER BY m.id LIMIT 2;
INSERT INTO event_registrations (event_id,member_id,status,created_by,updated_by) VALUES
(3,9,'attended',1,1),(3,2,'no_show',1,1),(4,1,'registered',1,1);
-- Attendance examples: one completed visit, one currently inside, one historical expired member.
INSERT INTO attendance_visits (id,member_id,registration_id,checked_in_at,checked_out_at,checked_in_by,checked_out_by,checkin_key,checkout_key,updated_by) VALUES
(1,9,9,DATE_SUB(NOW(),INTERVAL 2 HOUR),DATE_SUB(NOW(),INTERVAL 90 MINUTE),2,2,REPEAT('1',64),REPEAT('4',64),2),
(2,9,9,DATE_SUB(NOW(),INTERVAL 30 MINUTE),NULL,2,NULL,REPEAT('2',64),NULL,2),
(3,2,2,TIMESTAMP(DATE_SUB(@demo_month,INTERVAL 1 MONTH),'09:00:00'),TIMESTAMP(DATE_SUB(@demo_month,INTERVAL 1 MONTH),'10:00:00'),2,2,REPEAT('3',64),REPEAT('5',64),2);
INSERT INTO attendance_audit (visit_id,actor_id,action,before_state,after_state,created_at)
SELECT id,checked_in_by,'checkin',NULL,JSON_OBJECT('id',id,'member_id',member_id,'registration_id',registration_id,'checked_in_at',checked_in_at,'checked_out_at',NULL),checked_in_at FROM attendance_visits;
INSERT INTO attendance_audit (visit_id,actor_id,action,before_state,after_state,created_at)
SELECT id,checked_out_by,'checkout',JSON_OBJECT('checked_out_at',NULL),JSON_OBJECT('checked_out_at',checked_out_at),checked_out_at FROM attendance_visits WHERE checked_out_at IS NOT NULL;
COMMIT;
