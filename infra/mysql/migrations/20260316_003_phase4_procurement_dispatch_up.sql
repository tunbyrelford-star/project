-- Phase 4 migration: procurement and dispatch main chain
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

CREATE TABLE IF NOT EXISTS buyer_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  buyer_name VARCHAR(128) NOT NULL,
  available_balance DECIMAL(16,2) NOT NULL DEFAULT 0,
  frozen_balance DECIMAL(16,2) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_buyer_accounts_buyer_name (buyer_name),
  KEY idx_buyer_accounts_status (status),
  KEY idx_buyer_accounts_is_void (is_void),
  CONSTRAINT fk_buyer_accounts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_buyer_accounts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS voyage_no_sequences (
  seq_date DATE NOT NULL,
  seq_no INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (seq_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CALL sp_add_column_if_missing('procurements', 'buyer_account_id', 'BIGINT UNSIGNED NULL AFTER `buyer_name`');
CALL sp_add_column_if_missing('procurements', 'dispatcher_user_id', 'BIGINT UNSIGNED NULL AFTER `buyer_account_id`');
CALL sp_add_column_if_missing('procurements', 'submitted_at', 'DATETIME NULL AFTER `planned_duration_min`');
CALL sp_add_column_if_missing('procurements', 'sand_started_by', 'BIGINT UNSIGNED NULL AFTER `sand_start_time`');
CALL sp_add_column_if_missing('procurements', 'alert_sanding_timeout_at', 'DATETIME NULL AFTER `sand_started_by`');

CALL sp_add_index_if_missing('procurements', 'idx_procurements_buyer_account', 'INDEX `idx_procurements_buyer_account` (`buyer_account_id`)');
CALL sp_add_index_if_missing('procurements', 'idx_procurements_dispatcher', 'INDEX `idx_procurements_dispatcher` (`dispatcher_user_id`)');
CALL sp_add_index_if_missing('procurements', 'idx_procurements_submitted_at', 'INDEX `idx_procurements_submitted_at` (`submitted_at`)');
CALL sp_add_index_if_missing('procurements', 'idx_procurements_sand_started_by', 'INDEX `idx_procurements_sand_started_by` (`sand_started_by`)');

CALL sp_add_fk_if_missing('procurements', 'fk_procurements_buyer_account', 'FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`)');
CALL sp_add_fk_if_missing('procurements', 'fk_procurements_dispatcher', 'FOREIGN KEY (`dispatcher_user_id`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('procurements', 'fk_procurements_sand_started_by', 'FOREIGN KEY (`sand_started_by`) REFERENCES `users`(`id`)');

CALL sp_add_column_if_missing('alerts', 'stage_code', 'VARCHAR(64) NULL AFTER `alert_type`');
CALL sp_add_column_if_missing('alerts', 'closure_required', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `status`');
CALL sp_add_column_if_missing('alerts', 'closed_by', 'BIGINT UNSIGNED NULL AFTER `handled_by`');

CALL sp_add_index_if_missing('alerts', 'idx_alerts_stage_code', 'INDEX `idx_alerts_stage_code` (`stage_code`)');
CALL sp_add_index_if_missing('alerts', 'uk_alerts_once_per_stage',
  'UNIQUE KEY `uk_alerts_once_per_stage` (`related_entity_type`, `related_entity_id`, `stage_code`, `alert_type`, `is_void`)');
CALL sp_add_fk_if_missing('alerts', 'fk_alerts_closed_by', 'FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`)');

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_003_phase4_procurement_dispatch', 'Phase 4 procurement-dispatch schema', NOW())
ON DUPLICATE KEY UPDATE description = VALUES(description), rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;

