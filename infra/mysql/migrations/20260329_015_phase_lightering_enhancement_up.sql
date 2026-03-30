-- Phase 015 migration: lightering order enhancement
-- Date: 2026-03-29
-- Strategy: additive only, no destructive DDL.

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

CALL sp_add_column_if_missing('lighterings', 'ship_id', 'BIGINT UNSIGNED NULL AFTER `voyage_id`');
CALL sp_add_column_if_missing('lighterings', 'lightering_location', 'VARCHAR(128) NULL AFTER `receiver_ship_name`');
CALL sp_add_column_if_missing('lighterings', 'lightering_port', 'VARCHAR(128) NULL AFTER `lightering_location`');
CALL sp_add_column_if_missing('lighterings', 'lightering_time', 'DATETIME NULL AFTER `lightering_port`');
CALL sp_add_column_if_missing('lighterings', 'operator_id', 'BIGINT UNSIGNED NULL AFTER `lightering_time`');
CALL sp_add_column_if_missing('lighterings', 'operator_name', 'VARCHAR(64) NULL AFTER `operator_id`');
CALL sp_add_column_if_missing('lighterings', 'unload_empty_confirmed', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_main_ship_empty`');
CALL sp_add_column_if_missing('lighterings', 'remark', 'VARCHAR(255) NULL AFTER `empty_confirm_note`');
CALL sp_add_column_if_missing('lighterings', 'attachments', 'JSON NULL AFTER `remark`');

CALL sp_add_index_if_missing('lighterings', 'idx_lighterings_ship_id', 'KEY `idx_lighterings_ship_id` (`ship_id`)');
CALL sp_add_index_if_missing('lighterings', 'idx_lighterings_lightering_time', 'KEY `idx_lighterings_lightering_time` (`lightering_time`)');
CALL sp_add_index_if_missing('lighterings', 'idx_lighterings_unload_empty', 'KEY `idx_lighterings_unload_empty` (`unload_empty_confirmed`)');

CALL sp_add_fk_if_missing('lighterings', 'fk_lighterings_ship', 'FOREIGN KEY (`ship_id`) REFERENCES `ships` (`id`)');
CALL sp_add_fk_if_missing('lighterings', 'fk_lighterings_operator', 'FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`)');

UPDATE lighterings l
JOIN voyages v ON v.id = l.voyage_id
   SET l.ship_id = COALESCE(l.ship_id, v.ship_id)
 WHERE l.ship_id IS NULL;

UPDATE lighterings
   SET lightering_time = COALESCE(lightering_time, started_at, created_at)
 WHERE lightering_time IS NULL;

UPDATE lighterings
   SET unload_empty_confirmed = CASE WHEN is_main_ship_empty = 1 THEN 1 ELSE 0 END;

UPDATE lighterings
   SET remark = COALESCE(remark, empty_confirm_note)
 WHERE remark IS NULL
   AND empty_confirm_note IS NOT NULL;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_015_phase_lightering_enhancement', 'Phase 015 lightering structure enhancement', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;

