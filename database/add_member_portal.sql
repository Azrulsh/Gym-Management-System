-- Additive install. Existing users, profiles, agreements and payments are preserved.
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
