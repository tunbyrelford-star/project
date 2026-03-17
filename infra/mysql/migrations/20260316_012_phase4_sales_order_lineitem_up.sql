-- Phase 4 migration: sales order + line item alignment
-- Date: 2026-03-16
-- Strategy: additive only, no table drop.

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

-- sales_orders: align required field naming
CALL sp_add_column_if_missing('sales_orders', 'order_no', 'VARCHAR(64) NULL AFTER sales_order_no');
CALL sp_add_index_if_missing('sales_orders', 'uk_sales_orders_order_no', 'UNIQUE KEY `uk_sales_orders_order_no` (`order_no`)');

-- sales_line_items: align required field naming
CALL sp_add_column_if_missing('sales_line_items', 'source_voyage_id', 'BIGINT UNSIGNED NULL AFTER voyage_id');
CALL sp_add_column_if_missing('sales_line_items', 'locked_qty', 'DECIMAL(14,3) NOT NULL DEFAULT 0.000 AFTER planned_qty');
CALL sp_add_column_if_missing('sales_line_items', 'allocated_final_qty', 'DECIMAL(14,3) NULL AFTER final_qty');
CALL sp_add_column_if_missing('sales_line_items', 'cost_amount', 'DECIMAL(14,2) NULL AFTER line_cost_amount');
CALL sp_add_column_if_missing('sales_line_items', 'revenue_amount', 'DECIMAL(14,2) NULL AFTER line_revenue_amount');
CALL sp_add_column_if_missing('sales_line_items', 'gross_profit', 'DECIMAL(14,2) GENERATED ALWAYS AS (COALESCE(revenue_amount, 0) - COALESCE(cost_amount, 0)) STORED');

CALL sp_add_index_if_missing('sales_line_items', 'idx_sales_line_items_source_voyage', 'KEY `idx_sales_line_items_source_voyage` (`source_voyage_id`)');
CALL sp_add_fk_if_missing('sales_line_items', 'fk_sales_line_items_source_voyage', 'FOREIGN KEY (`source_voyage_id`) REFERENCES `voyages` (`id`)');

-- Backfill for compatibility
UPDATE sales_orders
   SET order_no = sales_order_no
 WHERE order_no IS NULL
    OR TRIM(order_no) = '';

UPDATE sales_line_items
   SET source_voyage_id = voyage_id
 WHERE source_voyage_id IS NULL;

UPDATE sales_line_items
   SET locked_qty = planned_qty
 WHERE (locked_qty IS NULL OR locked_qty = 0)
   AND planned_qty > 0;

UPDATE sales_line_items
   SET allocated_final_qty = final_qty
 WHERE allocated_final_qty IS NULL
   AND final_qty IS NOT NULL;

UPDATE sales_line_items
   SET cost_amount = line_cost_amount
 WHERE cost_amount IS NULL
   AND line_cost_amount IS NOT NULL;

UPDATE sales_line_items
   SET revenue_amount = line_revenue_amount
 WHERE revenue_amount IS NULL
   AND line_revenue_amount IS NOT NULL;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_012_phase4_sales_order_lineitem_alignment', 'Phase 4 sales order + line item alignment', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
