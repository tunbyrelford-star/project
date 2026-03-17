-- Phase 6 migration: onsite workflow (lightering, empty-confirm, stock-in, expense)
-- Date: 2026-03-16
-- Strategy: additive with guard triggers, no DROP TABLE.

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

-- Add practical fields for onsite operations.
CALL sp_add_column_if_missing('lighterings', 'empty_confirm_note', 'VARCHAR(255) NULL AFTER `confirmed_at`');
CALL sp_add_column_if_missing('stock_ins', 'remark', 'VARCHAR(255) NULL AFTER `evidence_urls`');
CALL sp_add_column_if_missing('expenses', 'source_module', "VARCHAR(64) NOT NULL DEFAULT 'ONSITE' AFTER `status`");

-- Query acceleration for onsite todo and aggregation.
CALL sp_add_index_if_missing('lighterings', 'idx_lighterings_status_voyage_void',
  'INDEX `idx_lighterings_status_voyage_void` (`status`, `voyage_id`, `is_void`)');
CALL sp_add_index_if_missing('inventory_batches', 'idx_inventory_batches_stockin_status_voyage_void',
  'INDEX `idx_inventory_batches_stockin_status_voyage_void` (`stock_in_confirmed`, `status`, `voyage_id`, `is_void`)');
CALL sp_add_index_if_missing('expenses', 'idx_expenses_voyage_status_time_void',
  'INDEX `idx_expenses_voyage_status_time_void` (`voyage_id`, `status`, `occurred_at`, `is_void`)');

-- Permission seed for expense sensitive field (idempotent).
INSERT INTO permissions (
  perm_code, perm_name, perm_scope, resource, action, field_key, mask_rule,
  created_at, updated_at, is_void
)
VALUES
  ('FIELD_EXPENSE_AMOUNT_VIEW', '费用金额可见', 'FIELD', 'FIELD', 'VIEW', 'expense.amount', 'NONE', NOW(), NOW(), 0)
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
  JOIN permissions p ON p.perm_code = 'FIELD_EXPENSE_AMOUNT_VIEW'
 WHERE r.role_code IN ('SUPER_ADMIN', 'ONSITE_SPECIALIST', 'FINANCE_MGMT')
ON DUPLICATE KEY UPDATE
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO field_permission_policies (
  role_id, field_key, visibility, mask_pattern, created_at, updated_at, is_void
)
SELECT r.id, 'expense.amount',
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'ONSITE_SPECIALIST', 'FINANCE_MGMT') THEN 'VISIBLE' ELSE 'MASKED' END,
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'ONSITE_SPECIALIST', 'FINANCE_MGMT') THEN NULL ELSE '***' END,
       NOW(), NOW(), 0
  FROM roles r
 WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
ON DUPLICATE KEY UPDATE
  visibility = VALUES(visibility),
  mask_pattern = VALUES(mask_pattern),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

-- Guard trigger: Batch must be stock-in confirmed before sales allocation.
DROP TRIGGER IF EXISTS trg_sales_line_items_require_stock_in_insert;
DROP TRIGGER IF EXISTS trg_sales_line_items_require_stock_in_update;

-- Guard trigger: Locked voyage cannot directly modify expense/tonnage/ownership.
DROP TRIGGER IF EXISTS trg_expenses_locked_guard_update;
DROP TRIGGER IF EXISTS trg_expenses_locked_guard_delete;
DROP TRIGGER IF EXISTS trg_stock_ins_locked_guard_update;
DROP TRIGGER IF EXISTS trg_sales_line_items_locked_guard_update;

-- Ensure settlement v1 remains cost snapshot (revenue = 0).
DROP TRIGGER IF EXISTS trg_settlement_v1_no_revenue;

DELIMITER $$

CREATE TRIGGER trg_sales_line_items_require_stock_in_insert
BEFORE INSERT ON sales_line_items
FOR EACH ROW
BEGIN
  DECLARE v_stock_in_confirmed TINYINT;
  DECLARE v_batch_status VARCHAR(64);

  SELECT stock_in_confirmed, status
    INTO v_stock_in_confirmed, v_batch_status
    FROM inventory_batches
   WHERE id = NEW.batch_id
     AND is_void = 0
   LIMIT 1;

  IF v_stock_in_confirmed IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Batch not found.';
  END IF;

  IF v_stock_in_confirmed <> 1 OR v_batch_status = 'PENDING_STOCK_IN' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unstocked batch cannot be sold.';
  END IF;
