-- Additive installation: preserves existing application data. Run in the selected gym database.
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
