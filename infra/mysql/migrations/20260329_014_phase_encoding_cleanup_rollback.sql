-- Phase 014 rollback: restore text rows from backup tables
-- Date: 2026-03-29
-- Strategy: restore backups only, no table drop.

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

UPDATE ships s
JOIN text_fix_backup_ships_20260329 b
  ON b.ship_id = s.id
   SET s.ship_name = b.ship_name,
       s.owner_name = b.owner_name,
       s.common_ports = b.common_ports,
       s.updated_at = NOW();

UPDATE procurements p
JOIN text_fix_backup_procurements_20260329 b
  ON b.procurement_id = p.id
   SET p.buyer_name = b.buyer_name,
       p.issue_location = b.issue_location,
       p.product_type = b.product_type,
       p.procurement_type = b.procurement_type,
       p.source_description = b.source_description,
       p.updated_at = NOW();

UPDATE schema_migrations
   SET rolled_back_at = NOW()
 WHERE migration_key = '20260329_014_phase_encoding_cleanup'
   AND rolled_back_at IS NULL;

