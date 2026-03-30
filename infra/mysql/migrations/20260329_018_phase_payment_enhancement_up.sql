-- Phase 018 migration: payment confirmation idempotency + payment status summary
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

CALL sp_add_column_if_missing('payments', 'request_no', 'VARCHAR(64) NULL AFTER `payment_no`');
CALL sp_add_column_if_missing('sales_orders', 'payment_status', "ENUM('UNPAID','PARTIAL','CONFIRMED') NOT NULL DEFAULT 'UNPAID' AFTER `ar_status`");

CALL sp_add_index_if_missing('payments', 'uk_payments_request_no', 'UNIQUE KEY `uk_payments_request_no` (`request_no`)');
CALL sp_add_index_if_missing('payments', 'idx_payments_order_paid', 'KEY `idx_payments_order_paid` (`sales_order_id`, `status`, `is_reversal`, `is_void`, `confirmed_at`)');
CALL sp_add_index_if_missing('sales_orders', 'idx_sales_orders_payment_status', 'KEY `idx_sales_orders_payment_status` (`status`, `ar_status`, `payment_status`, `is_void`)');

UPDATE sales_orders so
LEFT JOIN (
  SELECT
    p.sales_order_id,
    COALESCE(SUM(CASE WHEN p.status = 'CONFIRMED' AND p.is_void = 0 AND p.is_reversal = 0 THEN p.payment_amount ELSE 0 END), 0) AS incoming_amount,
    COALESCE(SUM(CASE WHEN p.status = 'CONFIRMED' AND p.is_void = 0 AND p.is_reversal = 1 THEN p.payment_amount ELSE 0 END), 0) AS reversed_amount
  FROM payments p
  GROUP BY p.sales_order_id
) pay ON pay.sales_order_id = so.id
SET so.payment_status = CASE
  WHEN COALESCE(pay.incoming_amount, 0) - COALESCE(pay.reversed_amount, 0) <= 0 THEN 'UNPAID'
  WHEN so.total_amount IS NOT NULL
       AND so.total_amount > 0
       AND COALESCE(pay.incoming_amount, 0) - COALESCE(pay.reversed_amount, 0) >= so.total_amount THEN 'CONFIRMED'
  ELSE 'PARTIAL'
END
WHERE so.is_void = 0;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_018_phase_payment_enhancement', 'Phase 018 payment idempotency and payment status enhancement', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
