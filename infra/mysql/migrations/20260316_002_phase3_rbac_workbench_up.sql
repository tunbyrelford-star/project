-- Phase 3 migration: RBAC scopes + role seeds + field-level policy
-- Date: 2026-03-16
-- Safe strategy: additive, non-destructive.

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
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = p_table
       AND column_name = p_column
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
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_table
       AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_index_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- Extend permissions for role/menu/api/field scopes.
CALL sp_add_column_if_missing('permissions', 'perm_scope',
  "ENUM('ROLE','MENU','API','FIELD','ACTION') NOT NULL DEFAULT 'ACTION' AFTER `perm_name`");
CALL sp_add_column_if_missing('permissions', 'menu_path',
  "VARCHAR(255) NULL AFTER `perm_scope`");
CALL sp_add_column_if_missing('permissions', 'api_method',
  "VARCHAR(16) NULL AFTER `menu_path`");
CALL sp_add_column_if_missing('permissions', 'api_path',
  "VARCHAR(255) NULL AFTER `api_method`");
CALL sp_add_column_if_missing('permissions', 'field_key',
  "VARCHAR(128) NULL AFTER `api_path`");
CALL sp_add_column_if_missing('permissions', 'mask_rule',
  "ENUM('NONE','MASK','HIDDEN') NOT NULL DEFAULT 'NONE' AFTER `field_key`");

CALL sp_add_index_if_missing('permissions', 'idx_permissions_scope',
  'INDEX `idx_permissions_scope` (`perm_scope`)');
CALL sp_add_index_if_missing('permissions', 'idx_permissions_menu_path',
  'INDEX `idx_permissions_menu_path` (`menu_path`)');
CALL sp_add_index_if_missing('permissions', 'idx_permissions_api',
  'INDEX `idx_permissions_api` (`api_method`, `api_path`)');
CALL sp_add_index_if_missing('permissions', 'idx_permissions_field_key',
  'INDEX `idx_permissions_field_key` (`field_key`)');

-- Field-level policy table (role + field visibility policy).
CREATE TABLE IF NOT EXISTS field_permission_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(128) NOT NULL,
  visibility ENUM('VISIBLE', 'MASKED', 'HIDDEN') NOT NULL,
  mask_pattern VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_field_permission_role_field (role_id, field_key),
  KEY idx_field_permission_field (field_key),
  KEY idx_field_permission_is_void (is_void),
  CONSTRAINT fk_field_permission_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_field_permission_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_field_permission_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed role list.
