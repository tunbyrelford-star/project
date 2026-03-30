-- Phase 017 migration: weighing slip enhancement for difference tracking and allocation traceability
-- Date: 2026-03-29
-- Strategy: additive only, non-destructive.

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

-- Weighing slip enhancement fields.
CALL sp_add_column_if_missing('weighing_slips', 'weighing_no', 'VARCHAR(64) NULL AFTER `slip_no`');
CALL sp_add_column_if_missing('weighing_slips', 'attachments', 'JSON NULL AFTER `voucher_url`');
CALL sp_add_column_if_missing('weighing_slips', 'difference_confirmed', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `attachments`');
CALL sp_add_column_if_missing('weighing_slips', 'difference_confirmed_by', 'BIGINT UNSIGNED NULL AFTER `difference_confirmed`');
CALL sp_add_column_if_missing('weighing_slips', 'difference_confirmed_at', 'DATETIME NULL AFTER `difference_confirmed_by`');
CALL sp_add_column_if_missing('weighing_slips', 'difference_status',
  "ENUM('NO_DIFF','PENDING_CONFIRM','CONFIRMED') NOT NULL DEFAULT 'NO_DIFF' AFTER `difference_confirmed_at`");

-- Sales order difference status summary.
CALL sp_add_column_if_missing('sales_orders', 'difference_status',
  "ENUM('NO_DIFF','PENDING_CONFIRM','CONFIRMED') NOT NULL DEFAULT 'NO_DIFF' AFTER `qty_diff_confirm_note`");

-- Ensure line allocation trace fields exist (for compatibility).
CALL sp_add_column_if_missing('sales_line_items', 'allocated_final_qty', 'DECIMAL(14,3) NULL AFTER `final_qty`');
CALL sp_add_column_if_missing('sales_line_items', 'allocation_version_id', 'BIGINT UNSIGNED NULL AFTER `allocated_final_qty`');

CALL sp_add_index_if_missing('weighing_slips', 'uk_weighing_slips_weighing_no', 'UNIQUE KEY `uk_weighing_slips_weighing_no` (`weighing_no`)');
CALL sp_add_index_if_missing('weighing_slips', 'idx_weighing_slips_diff_status',
  'KEY `idx_weighing_slips_diff_status` (`sales_order_id`, `difference_status`, `status`, `is_void`)');
CALL sp_add_index_if_missing('sales_orders', 'idx_sales_orders_difference_status',
  'KEY `idx_sales_orders_difference_status` (`status`, `ar_status`, `difference_status`, `is_void`)');

CALL sp_add_fk_if_missing('weighing_slips', 'fk_weighing_slips_difference_confirmed_by',
  'FOREIGN KEY (`difference_confirmed_by`) REFERENCES `users`(`id`)');

-- Backfill weighing fields.
UPDATE weighing_slips
   SET weighing_no = COALESCE(NULLIF(weighing_no, ''), slip_no)
 WHERE is_void = 0;

UPDATE weighing_slips
   SET attachments = CASE
       WHEN attachments IS NOT NULL THEN attachments
       WHEN voucher_url IS NOT NULL AND voucher_url <> '' THEN JSON_ARRAY(voucher_url)
       ELSE JSON_ARRAY()
     END
 WHERE is_void = 0;

UPDATE weighing_slips
   SET difference_status = CASE
       WHEN ABS(COALESCE(delta_qty, 0)) <= 0.0005 THEN 'NO_DIFF'
       WHEN status = 'CONFIRMED' THEN 'CONFIRMED'
       ELSE 'PENDING_CONFIRM'
     END,
       difference_confirmed = CASE
       WHEN ABS(COALESCE(delta_qty, 0)) <= 0.0005 THEN 1
       WHEN status = 'CONFIRMED' THEN 1
       ELSE 0
     END,
       difference_confirmed_by = CASE
       WHEN status = 'CONFIRMED' AND difference_confirmed_by IS NULL THEN confirmed_by
       ELSE difference_confirmed_by
     END,
       difference_confirmed_at = CASE
       WHEN status = 'CONFIRMED' AND difference_confirmed_at IS NULL THEN confirmed_at
       ELSE difference_confirmed_at
     END
 WHERE is_void = 0;

-- Backfill sales order difference summary using final_total_qty or latest slip qty.
UPDATE sales_orders so
LEFT JOIN (
  SELECT w1.sales_order_id, w1.final_total_qty
  FROM weighing_slips w1
  JOIN (
    SELECT sales_order_id, MAX(id) AS max_id
    FROM weighing_slips
    WHERE is_void = 0
    GROUP BY sales_order_id
  ) w2 ON w2.sales_order_id = w1.sales_order_id AND w2.max_id = w1.id
) ws ON ws.sales_order_id = so.id
   SET so.difference_status = CASE
     WHEN COALESCE(so.final_total_qty, ws.final_total_qty) IS NULL THEN 'NO_DIFF'
     WHEN ABS(COALESCE(so.final_total_qty, ws.final_total_qty) - COALESCE(so.planned_total_qty, 0)) <= 0.0005 THEN 'NO_DIFF'
     WHEN COALESCE(so.qty_diff_confirmed, 0) = 1 THEN 'CONFIRMED'
     ELSE 'PENDING_CONFIRM'
   END
 WHERE so.is_void = 0;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_017_phase_weighing_enhancement', 'Phase 017 weighing difference tracking and allocation traceability enhancement', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
