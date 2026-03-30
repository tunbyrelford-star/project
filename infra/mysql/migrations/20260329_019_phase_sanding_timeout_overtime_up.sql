-- Phase 019 migration: sanding overtime handling closure (expense linkage + traceability)
-- Date: 2026-03-29
-- Strategy: additive, non-destructive.

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

CALL sp_add_column_if_missing('expenses', 'procurement_id', 'BIGINT UNSIGNED NULL AFTER `voyage_id`');
CALL sp_add_column_if_missing('expenses', 'source_alert_id', 'BIGINT UNSIGNED NULL AFTER `procurement_id`');
CALL sp_add_column_if_missing('expenses', 'overtime_minutes', 'INT UNSIGNED NULL AFTER `amount`');
CALL sp_add_column_if_missing('expenses', 'overtime_hours', 'DECIMAL(10,2) NULL AFTER `overtime_minutes`');
CALL sp_add_column_if_missing('expenses', 'overtime_rate', 'DECIMAL(14,2) NULL AFTER `overtime_hours`');
CALL sp_add_column_if_missing('expenses', 'calculation_formula', 'VARCHAR(255) NULL AFTER `overtime_rate`');
CALL sp_add_column_if_missing('expenses', 'calculation_note', 'VARCHAR(500) NULL AFTER `calculation_formula`');
CALL sp_add_column_if_missing('expenses', 'remark', 'VARCHAR(255) NULL AFTER `calculation_note`');

CALL sp_add_index_if_missing('expenses', 'idx_expenses_procurement', 'KEY `idx_expenses_procurement` (`procurement_id`)');
CALL sp_add_index_if_missing('expenses', 'idx_expenses_source_alert', 'KEY `idx_expenses_source_alert` (`source_alert_id`)');
CALL sp_add_index_if_missing('expenses', 'uk_expenses_overtime_alert_once',
  'UNIQUE KEY `uk_expenses_overtime_alert_once` (`source_alert_id`, `expense_type`, `is_void`)');

CALL sp_add_fk_if_missing('expenses', 'fk_expenses_procurement', 'FOREIGN KEY (`procurement_id`) REFERENCES `procurements`(`id`)');
CALL sp_add_fk_if_missing('expenses', 'fk_expenses_source_alert', 'FOREIGN KEY (`source_alert_id`) REFERENCES `alerts`(`id`)');

UPDATE expenses e
JOIN voyages v ON v.id = e.voyage_id
SET e.procurement_id = v.procurement_id
WHERE e.procurement_id IS NULL
  AND e.is_void = 0;

SET @expense_type_column_type := (
  SELECT COLUMN_TYPE
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'expenses'
     AND column_name = 'expense_type'
   LIMIT 1
);

SET @need_enum_expand := IF(
  @expense_type_column_type IS NOT NULL
  AND INSTR(@expense_type_column_type, 'SANDING_OVERTIME') = 0,
  1,
  0
);

SET @sql := IF(
  @need_enum_expand = 1,
  "ALTER TABLE expenses MODIFY COLUMN expense_type ENUM('FREIGHT','LIGHTERING','CRANE','PORT_MISC','OTHER','SANDING_OVERTIME') NOT NULL",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260329_019_phase_sanding_timeout_overtime', 'Phase 019 sanding timeout overtime closure schema enhancement', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
