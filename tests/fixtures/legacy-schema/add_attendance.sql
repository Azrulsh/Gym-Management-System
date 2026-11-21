-- Historical upgrade fixture for isolated tests only. Install the application with database/gym.sql.
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
