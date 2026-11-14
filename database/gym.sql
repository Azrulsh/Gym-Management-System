-- DEVELOPMENT RESET: replaces application tables and data in the SELECTED database.
-- phpMyAdmin: select `gym` (matching db_connect.php), then import this entire file.
-- Includes migrations 001 and 002. Not an upgrade script for existing records.
-- Local demo accounts: admin / admin (Admin), staff / staff (Staff).
-- No CREATE DATABASE or USE: the caller chooses the target database.
SET NAMES utf8mb4;

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
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  firstname VARCHAR(100) NOT NULL,
  middlename VARCHAR(100) NOT NULL,
  lastname VARCHAR(100) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  contact VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  email VARCHAR(100) NOT NULL,
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE plans (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plan INT NOT NULL,
  amount FLOAT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE packages (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  package VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  amount FLOAT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trainers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  contact VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  rate FLOAT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE registration_info (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  plan_id INT NOT NULL,
  package_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  trainer_id TINYINT NOT NULL DEFAULT 0 COMMENT '0 = no trainer',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '0=Closed; 1=open (dates determine Active/Expired/Scheduled)',
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY member_status (member_id, status),
  KEY plan_id (plan_id),
  KEY package_id (package_id),
  KEY trainer_id (trainer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration 002 integrated.
CREATE TABLE payments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  registration_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  remarks TEXT NOT NULL,
  type TINYINT NOT NULL DEFAULT 2 COMMENT '1=registration, 2=monthly payment',
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY registration_id (registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE schedules (
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
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  username VARCHAR(200) NOT NULL,
  password TEXT NOT NULL,
  type TINYINT NOT NULL DEFAULT 2 COMMENT '1=Admin, 2=Staff'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration 001 integrated.
CREATE TABLE login_throttle (
  bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (bucket),
  KEY expires_at (expires_at)
) ENGINE=InnoDB;

INSERT INTO users (id, name, username, password, type) VALUES
(1, 'Demo Admin', 'admin', '$argon2id$v=19$m=19456,t=2,p=1$OVV2dEpOZkFmdmVHN3NmUg$wSUtNYJnlfgG1pMRvdQswyDlBdkhUQgQDHHqxV6pR6g', 1),
(2, 'Demo Staff', 'staff', '$argon2id$v=19$m=19456,t=2,p=1$dk5hSmN0MDR2QzRsQU9Ycw$FuQCiGXpenFZ3LZjdD/8zR6Yg5wNGe0Z9/YH8UP2Y5M', 2);

INSERT INTO plans (id, plan, amount) VALUES (1, 1, 100), (2, 3, 270), (3, 12, 960);
INSERT INTO packages (id, package, description, amount) VALUES
(1, 'Basic', 'Gym equipment access', 30),
(2, 'Premium', 'Gym equipment and group classes', 60);
INSERT INTO trainers (id, name, contact, email, rate) VALUES
(1, 'Demo Trainer', '0123456789', 'trainer@example.test', 50);

INSERT INTO members (id, member_id, firstname, middlename, lastname, gender, contact, address, email) VALUES
(1, 100001, 'Ali', '', 'Ahmad', 'Male', '0120000001', 'Kuala Lumpur', 'ali@example.test'),
(2, 100002, 'Siti', '', 'Aminah', 'Female', '0120000002', 'Kuantan', 'siti@example.test'),
(3, 100003, 'Kumar', '', 'Ravi', 'Male', '0120000003', 'Ipoh', 'kumar@example.test'),
(4, 100004, 'Mei', '', 'Tan', 'Female', '0120000004', 'Melaka', 'mei@example.test');

-- Dates relative to import day: Ali Active; Siti Expired/renewable;
-- Kumar Closed/eligible for a new plan; Mei has no membership yet.
INSERT INTO registration_info (id, member_id, plan_id, package_id, trainer_id, start_date, end_date, status) VALUES
(1, 1, 2, 2, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 MONTH), 1),
(2, 2, 1, 1, 0, DATE_SUB(CURDATE(), INTERVAL 2 MONTH), DATE_SUB(CURDATE(), INTERVAL 1 MONTH), 1),
(3, 3, 1, 1, 0, DATE_SUB(CURDATE(), INTERVAL 3 MONTH), DATE_SUB(CURDATE(), INTERVAL 2 MONTH), 0);

INSERT INTO payments (registration_id, amount, remarks, type) VALUES
(1, 100.50, 'Demo partial payment', 2),
(2, 130.00, 'Demo payment for previous membership', 2);
