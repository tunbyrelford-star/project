-- Phase 6 rollback (safe mode)
-- Date: 2026-03-16

USE sand_logistics;
SET NAMES utf8mb4;

UPDATE schema_migrations
SET rolled_back_at = NOW()
WHERE migration_key = '20260316_005_phase6_onsite_workflow'
  AND rolled_back_at IS NULL;

-- Safe rollback note:
-- This rollback marks metadata only and does not remove data structures.
-- For full rollback, restore a pre-phase6 backup.
