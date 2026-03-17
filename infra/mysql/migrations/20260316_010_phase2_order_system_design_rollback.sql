-- Phase 2 rollback (safe mode): order system design foundation
-- Date: 2026-03-16
-- Strategy: metadata rollback only, keep business data.

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

UPDATE schema_migrations
   SET rolled_back_at = NOW()
 WHERE migration_key = '20260316_010_phase2_order_system_design'
   AND rolled_back_at IS NULL;
