-- Run once on the application database before deploying login_throttle.php.
CREATE TABLE IF NOT EXISTS login_throttle (
    bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (bucket),
    KEY expires_at (expires_at)
) ENGINE=InnoDB;
