-- Historical upgrade fixture for isolated tests only. Install the application with database/gym.sql.
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
INSERT IGNORE INTO system_settings (id, gym_name, about) VALUES (1, 'Gym Management System', '');
