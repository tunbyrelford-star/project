-- Phase 5 migration: ship positioning module
-- Date: 2026-03-16
-- Strategy: additive, no DROP TABLE.

USE sand_logistics;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_key VARCHAR(128) NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rolled_back_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_schema_migrations_key (migration_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;

DELIMITER $$

CREATE PROCEDURE sp_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_index_ddl TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = p_table AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_index_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_fk_if_missing(
  IN p_table VARCHAR(64),
  IN p_fk_name VARCHAR(64),
  IN p_fk_ddl TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND constraint_name = p_fk_name
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk_name, '` ', p_fk_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- Guard rail: Ship.mmsi must be globally unique, and keep last_position_time for list display.
CALL sp_add_column_if_missing('ships', 'last_position_time', 'DATETIME NULL');
CALL sp_add_index_if_missing('ships', 'uk_ships_mmsi', 'UNIQUE KEY `uk_ships_mmsi` (`mmsi`)');

CREATE TABLE IF NOT EXISTS ship_position_latest (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ship_id BIGINT UNSIGNED NOT NULL,
  mmsi VARCHAR(32) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  speed_knots DECIMAL(8,2) NULL,
  course_deg DECIMAL(8,2) NULL,
  online_status ENUM('ONLINE', 'OFFLINE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  position_time DATETIME NOT NULL,
  port_name VARCHAR(128) NULL,
  is_in_port TINYINT(1) NOT NULL DEFAULT 0,
  port_stay_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  source_provider VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
  raw_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ship_position_latest_mmsi (mmsi),
  UNIQUE KEY uk_ship_position_latest_ship (ship_id),
  KEY idx_ship_position_latest_online (online_status),
  KEY idx_ship_position_latest_position_time (position_time),
  KEY idx_ship_position_latest_is_void (is_void),
  CONSTRAINT fk_ship_position_latest_ship FOREIGN KEY (ship_id) REFERENCES ships(id),
  CONSTRAINT fk_ship_position_latest_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ship_position_latest_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ship_frequent_ports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ship_id BIGINT UNSIGNED NOT NULL,
  mmsi VARCHAR(32) NOT NULL,
  port_name VARCHAR(128) NOT NULL,
  visit_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ship_frequent_ports_mmsi_port (mmsi, port_name),
  KEY idx_ship_frequent_ports_ship (ship_id),
  KEY idx_ship_frequent_ports_visit_count (visit_count),
  KEY idx_ship_frequent_ports_is_void (is_void),
  CONSTRAINT fk_ship_frequent_ports_ship FOREIGN KEY (ship_id) REFERENCES ships(id),
  CONSTRAINT fk_ship_frequent_ports_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ship_frequent_ports_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ship_position_provider_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(64) NOT NULL,
  ship_id BIGINT UNSIGNED NULL,
  mmsi VARCHAR(32) NOT NULL,
  provider_name VARCHAR(64) NOT NULL,
  request_url VARCHAR(512) NULL,
  http_status INT NULL,
  is_success TINYINT(1) NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NULL,
  error_message VARCHAR(500) NULL,
  response_excerpt TEXT NULL,
  called_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_ship_position_provider_logs_ship (ship_id),
  KEY idx_ship_position_provider_logs_mmsi (mmsi),
  KEY idx_ship_position_provider_logs_called_at (called_at),
  KEY idx_ship_position_provider_logs_success (is_success),
  KEY idx_ship_position_provider_logs_is_void (is_void),
  CONSTRAINT fk_ship_position_provider_logs_ship FOREIGN KEY (ship_id) REFERENCES ships(id),
  CONSTRAINT fk_ship_position_provider_logs_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ship_position_provider_logs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_004_phase5_ship_position', 'Phase 5 ship positioning schema', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