INSERT INTO roles (role_code, role_name, status, created_at, updated_at, is_void)
VALUES
  ('SUPER_ADMIN', '超级管理员', 'ACTIVE', NOW(), NOW(), 0),
  ('DISPATCHER', '采购/调度员', 'ACTIVE', NOW(), NOW(), 0),
  ('ONSITE_SPECIALIST', '现场/过驳专员', 'ACTIVE', NOW(), NOW(), 0),
  ('SALES', '销售经理/销售员', 'ACTIVE', NOW(), NOW(), 0),
  ('FINANCE_MGMT', '财务/管理层', 'ACTIVE', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

-- Seed permission codes (menu/api/field/action).
INSERT INTO permissions (
  perm_code, perm_name, perm_scope, resource, action,
  menu_path, api_method, api_path, field_key, mask_rule,
  created_at, updated_at, is_void
)
VALUES
  ('MENU_WORKBENCH', '工作台菜单', 'MENU', 'MENU', 'VIEW', '/pages/index/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_PROCUREMENT', '采购调度菜单', 'MENU', 'MENU', 'VIEW', '/pkg_dispatch/pages/procurement/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_SHIP_POSITION', '船舶定位菜单', 'MENU', 'MENU', 'VIEW', '/pkg_dispatch/pages/ship/position/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_LIGHTERING', '过驳作业菜单', 'MENU', 'MENU', 'VIEW', '/pkg_onsite/pages/lightering/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_STOCK_IN', '入库确认菜单', 'MENU', 'MENU', 'VIEW', '/pkg_stock/pages/stockin/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_EXPENSE', '费用录入菜单', 'MENU', 'MENU', 'VIEW', '/pkg_onsite/pages/expense/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_SALES', '销售菜单', 'MENU', 'MENU', 'VIEW', '/pages/sales/order/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_FINANCE', '财务菜单', 'MENU', 'MENU', 'VIEW', '/pkg_finance/pages/ar/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_APPROVAL', '审批菜单', 'MENU', 'MENU', 'VIEW', '/pkg_finance/pages/approval/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('MENU_AUDIT', '审计菜单', 'MENU', 'MENU', 'VIEW', '/pkg_ops/pages/audit/list/index', NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),

  ('API_WORKBENCH_AGGREGATE', '工作台聚合接口', 'API', 'API', 'GET', NULL, 'GET', '/api/workbench/aggregate', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_PROCUREMENT_LIST', '采购单列表接口', 'API', 'API', 'GET', NULL, 'GET', '/api/procurements', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_PROCUREMENT_UPDATE', '采购单编辑接口', 'API', 'API', 'PUT', NULL, 'PUT', '/api/procurements/{id}', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_SHIP_POSITION', '船舶定位接口', 'API', 'API', 'GET', NULL, 'GET', '/api/ships/{id}/position', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_LIGHTERING_CONFIRM', '卸空确认接口', 'API', 'API', 'POST', NULL, 'POST', '/api/lighterings/{id}/confirm-empty', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_STOCKIN_CONFIRM', '入库确认接口', 'API', 'API', 'POST', NULL, 'POST', '/api/stock-ins/confirm', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_EXPENSE_SAVE', '费用录入接口', 'API', 'API', 'POST', NULL, 'POST', '/api/expenses', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_SALES_CREATE', '销售建单接口', 'API', 'API', 'POST', NULL, 'POST', '/api/sales-orders', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_WEIGHING_UPLOAD', '磅单上传接口', 'API', 'API', 'POST', NULL, 'POST', '/api/weighing-slips', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_PAYMENT_CONFIRM', '确认收款接口', 'API', 'API', 'POST', NULL, 'POST', '/api/payments/confirm', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_APPROVAL_REVIEW', '审批审核接口', 'API', 'API', 'POST', NULL, 'POST', '/api/approvals/{id}/review', NULL, 'NONE', NOW(), NOW(), 0),
  ('API_AUDIT_READ', '审计日志查询接口', 'API', 'API', 'GET', NULL, 'GET', '/api/audit-logs', NULL, 'NONE', NOW(), NOW(), 0),

  ('FIELD_PROCUREMENT_UNIT_PRICE_VIEW', '采购单价可见', 'FIELD', 'FIELD', 'VIEW', NULL, NULL, NULL, 'procurement.unit_price', 'NONE', NOW(), NOW(), 0),
  ('FIELD_PROCUREMENT_TOTAL_AMOUNT_VIEW', '采购总额可见', 'FIELD', 'FIELD', 'VIEW', NULL, NULL, NULL, 'procurement.total_amount', 'NONE', NOW(), NOW(), 0),
  ('FIELD_VOYAGE_COST_VIEW', '成本可见', 'FIELD', 'FIELD', 'VIEW', NULL, NULL, NULL, 'voyage.cost_amount', 'NONE', NOW(), NOW(), 0),
  ('FIELD_VOYAGE_PROFIT_VIEW', '利润可见', 'FIELD', 'FIELD', 'VIEW', NULL, NULL, NULL, 'voyage.profit_amount', 'NONE', NOW(), NOW(), 0),

  ('ACTION_PAYMENT_CONFIRM', '确认收款操作', 'ACTION', 'PAYMENT', 'CONFIRM', NULL, NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL', '锁定态变更提交审批', 'ACTION', 'LOCKED_CHANGE', 'SUBMIT_APPROVAL', NULL, NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0),
  ('ACTION_APPROVAL_REVIEW', '审批审核操作', 'ACTION', 'APPROVAL', 'REVIEW', NULL, NULL, NULL, NULL, 'NONE', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  perm_name = VALUES(perm_name),
  perm_scope = VALUES(perm_scope),
  resource = VALUES(resource),
  action = VALUES(action),
  menu_path = VALUES(menu_path),
  api_method = VALUES(api_method),
  api_path = VALUES(api_path),
  field_key = VALUES(field_key),
  mask_rule = VALUES(mask_rule),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

-- Clear only previous active mappings for controlled roles to avoid duplicates.
UPDATE role_permissions rp
JOIN roles r ON r.id = rp.role_id
SET rp.is_void = 1,
    rp.void_reason = 'phase3 reseed',
    rp.void_at = NOW(),
    rp.updated_at = NOW()
WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
  AND rp.is_void = 0;

-- Seed role-permission mapping.
INSERT INTO role_permissions (role_id, permission_id, status, created_at, updated_at, is_void)
SELECT r.id, p.id, 'ACTIVE', NOW(), NOW(), 0
  FROM roles r
  JOIN permissions p
    ON (
      r.role_code = 'SUPER_ADMIN'
      AND p.perm_code IN (
        'MENU_WORKBENCH','MENU_PROCUREMENT','MENU_SHIP_POSITION','MENU_LIGHTERING','MENU_STOCK_IN',
        'MENU_EXPENSE','MENU_SALES','MENU_FINANCE','MENU_APPROVAL','MENU_AUDIT',
        'API_WORKBENCH_AGGREGATE','API_PROCUREMENT_LIST','API_PROCUREMENT_UPDATE','API_SHIP_POSITION',
        'API_LIGHTERING_CONFIRM','API_STOCKIN_CONFIRM','API_EXPENSE_SAVE','API_SALES_CREATE',
        'API_WEIGHING_UPLOAD','API_PAYMENT_CONFIRM','API_APPROVAL_REVIEW','API_AUDIT_READ',
        'FIELD_PROCUREMENT_UNIT_PRICE_VIEW','FIELD_PROCUREMENT_TOTAL_AMOUNT_VIEW',
        'FIELD_VOYAGE_COST_VIEW','FIELD_VOYAGE_PROFIT_VIEW',
        'ACTION_PAYMENT_CONFIRM','ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL','ACTION_APPROVAL_REVIEW'
      )
    )
    OR (
      r.role_code = 'DISPATCHER'
      AND p.perm_code IN (
        'MENU_WORKBENCH','MENU_PROCUREMENT','MENU_SHIP_POSITION',
        'API_WORKBENCH_AGGREGATE','API_PROCUREMENT_LIST','API_PROCUREMENT_UPDATE','API_SHIP_POSITION',
        'ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL'
      )
    )
    OR (
      r.role_code = 'ONSITE_SPECIALIST'
      AND p.perm_code IN (
        'MENU_WORKBENCH','MENU_LIGHTERING','MENU_STOCK_IN','MENU_EXPENSE',
        'API_WORKBENCH_AGGREGATE','API_LIGHTERING_CONFIRM','API_STOCKIN_CONFIRM','API_EXPENSE_SAVE',
        'ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL'
      )
    )
    OR (
      r.role_code = 'SALES'
      AND p.perm_code IN (
        'MENU_WORKBENCH','MENU_SALES',
        'API_WORKBENCH_AGGREGATE','API_SALES_CREATE','API_WEIGHING_UPLOAD'
      )
    )
    OR (
      r.role_code = 'FINANCE_MGMT'
      AND p.perm_code IN (
        'MENU_WORKBENCH','MENU_FINANCE','MENU_APPROVAL','MENU_AUDIT',
        'API_WORKBENCH_AGGREGATE','API_PAYMENT_CONFIRM','API_APPROVAL_REVIEW','API_AUDIT_READ',
        'FIELD_PROCUREMENT_UNIT_PRICE_VIEW','FIELD_PROCUREMENT_TOTAL_AMOUNT_VIEW',
        'FIELD_VOYAGE_COST_VIEW','FIELD_VOYAGE_PROFIT_VIEW',
        'ACTION_PAYMENT_CONFIRM','ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL','ACTION_APPROVAL_REVIEW'
      )
    )
ON DUPLICATE KEY UPDATE
  status = 'ACTIVE',
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

-- Field-level policies:
-- Sensitive fields are visible only to FINANCE_MGMT and SUPER_ADMIN.
INSERT INTO field_permission_policies (
  role_id, field_key, visibility, mask_pattern, created_at, updated_at, is_void
)
SELECT r.id, f.field_key,
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT') THEN 'VISIBLE' ELSE 'MASKED' END AS visibility,
       CASE WHEN r.role_code IN ('SUPER_ADMIN', 'FINANCE_MGMT') THEN NULL ELSE '***' END AS mask_pattern,
       NOW(), NOW(), 0
  FROM roles r
 CROSS JOIN (
   SELECT 'procurement.unit_price' AS field_key
   UNION ALL SELECT 'procurement.total_amount'
   UNION ALL SELECT 'voyage.cost_amount'
   UNION ALL SELECT 'voyage.profit_amount'
 ) f
 WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
ON DUPLICATE KEY UPDATE
  visibility = VALUES(visibility),
  mask_pattern = VALUES(mask_pattern),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL,
  updated_at = NOW();

-- Keep audit log immutability explicit.
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete_phase3;

DELIMITER $$
CREATE TRIGGER trg_audit_logs_no_delete_phase3
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Audit logs cannot be deleted.';
END$$
DELIMITER ;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_002_phase3_rbac_workbench', 'Phase 3 RBAC model and role seeds', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;

