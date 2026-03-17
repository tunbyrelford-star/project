-- Phase 5 rollback (safe mode)
-- Date: 2026-03-16

USE sand_logistics;
SET NAMES utf8mb4;

UPDATE schema_migrations
SET rolled_back_at = NOW()
WHERE migration_key = '20260316_004_phase5_ship_position'
  AND rolled_back_at IS NULL;

-- Safe rollback note:
-- This rollback only marks migration metadata and does not drop tables/columns.
-- If full rollback is required, restore a database backup created before phase 5.
