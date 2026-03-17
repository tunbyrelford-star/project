-- Phase 7 migration: sales module (batch selection + source attribution)
-- Date: 2026-03-16
-- Strategy: additive, non-destructive.

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

-- Sales order enhancement.
CALL sp_add_column_if_missing('sales_orders', 'pricing_mode',
  "ENUM('PER_ORDER_UNIT_PRICE','PER_LINE_UNIT_PRICE') NOT NULL DEFAULT 'PER_ORDER_UNIT_PRICE' AFTER `unit_price`");
CALL sp_add_column_if_missing('sales_orders', 'locked_stock_at', "DATETIME NULL AFTER `updated_by`");

-- Sales line attribution and no-average accounting fields.
CALL sp_add_column_if_missing('sales_line_items', 'source_procurement_unit_cost',
  "DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `planned_qty`");
CALL sp_add_column_if_missing('sales_line_items', 'source_expense_unit_cost',
  "DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `source_procurement_unit_cost`");
CALL sp_add_column_if_missing('sales_line_items', 'line_unit_price',
  "DECIMAL(14,2) NULL AFTER `source_expense_unit_cost`");
CALL sp_add_column_if_missing('sales_line_items', 'line_revenue_amount',
  "DECIMAL(14,2) NULL AFTER `line_unit_price`");
CALL sp_add_column_if_missing('sales_line_items', 'line_cost_amount',
  "DECIMAL(14,2) NULL AFTER `line_revenue_amount`");
CALL sp_add_column_if_missing('sales_line_items', 'line_profit_amount',
  "DECIMAL(14,2) GENERATED ALWAYS AS (COALESCE(line_revenue_amount, 0) - COALESCE(line_cost_amount, 0)) STORED");
CALL sp_add_column_if_missing('sales_line_items', 'line_source_note',
  "VARCHAR(255) NULL AFTER `line_cost_amount`");

CALL sp_add_index_if_missing('sales_orders', 'idx_sales_orders_status_created',
  'INDEX `idx_sales_orders_status_created` (`status`, `created_at`, `is_void`)');
CALL sp_add_index_if_missing('sales_line_items', 'idx_sales_line_items_batch_voyage',
  'INDEX `idx_sales_line_items_batch_voyage` (`batch_id`, `voyage_id`, `status`, `is_void`)');
CALL sp_add_index_if_missing('inventory_batches', 'idx_inventory_batches_sellable',
  'INDEX `idx_inventory_batches_sellable` (`stock_in_confirmed`, `status`, `remaining_qty`, `is_void`)');

-- Guard locked_qty update to prevent over-locking.
DROP TRIGGER IF EXISTS trg_inventory_batches_guard_locked_qty;

DELIMITER $$
CREATE TRIGGER trg_inventory_batches_guard_locked_qty
BEFORE UPDATE ON inventory_batches
FOR EACH ROW
BEGIN
  IF NEW.locked_qty < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'locked_qty cannot be negative.';
  END IF;

  IF NEW.locked_qty > (OLD.available_qty - OLD.shipped_qty) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'locked_qty exceeds sellable quantity.';
  END IF;
END$$
DELIMITER ;

-- Field permission for line-level cost/profit visibility.
INSERT INTO permissions (
  perm_code, perm_name, perm_scope, resource, action,
  field_key, mask_rule, created_at, updated_at, is_void
)
VALUES
  ('FIELD_SALES_LINE_COST_VIEW', '销售行成本可见', 'FIELD', 'FIELD', 'VIEW', 'sales_line_item.line_cost_amount', 'NONE', NOW(), NOW(), 0),
  ('FIELD_SALES_LINE_PROFIT_VIEW', '销售行利润可见', 'FIELD', 'FIELD', 'VIEW', 'sales_line_item.line_profit_amount', 'NONE', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  perm_name = VALUES(perm_name),
  perm_scope = VALUES(perm_scope),
  field_key = VALUES(field_key),
  mask_rule = VALUES(mask_rule),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id, status, created_at, updated_at, is_void)
SELECT r.id, p.id, 'ACTIVE', NOW(), NOW(), 0
  FROM roles r
  JOIN permissions p
    ON p.perm_code IN ('FIELD_SALES_LINE_COST_VIEW', 'FIELD_SALES_LINE_PROFIT_VIEW')
 WHERE r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT')
ON DUPLICATE KEY UPDATE
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO field_permission_policies (
  role_id, field_key, visibility, mask_pattern, created_at, updated_at, is_void
)
SELECT r.id, x.field_key,
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT') THEN 'VISIBLE' ELSE 'MASKED' END AS visibility,
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT') THEN NULL ELSE '***' END AS mask_pattern,
       NOW(), NOW(), 0
  FROM roles r
 CROSS JOIN (
   SELECT 'sales_line_item.line_cost_amount' AS field_key
   UNION ALL SELECT 'sales_line_item.line_profit_amount'
 ) x
 WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
ON DUPLICATE KEY UPDATE
  visibility = VALUES(visibility),
  mask_pattern = VALUES(mask_pattern),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_006_phase7_sales_batch_allocation', 'Phase 7 sales batch allocation and attribution', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
