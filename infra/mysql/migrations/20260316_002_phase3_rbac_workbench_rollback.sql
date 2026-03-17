-- Phase 3 rollback (safe mode, non-destructive)
-- Date: 2026-03-16

USE sand_logistics;
SET NAMES utf8mb4;

-- Disable phase 3 trigger only.
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete_phase3;

-- Soft rollback for seeded permissions and mappings.
UPDATE role_permissions rp
JOIN roles r ON r.id = rp.role_id
SET rp.is_void = 1,
    rp.void_reason = 'phase3 rollback',
    rp.void_at = NOW(),
    rp.updated_at = NOW()
WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
  AND rp.is_void = 0;

UPDATE permissions
SET is_void = 1,
    void_reason = 'phase3 rollback',
    void_at = NOW(),
    updated_at = NOW()
WHERE perm_code IN (
  'MENU_WORKBENCH','MENU_PROCUREMENT','MENU_SHIP_POSITION','MENU_LIGHTERING','MENU_STOCK_IN',
  'MENU_EXPENSE','MENU_SALES','MENU_FINANCE','MENU_APPROVAL','MENU_AUDIT',
  'API_WORKBENCH_AGGREGATE','API_PROCUREMENT_LIST','API_PROCUREMENT_UPDATE','API_SHIP_POSITION',
  'API_LIGHTERING_CONFIRM','API_STOCKIN_CONFIRM','API_EXPENSE_SAVE','API_SALES_CREATE',
  'API_WEIGHING_UPLOAD','API_PAYMENT_CONFIRM','API_APPROVAL_REVIEW','API_AUDIT_READ',
  'FIELD_PROCUREMENT_UNIT_PRICE_VIEW','FIELD_PROCUREMENT_TOTAL_AMOUNT_VIEW',
  'FIELD_VOYAGE_COST_VIEW','FIELD_VOYAGE_PROFIT_VIEW',
  'ACTION_PAYMENT_CONFIRM','ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL','ACTION_APPROVAL_REVIEW'
);

UPDATE field_permission_policies fpp
JOIN roles r ON r.id = fpp.role_id
SET fpp.is_void = 1,
    fpp.void_reason = 'phase3 rollback',
    fpp.void_at = NOW(),
    fpp.updated_at = NOW()
WHERE r.role_code IN ('SUPER_ADMIN', 'DISPATCHER', 'ONSITE_SPECIALIST', 'SALES', 'FINANCE_MGMT')
  AND fpp.is_void = 0;

UPDATE schema_migrations
SET rolled_back_at = NOW()
WHERE migration_key = '20260316_002_phase3_rbac_workbench'
  AND rolled_back_at IS NULL;

