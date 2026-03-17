-- Phase 9 migration: approval/version/audit/report governance
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

-- Approval details enhancement.
CALL sp_add_column_if_missing('approvals', 'attachment_urls', "JSON NULL AFTER `after_snapshot`");
CALL sp_add_column_if_missing('approvals', 'review_opinion', "ENUM('APPROVE','REJECT') NULL AFTER `reviewed_at`");
CALL sp_add_column_if_missing('approvals', 'review_comment', "VARCHAR(255) NULL AFTER `review_opinion`");
CALL sp_add_column_if_missing('approvals', 'review_attachment_urls', "JSON NULL AFTER `review_comment`");
CALL sp_add_column_if_missing('approvals', 'linked_version_type',
  "ENUM('SETTLEMENT_VERSION','ALLOCATION_VERSION') NULL AFTER `review_attachment_urls`");
CALL sp_add_column_if_missing('approvals', 'linked_version_id', "BIGINT UNSIGNED NULL AFTER `linked_version_type`");
CALL sp_add_column_if_missing('approvals', 'resolved_at', "DATETIME NULL AFTER `linked_version_id`");

CALL sp_add_index_if_missing(
  'approvals',
  'idx_approvals_status_type_time',
  'INDEX `idx_approvals_status_type_time` (`status`, `approval_type`, `requested_at`, `is_void`)'
);
CALL sp_add_index_if_missing(
  'approvals',
  'idx_approvals_target',
  'INDEX `idx_approvals_target` (`target_entity_type`, `target_entity_id`, `status`, `is_void`)'
);

-- Version and audit query acceleration.
CALL sp_add_index_if_missing(
  'settlement_versions',
  'idx_settlement_versions_voyage_status',
  'INDEX `idx_settlement_versions_voyage_status` (`voyage_id`, `version_no`, `status`, `is_void`)'
);
CALL sp_add_index_if_missing(
  'allocation_versions',
  'idx_allocation_versions_order_status',
  'INDEX `idx_allocation_versions_order_status` (`sales_order_id`, `version_no`, `status`, `is_void`)'
);
CALL sp_add_index_if_missing(
  'audit_logs',
  'idx_audit_logs_entity_time',
  'INDEX `idx_audit_logs_entity_time` (`entity_type`, `entity_id`, `event_time`, `is_void`)'
);

-- Business objects cannot be physically deleted; only void allowed.
DROP TRIGGER IF EXISTS trg_voyages_no_delete;
DROP TRIGGER IF EXISTS trg_inventory_batches_no_delete;
DROP TRIGGER IF EXISTS trg_sales_orders_no_delete;
DROP TRIGGER IF EXISTS trg_sales_line_items_no_delete;
DROP TRIGGER IF EXISTS trg_expenses_no_delete;
DROP TRIGGER IF EXISTS trg_stock_ins_no_delete;
DROP TRIGGER IF EXISTS trg_lighterings_no_delete;
DROP TRIGGER IF EXISTS trg_weighing_slips_no_delete;

DELIMITER $$

CREATE TRIGGER trg_voyages_no_delete
BEFORE DELETE ON voyages
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Voyage cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_inventory_batches_no_delete
BEFORE DELETE ON inventory_batches
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'InventoryBatch cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_sales_orders_no_delete
BEFORE DELETE ON sales_orders
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SalesOrder cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_sales_line_items_no_delete
BEFORE DELETE ON sales_line_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SalesLineItem cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_expenses_no_delete
BEFORE DELETE ON expenses
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expense cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_stock_ins_no_delete
BEFORE DELETE ON stock_ins
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'StockIn cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_lighterings_no_delete
BEFORE DELETE ON lighterings
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lightering cannot be physically deleted; use is_void.';
END$$

CREATE TRIGGER trg_weighing_slips_no_delete
BEFORE DELETE ON weighing_slips
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'WeighingSlip cannot be physically deleted; use is_void.';
END$$

DELIMITER ;

-- Permission seeds for governance module.
INSERT INTO permissions (
  perm_code, perm_name, perm_scope, menu_path, api_method, api_path, field_key, mask_rule,
  resource, action, created_at, updated_at, is_void
)
VALUES
  ('API_GOV_APPROVAL_LIST', '审批列表查询', 'API', NULL, 'GET', '/api/governance/approvals', NULL, 'NONE', 'APPROVAL', 'READ', NOW(), NOW(), 0),
  ('API_GOV_APPROVAL_DETAIL', '审批详情查询', 'API', NULL, 'GET', '/api/governance/approvals/:id', NULL, 'NONE', 'APPROVAL', 'READ', NOW(), NOW(), 0),
  ('API_GOV_APPROVAL_SUBMIT', '审批提交', 'API', NULL, 'POST', '/api/governance/approvals', NULL, 'NONE', 'APPROVAL', 'SUBMIT', NOW(), NOW(), 0),
  ('API_GOV_APPROVAL_REVIEW', '审批处理', 'API', NULL, 'POST', '/api/governance/approvals/:id/review', NULL, 'NONE', 'APPROVAL', 'REVIEW', NOW(), NOW(), 0),
  ('API_GOV_VERSION_LIST', '版本历史查询', 'API', NULL, 'GET', '/api/governance/versions', NULL, 'NONE', 'VERSION', 'READ', NOW(), NOW(), 0),
  ('API_GOV_AUDIT_LIST', '审计查询', 'API', NULL, 'GET', '/api/governance/audits', NULL, 'NONE', 'AUDIT', 'READ', NOW(), NOW(), 0),
  ('API_GOV_REPORT_PROFIT_TRACE', '利润追溯报表', 'API', NULL, 'GET', '/api/governance/reports/profit-trace', NULL, 'NONE', 'REPORT', 'READ', NOW(), NOW(), 0)
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
    'API_GOV_APPROVAL_LIST',
    'API_GOV_APPROVAL_DETAIL',
    'API_GOV_APPROVAL_SUBMIT',
    'API_GOV_APPROVAL_REVIEW',
    'API_GOV_VERSION_LIST',
    'API_GOV_AUDIT_LIST',
    'API_GOV_REPORT_PROFIT_TRACE'
  )
 WHERE (
    r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT')
    OR (
      r.role_code IN ('DISPATCHER', 'ONSITE_SPECIALIST', 'SALES')
      AND p.perm_code IN (
        'API_GOV_APPROVAL_LIST',
        'API_GOV_APPROVAL_DETAIL',
        'API_GOV_APPROVAL_SUBMIT',
        'API_GOV_VERSION_LIST',
        'API_GOV_AUDIT_LIST',
        'API_GOV_REPORT_PROFIT_TRACE'
      )
    )
  )
ON DUPLICATE KEY UPDATE
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_008_phase9_governance_approval_version_report', 'Phase 9 governance approval/version/audit/report', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
