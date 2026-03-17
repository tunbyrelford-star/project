-- Phase 8 rollback (safe mode)
-- Date: 2026-03-16

USE sand_logistics;
SET NAMES utf8mb4;

UPDATE schema_migrations
SET rolled_back_at = NOW()
WHERE migration_key = '20260316_007_phase8_weighing_finance_closure'
  AND rolled_back_at IS NULL;

-- Safe rollback note:
-- This rollback only marks metadata and does not drop columns/tables/triggers.
-- To fully rollback, restore a database snapshot before phase 8.
