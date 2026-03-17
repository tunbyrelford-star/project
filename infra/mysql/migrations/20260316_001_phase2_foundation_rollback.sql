-- Phase 2 safe rollback (application compatibility rollback)
-- Important:
-- 1) This script does NOT drop business tables (safe mode).
-- 2) Use backup restore for full physical rollback.

USE sand_logistics;
SET NAMES utf8mb4;

DROP TRIGGER IF EXISTS trg_inventory_batches_guard_available_qty;
DROP TRIGGER IF EXISTS trg_stock_ins_apply_on_insert;
DROP TRIGGER IF EXISTS trg_stock_ins_apply_on_update;
DROP TRIGGER IF EXISTS trg_payments_no_revert_confirmed;
DROP TRIGGER IF EXISTS trg_payments_no_delete_confirmed;
DROP TRIGGER IF EXISTS trg_settlement_versions_readonly_update;
DROP TRIGGER IF EXISTS trg_settlement_versions_readonly_delete;
DROP TRIGGER IF EXISTS trg_allocation_versions_readonly_update;
DROP TRIGGER IF EXISTS trg_allocation_versions_readonly_delete;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;

UPDATE schema_migrations
   SET rolled_back_at = NOW()
 WHERE migration_key = '20260316_001_phase2_foundation'
   AND rolled_back_at IS NULL;

-- Full rollback guidance:
-- 1) Stop writes.
-- 2) Restore pre-migration backup (mysqldump or storage snapshot).
-- 3) Re-apply only previous approved migration set.

