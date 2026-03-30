-- Phase 014 migration: text encoding cleanup for historical mojibake rows
-- Date: 2026-03-29
-- Strategy: additive + reversible backup tables, no destructive drop.

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

CREATE TABLE IF NOT EXISTS text_fix_backup_ships_20260329 (
  ship_id BIGINT UNSIGNED NOT NULL,
  ship_name VARCHAR(128) NULL,
  owner_name VARCHAR(128) NULL,
  common_ports VARCHAR(512) NULL,
  backed_up_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ship_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS text_fix_backup_procurements_20260329 (
  procurement_id BIGINT UNSIGNED NOT NULL,
  buyer_name VARCHAR(128) NULL,
  issue_location VARCHAR(128) NULL,
  product_type VARCHAR(64) NULL,
  procurement_type VARCHAR(64) NULL,
  source_description VARCHAR(255) NULL,
  backed_up_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (procurement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO text_fix_backup_ships_20260329 (ship_id, ship_name, owner_name, common_ports)
SELECT s.id, s.ship_name, s.owner_name, s.common_ports
  FROM ships s
 WHERE s.ship_name LIKE '%?%'
    OR s.owner_name LIKE '%?%'
    OR s.common_ports LIKE '%?%'
ON DUPLICATE KEY UPDATE
  ship_name = VALUES(ship_name),
  owner_name = VALUES(owner_name),
  common_ports = VALUES(common_ports),
  backed_up_at = CURRENT_TIMESTAMP;

INSERT INTO text_fix_backup_procurements_20260329 (
  procurement_id, buyer_name, issue_location, product_type, procurement_type, source_description
)
SELECT p.id, p.buyer_name, p.issue_location, p.product_type, p.procurement_type, p.source_description
  FROM procurements p
 WHERE p.buyer_name LIKE '%?%'
    OR p.issue_location LIKE '%?%'
    OR p.product_type LIKE '%?%'
    OR p.procurement_type LIKE '%?%'
    OR p.source_description LIKE '%?%'
ON DUPLICATE KEY UPDATE
  buyer_name = VALUES(buyer_name),
  issue_location = VALUES(issue_location),
  product_type = VALUES(product_type),
  procurement_type = VALUES(procurement_type),
  source_description = VALUES(source_description),
  backed_up_at = CURRENT_TIMESTAMP;

UPDATE ships
   SET ship_name = CONCAT('船舶-', LPAD(id, 4, '0')),
       updated_at = NOW()
 WHERE ship_name LIKE '%?%';

UPDATE ships
   SET owner_name = NULL,
       updated_at = NOW()
 WHERE owner_name LIKE '%?%';

UPDATE ships
   SET common_ports = NULL,
       updated_at = NOW()
 WHERE common_ports LIKE '%?%';

UPDATE procurements p
LEFT JOIN buyer_accounts b
  ON b.id = p.supplier_id
 SET p.buyer_name = COALESCE(NULLIF(b.buyer_name, ''), CONCAT('供应商-', p.supplier_id), '供应商'),
     p.updated_at = NOW()
WHERE p.buyer_name LIKE '%?%';

UPDATE procurements
   SET issue_location = NULL,
       updated_at = NOW()
 WHERE issue_location LIKE '%?%';

UPDATE procurements
   SET product_type = NULL,
       updated_at = NOW()
 WHERE product_type LIKE '%?%';

UPDATE procurements
   SET procurement_type = NULL,
       updated_at = NOW()
 WHERE procurement_type LIKE '%?%';

UPDATE procurements
   SET source_description = NULL,
       updated_at = NOW()
 WHERE source_description LIKE '%?%';

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_014_phase_encoding_cleanup', 'Phase 014 encoding cleanup for corrupted text rows', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

