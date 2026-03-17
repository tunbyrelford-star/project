-- Phase 1 migration: ship master data enhancement
-- Date: 2026-03-16
-- Strategy: additive only, no DROP TABLE.

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

DELIMITER ;

-- Ship master data fields
CALL sp_add_column_if_missing('ships', 'ship_type', 'VARCHAR(64) NULL AFTER mmsi');
CALL sp_add_column_if_missing('ships', 'tonnage', 'DECIMAL(14,3) NULL AFTER ship_type');
CALL sp_add_column_if_missing('ships', 'owner_name', 'VARCHAR(128) NULL AFTER tonnage');
CALL sp_add_column_if_missing('ships', 'contact_phone', 'VARCHAR(32) NULL AFTER owner_name');
CALL sp_add_column_if_missing('ships', 'common_ports', 'VARCHAR(512) NULL AFTER contact_phone');
CALL sp_add_column_if_missing('ships', 'remark', 'VARCHAR(500) NULL AFTER status');

-- List/search support
CALL sp_add_index_if_missing('ships', 'idx_ships_status', 'KEY `idx_ships_status` (`status`)');
CALL sp_add_index_if_missing('ships', 'idx_ships_ship_type', 'KEY `idx_ships_ship_type` (`ship_type`)');
CALL sp_add_index_if_missing('ships', 'idx_ships_tonnage', 'KEY `idx_ships_tonnage` (`tonnage`)');
CALL sp_add_index_if_missing('ships', 'uk_ships_mmsi', 'UNIQUE KEY `uk_ships_mmsi` (`mmsi`)');

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_009_phase1_ship_management', 'Phase 1 ship management schema enhancement', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
