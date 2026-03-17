-- Phase 4 rollback (safe mode)
-- Date: 2026-03-16

USE sand_logistics;
SET NAMES utf8mb4;

UPDATE schema_migrations
SET rolled_back_at = NOW()
WHERE migration_key = '20260316_003_phase4_procurement_dispatch'
  AND rolled_back_at IS NULL;

-- Safe rollback note:
-- This rollback does not drop tables/columns to avoid data loss.
-- If full rollback is required, restore database snapshot from pre-migration backup.

