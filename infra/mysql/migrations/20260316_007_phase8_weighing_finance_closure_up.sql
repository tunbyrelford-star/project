-- Phase 8 migration: weighing slips + AR + irreversible payment closure
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
    WHERE table_schema = DATABASE() AND table_name = p_table
      AND constraint_name = p_fk_name AND constraint_type = 'FOREIGN KEY'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk_name, '` ', p_fk_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- Sales order finance confirmation governance.
CALL sp_add_column_if_missing('sales_orders', 'final_weighing_slip_id', "BIGINT UNSIGNED NULL AFTER `final_total_qty`");
CALL sp_add_column_if_missing('sales_orders', 'qty_diff_confirmed', "TINYINT(1) NOT NULL DEFAULT 0 AFTER `final_qty_confirmed_at`");
CALL sp_add_column_if_missing('sales_orders', 'qty_diff_confirmed_by', "BIGINT UNSIGNED NULL AFTER `qty_diff_confirmed`");
CALL sp_add_column_if_missing('sales_orders', 'qty_diff_confirmed_at', "DATETIME NULL AFTER `qty_diff_confirmed_by`");
CALL sp_add_column_if_missing('sales_orders', 'qty_diff_confirm_note', "VARCHAR(255) NULL AFTER `qty_diff_confirmed_at`");
CALL sp_add_column_if_missing('sales_orders', 'ar_confirmed_by', "BIGINT UNSIGNED NULL AFTER `qty_diff_confirm_note`");
CALL sp_add_column_if_missing('sales_orders', 'ar_confirmed_at', "DATETIME NULL AFTER `ar_confirmed_by`");

-- Weighing slip enrichments for finance traceability.
CALL sp_add_column_if_missing('weighing_slips', 'uploaded_by', "BIGINT UNSIGNED NULL AFTER `voucher_url`");
CALL sp_add_column_if_missing('weighing_slips', 'remark', "VARCHAR(255) NULL AFTER `uploaded_by`");

-- Payment reversal support (correction by offset only).
CALL sp_add_column_if_missing('payments', 'is_reversal', "TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_irreversible`");
CALL sp_add_column_if_missing('payments', 'reversal_of_payment_id', "BIGINT UNSIGNED NULL AFTER `is_reversal`");
CALL sp_add_column_if_missing('payments', 'reversal_reason', "VARCHAR(255) NULL AFTER `reversal_of_payment_id`");

CALL sp_add_index_if_missing(
  'sales_orders',
  'idx_sales_orders_finance_pending',
  'INDEX `idx_sales_orders_finance_pending` (`status`, `ar_status`, `is_void`, `updated_at`)'
);
CALL sp_add_index_if_missing(
  'weighing_slips',
  'idx_weighing_slips_order_status',
  'INDEX `idx_weighing_slips_order_status` (`sales_order_id`, `status`, `is_final`, `is_void`, `created_at`)'
);
CALL sp_add_index_if_missing(
  'payments',
  'idx_payments_order_status',
  'INDEX `idx_payments_order_status` (`sales_order_id`, `status`, `is_void`, `created_at`)'
);
CALL sp_add_index_if_missing(
  'payments',
  'uk_payments_reversal_of',
  'UNIQUE KEY `uk_payments_reversal_of` (`reversal_of_payment_id`)'
);

CALL sp_add_fk_if_missing(
  'payments',
  'fk_payments_reversal_of',
  'FOREIGN KEY (`reversal_of_payment_id`) REFERENCES `payments`(`id`)'
);
CALL sp_add_fk_if_missing(
  'sales_orders',
  'fk_sales_orders_final_slip',
  'FOREIGN KEY (`final_weighing_slip_id`) REFERENCES `weighing_slips`(`id`)'
);

DROP TRIGGER IF EXISTS trg_sales_orders_no_ar_revert;
DROP TRIGGER IF EXISTS trg_payments_reversal_guard_insert;

DELIMITER $$

CREATE TRIGGER trg_sales_orders_no_ar_revert
BEFORE UPDATE ON sales_orders
FOR EACH ROW
BEGIN
  IF OLD.ar_status = 'FINAL_AR' AND NEW.ar_status <> OLD.ar_status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINAL_AR cannot be reverted to ESTIMATED_AR.';
  END IF;

  IF OLD.final_total_qty IS NOT NULL
     AND NOT (NEW.final_total_qty <=> OLD.final_total_qty) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'final_total_qty is immutable after finance confirmation.';
  END IF;
END$$

CREATE TRIGGER trg_payments_reversal_guard_insert
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
  IF NEW.is_reversal = 1 AND NEW.reversal_of_payment_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reversal payment must reference original payment.';
  END IF;

  IF NEW.is_reversal = 0 AND NEW.reversal_of_payment_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Non-reversal payment cannot set reversal_of_payment_id.';
  END IF;

  IF NEW.is_reversal = 1 AND NEW.status <> 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reversal payment must be inserted as CONFIRMED.';
  END IF;

  IF NEW.is_reversal = 1 AND NEW.is_irreversible <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reversal payment must be irreversible.';
  END IF;
END$$

DELIMITER ;

-- Permission seeds for finance closure APIs.
INSERT INTO permissions (
  perm_code, perm_name, perm_scope, menu_path, api_method, api_path, field_key, mask_rule,
  resource, action, created_at, updated_at, is_void
)
VALUES
  ('API_FINANCE_PENDING_LIST', '财务待确认列表', 'API', NULL, 'GET', '/api/finance/orders/pending-confirm', NULL, 'NONE', 'ORDER', 'READ', NOW(), NOW(), 0),
  ('API_WEIGHING_SLIP_CREATE', '磅单录入', 'API', NULL, 'POST', '/api/finance/orders/:id/weighing-slips', NULL, 'NONE', 'WEIGHING', 'CREATE', NOW(), NOW(), 0),
  ('API_FINANCE_CONFIRM_AR', '财务确认应收', 'API', NULL, 'POST', '/api/finance/orders/:id/finance-confirm', NULL, 'NONE', 'AR', 'CONFIRM', NOW(), NOW(), 0),
  ('API_PAYMENT_CONFIRM_IRREVERSIBLE', '收款确认不可撤销', 'API', NULL, 'POST', '/api/finance/orders/:id/payments/confirm', NULL, 'NONE', 'PAYMENT', 'CONFIRM', NOW(), NOW(), 0),
  ('API_PAYMENT_REVERSE', '收款冲正', 'API', NULL, 'POST', '/api/finance/payments/:id/reverse', NULL, 'NONE', 'PAYMENT', 'REVERSE', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  perm_name = VALUES(perm_name),
  perm_scope = VALUES(perm_scope),
  api_method = VALUES(api_method),
  api_path = VALUES(api_path),
  resource = VALUES(resource),
  action = VALUES(action),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id, status, created_at, updated_at, is_void)
SELECT r.id, p.id, 'ACTIVE', NOW(), NOW(), 0
  FROM roles r
  JOIN permissions p ON p.perm_code IN (
    'API_FINANCE_PENDING_LIST',
    'API_WEIGHING_SLIP_CREATE',
    'API_FINANCE_CONFIRM_AR',
    'API_PAYMENT_CONFIRM_IRREVERSIBLE',
    'API_PAYMENT_REVERSE'
  )
 WHERE r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT', 'SALES')
   AND (
     p.perm_code IN ('API_FINANCE_PENDING_LIST', 'API_WEIGHING_SLIP_CREATE')
     OR r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT')
   )
ON DUPLICATE KEY UPDATE
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_007_phase8_weighing_finance_closure', 'Phase 8 weighing/AR/payment closure', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
