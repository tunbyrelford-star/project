-- Phase 016 migration: stock-in enhancement for confirmed quantity governance
-- Date: 2026-03-29
-- Strategy: additive only, no destructive DDL.

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
DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;

DELIMITER $$

CREATE PROCEDURE sp_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
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
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = p_table AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_index_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_fk_if_missing(
  IN p_table VARCHAR(64),
  IN p_fk_name VARCHAR(64),
  IN p_fk_ddl TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND constraint_name = p_fk_name
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk_name, '` ', p_fk_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL sp_add_column_if_missing('stock_ins', 'voyage_id', 'BIGINT UNSIGNED NULL AFTER `batch_id`');
CALL sp_add_column_if_missing('stock_ins', 'procurement_id', 'BIGINT UNSIGNED NULL AFTER `voyage_id`');
CALL sp_add_column_if_missing('stock_ins', 'before_qty', 'DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER `confirmed_qty`');
CALL sp_add_column_if_missing('stock_ins', 'after_qty', 'DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER `before_qty`');
CALL sp_add_column_if_missing('stock_ins', 'voucher_attachments', 'JSON NULL AFTER `evidence_urls`');
CALL sp_add_column_if_missing('stock_ins', 'operator_id', 'BIGINT UNSIGNED NULL AFTER `remark`');
CALL sp_add_column_if_missing('stock_ins', 'operator_name', 'VARCHAR(64) NULL AFTER `operator_id`');

CALL sp_add_column_if_missing('inventory_batches', 'stock_in_confirmed_at', 'DATETIME NULL AFTER `stock_in_confirmed`');
CALL sp_add_column_if_missing('inventory_batches', 'stock_in_confirmed_by', 'BIGINT UNSIGNED NULL AFTER `stock_in_confirmed_at`');
CALL sp_add_column_if_missing('inventory_batches', 'outbound_qty', 'DECIMAL(14,3) GENERATED ALWAYS AS (`shipped_qty`) STORED AFTER `shipped_qty`');

CALL sp_add_index_if_missing('stock_ins', 'idx_stock_ins_voyage_time', 'KEY `idx_stock_ins_voyage_time` (`voyage_id`, `stock_in_time`)');
CALL sp_add_index_if_missing('stock_ins', 'idx_stock_ins_procurement', 'KEY `idx_stock_ins_procurement` (`procurement_id`)');
CALL sp_add_index_if_missing('stock_ins', 'idx_stock_ins_operator', 'KEY `idx_stock_ins_operator` (`operator_id`)');
CALL sp_add_index_if_missing('inventory_batches', 'idx_inventory_batches_stockin_time', 'KEY `idx_inventory_batches_stockin_time` (`stock_in_confirmed`, `stock_in_confirmed_at`, `is_void`)');

CALL sp_add_fk_if_missing('stock_ins', 'fk_stock_ins_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages` (`id`)');
CALL sp_add_fk_if_missing('stock_ins', 'fk_stock_ins_procurement', 'FOREIGN KEY (`procurement_id`) REFERENCES `procurements` (`id`)');
CALL sp_add_fk_if_missing('stock_ins', 'fk_stock_ins_operator', 'FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`)');
CALL sp_add_fk_if_missing('inventory_batches', 'fk_inventory_batches_stockin_confirmed_by', 'FOREIGN KEY (`stock_in_confirmed_by`) REFERENCES `users` (`id`)');

UPDATE stock_ins si
JOIN inventory_batches b ON b.id = si.batch_id
JOIN voyages v ON v.id = b.voyage_id
   SET si.voyage_id = COALESCE(si.voyage_id, b.voyage_id),
       si.procurement_id = COALESCE(si.procurement_id, v.procurement_id)
 WHERE si.is_void = 0;

UPDATE stock_ins
   SET before_qty = COALESCE(before_qty, 0),
       after_qty = CASE WHEN after_qty = 0 THEN confirmed_qty ELSE after_qty END,
       operator_id = COALESCE(operator_id, confirmed_by),
       operator_name = COALESCE(NULLIF(operator_name, ''), CASE WHEN confirmed_by IS NULL THEN NULL ELSE CONCAT('User#', confirmed_by) END),
       voucher_attachments = COALESCE(voucher_attachments, evidence_urls)
 WHERE is_void = 0;

UPDATE inventory_batches b
JOIN (
  SELECT s.batch_id, s.stock_in_time, s.confirmed_by
  FROM stock_ins s
  JOIN (
    SELECT batch_id, MAX(version_no) AS max_version
    FROM stock_ins
    WHERE is_void = 0 AND status = 'CONFIRMED'
    GROUP BY batch_id
  ) mv ON mv.batch_id = s.batch_id AND mv.max_version = s.version_no
  WHERE s.is_void = 0
) latest ON latest.batch_id = b.id
   SET b.stock_in_confirmed_at = COALESCE(b.stock_in_confirmed_at, latest.stock_in_time),
       b.stock_in_confirmed_by = COALESCE(b.stock_in_confirmed_by, latest.confirmed_by)
 WHERE b.is_void = 0
   AND b.stock_in_confirmed = 1;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_016_phase_stockin_enhancement', 'Phase 016 stock-in enhancement and governance fields', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
