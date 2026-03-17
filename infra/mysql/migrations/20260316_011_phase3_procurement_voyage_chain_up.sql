-- Phase 3 migration: procurement + dispatch + voyage chain alignment
-- Date: 2026-03-16
-- Strategy: additive, no destructive drop.

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

-- Procurement required fields alignment
CALL sp_add_column_if_missing('procurements', 'ship_id', 'BIGINT UNSIGNED NULL AFTER buyer_name');
CALL sp_add_column_if_missing('procurements', 'supplier_id', 'BIGINT UNSIGNED NULL AFTER ship_id');
CALL sp_add_column_if_missing('procurements', 'mining_ticket', 'VARCHAR(512) NULL AFTER total_amount');
CALL sp_add_column_if_missing('procurements', 'quality_photos', 'JSON NULL AFTER mining_ticket');

CALL sp_add_index_if_missing('procurements', 'idx_procurements_ship_id', 'KEY `idx_procurements_ship_id` (`ship_id`)');
CALL sp_add_index_if_missing('procurements', 'idx_procurements_supplier_id', 'KEY `idx_procurements_supplier_id` (`supplier_id`)');

CALL sp_add_fk_if_missing('procurements', 'fk_procurements_ship', 'FOREIGN KEY (`ship_id`) REFERENCES `ships` (`id`)');
CALL sp_add_fk_if_missing('procurements', 'fk_procurements_supplier', 'FOREIGN KEY (`supplier_id`) REFERENCES `buyer_accounts` (`id`)');

-- Backfill from existing model
UPDATE procurements p
LEFT JOIN voyages v ON v.procurement_id = p.id AND v.is_void = 0
SET p.ship_id = COALESCE(p.ship_id, v.ship_id)
WHERE p.is_void = 0
  AND p.ship_id IS NULL;

UPDATE procurements
SET supplier_id = COALESCE(supplier_id, buyer_account_id)
WHERE is_void = 0
  AND supplier_id IS NULL;

UPDATE procurements
SET mining_ticket = COALESCE(mining_ticket, mining_ticket_url)
WHERE is_void = 0
  AND mining_ticket IS NULL
  AND mining_ticket_url IS NOT NULL;

UPDATE procurements
SET quality_photos = COALESCE(quality_photos, quality_photo_urls)
WHERE is_void = 0
  AND quality_photos IS NULL
  AND quality_photo_urls IS NOT NULL;

-- Seed supplier accounts for procurement selection baseline
INSERT INTO buyer_accounts
  (buyer_name, available_balance, frozen_balance, status, created_at, updated_at, is_void)
VALUES
  ('供应商A', 1000000.00, 0.00, 'ACTIVE', NOW(), NOW(), 0),
  ('供应商B', 800000.00, 0.00, 'ACTIVE', NOW(), NOW(), 0),
  ('供应商C', 600000.00, 0.00, 'ACTIVE', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  available_balance = VALUES(available_balance),
  status = VALUES(status),
  updated_at = NOW(),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_011_phase3_procurement_voyage_chain', 'Phase 3 procurement dispatch voyage chain alignment', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
