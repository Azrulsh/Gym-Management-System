-- MariaDB: audit existing values before import; all must fit +/-9999999999.99.
-- Historical negative values are preserved; the save handlers only allow >= 0.
-- Conversion retains two decimal places of the values currently stored in FLOAT.
-- Original digits already lost to FLOAT rounding cannot be recovered.
-- Strict mode prevents out-of-range values from being silently clipped.
SET @gym_catalog_006_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_ALL_TABLES');
ALTER TABLE plans MODIFY amount DECIMAL(12,2) NOT NULL;
ALTER TABLE packages MODIFY amount DECIMAL(12,2) NOT NULL;
ALTER TABLE trainers MODIFY rate DECIMAL(12,2) NOT NULL;
SET SESSION sql_mode = @gym_catalog_006_sql_mode;