END$$

CREATE TRIGGER trg_sales_line_items_require_stock_in_update
BEFORE UPDATE ON sales_line_items
FOR EACH ROW
BEGIN
  DECLARE v_stock_in_confirmed TINYINT;
  DECLARE v_batch_status VARCHAR(64);

  IF NEW.batch_id <> OLD.batch_id THEN
    SELECT stock_in_confirmed, status
      INTO v_stock_in_confirmed, v_batch_status
      FROM inventory_batches
     WHERE id = NEW.batch_id
       AND is_void = 0
     LIMIT 1;

    IF v_stock_in_confirmed IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Batch not found.';
    END IF;

    IF v_stock_in_confirmed <> 1 OR v_batch_status = 'PENDING_STOCK_IN' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unstocked batch cannot be sold.';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_expenses_locked_guard_update
BEFORE UPDATE ON expenses
FOR EACH ROW
BEGIN
  DECLARE v_voyage_status VARCHAR(32);

  SELECT status INTO v_voyage_status
    FROM voyages
   WHERE id = OLD.voyage_id
     AND is_void = 0
   LIMIT 1;

  IF v_voyage_status = 'LOCKED'
     AND COALESCE(@allow_locked_change_with_approval, 0) = 0
     AND (
       NEW.amount <> OLD.amount
       OR NEW.expense_type <> OLD.expense_type
       OR NEW.voyage_id <> OLD.voyage_id
       OR NEW.occurred_at <> OLD.occurred_at
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Locked voyage expense change requires approval and version revision.';
  END IF;
END$$

CREATE TRIGGER trg_expenses_locked_guard_delete
BEFORE DELETE ON expenses
FOR EACH ROW
BEGIN
  DECLARE v_voyage_status VARCHAR(32);

  SELECT status INTO v_voyage_status
    FROM voyages
   WHERE id = OLD.voyage_id
     AND is_void = 0
   LIMIT 1;

  IF v_voyage_status = 'LOCKED'
     AND COALESCE(@allow_locked_change_with_approval, 0) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Locked voyage expense delete requires approval and version revision.';
  END IF;
END$$

CREATE TRIGGER trg_stock_ins_locked_guard_update
BEFORE UPDATE ON stock_ins
FOR EACH ROW
BEGIN
  DECLARE v_voyage_status VARCHAR(32);

  SELECT v.status INTO v_voyage_status
    FROM inventory_batches b
    JOIN voyages v ON v.id = b.voyage_id
   WHERE b.id = OLD.batch_id
     AND b.is_void = 0
     AND v.is_void = 0
   LIMIT 1;

  IF v_voyage_status = 'LOCKED'
     AND COALESCE(@allow_locked_change_with_approval, 0) = 0
     AND (
       NEW.confirmed_qty <> OLD.confirmed_qty
       OR NEW.stock_in_time <> OLD.stock_in_time
       OR NEW.batch_id <> OLD.batch_id
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Locked voyage tonnage change requires approval and version revision.';
  END IF;
END$$

CREATE TRIGGER trg_sales_line_items_locked_guard_update
BEFORE UPDATE ON sales_line_items
FOR EACH ROW
BEGIN
  DECLARE v_voyage_status VARCHAR(32);

  SELECT status INTO v_voyage_status
    FROM voyages
   WHERE id = OLD.voyage_id
     AND is_void = 0
   LIMIT 1;

  IF v_voyage_status = 'LOCKED'
     AND COALESCE(@allow_locked_change_with_approval, 0) = 0
     AND (
       NEW.batch_id <> OLD.batch_id
       OR NEW.voyage_id <> OLD.voyage_id
       OR NEW.planned_qty <> OLD.planned_qty
       OR COALESCE(NEW.final_qty, -1) <> COALESCE(OLD.final_qty, -1)
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Locked voyage ownership or tonnage change requires approval and version revision.';
  END IF;
END$$

CREATE TRIGGER trg_settlement_v1_no_revenue
BEFORE INSERT ON settlement_versions
FOR EACH ROW
BEGIN
  IF NEW.version_no = 1 THEN
    SET NEW.snapshot_type = 'COST_SNAPSHOT';
    SET NEW.revenue_amount = 0;
  END IF;
END$$

DELIMITER ;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_005_phase6_onsite_workflow', 'Phase 6 onsite workflow schema and guards', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
