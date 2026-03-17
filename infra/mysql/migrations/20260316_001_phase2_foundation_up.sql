-- Phase 2 foundation migration (safe / additive)
-- Date: 2026-03-16
-- Notes: additive only, no DROP TABLE.

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
DROP PROCEDURE IF EXISTS sp_add_governance_columns;

DELIMITER $$

CREATE PROCEDURE sp_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_index_if_missing(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_index_ddl TEXT)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = p_table AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_index_ddl);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_fk_if_missing(IN p_table VARCHAR(64), IN p_fk_name VARCHAR(64), IN p_fk_ddl TEXT)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = p_table
      AND constraint_name = p_fk_name AND constraint_type = 'FOREIGN KEY'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk_name, '` ', p_fk_ddl);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_add_governance_columns(IN p_table VARCHAR(64))
BEGIN
  CALL sp_add_column_if_missing(p_table, 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  CALL sp_add_column_if_missing(p_table, 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  CALL sp_add_column_if_missing(p_table, 'created_by', 'BIGINT UNSIGNED NULL');
  CALL sp_add_column_if_missing(p_table, 'updated_by', 'BIGINT UNSIGNED NULL');
  CALL sp_add_column_if_missing(p_table, 'is_void', 'TINYINT(1) NOT NULL DEFAULT 0');
  CALL sp_add_column_if_missing(p_table, 'void_reason', 'VARCHAR(255) NULL');
  CALL sp_add_column_if_missing(p_table, 'void_at', 'DATETIME NULL');
  CALL sp_add_index_if_missing(p_table, 'idx_is_void', 'INDEX `idx_is_void` (`is_void`)');
END$$

DELIMITER ;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  phone VARCHAR(20) NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  status ENUM('ACTIVE','DISABLED','LOCKED') NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_code VARCHAR(64) NOT NULL,
  role_name VARCHAR(64) NOT NULL,
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_role_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  perm_code VARCHAR(128) NOT NULL,
  perm_name VARCHAR(128) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permissions_perm_code (perm_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_roles_user_role (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_permissions_role_perm (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ship_no VARCHAR(64) NOT NULL,
  ship_name VARCHAR(128) NOT NULL,
  mmsi VARCHAR(32) NOT NULL,
  last_position_time DATETIME NULL,
  status ENUM('IDLE','IN_VOYAGE','MAINTENANCE','DISABLED') NOT NULL DEFAULT 'IDLE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ships_ship_no (ship_no),
  UNIQUE KEY uk_ships_mmsi (mmsi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS procurements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  procurement_no VARCHAR(64) NOT NULL,
  buyer_name VARCHAR(128) NOT NULL,
  planned_qty DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(14,2) NULL,
  total_amount DECIMAL(14,2) NULL,
  mining_ticket_url VARCHAR(512) NULL,
  quality_photo_urls JSON NULL,
  sand_start_time DATETIME NULL,
  planned_duration_min INT UNSIGNED NULL,
  status ENUM('PENDING_DISPATCH','DISPATCHED','SANDING','IN_TRANSIT','WAIT_LIGHTERING','COMPLETED','VOID')
    NOT NULL DEFAULT 'PENDING_DISPATCH',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_procurements_no (procurement_no),
  CONSTRAINT chk_procurements_planned_qty CHECK (planned_qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS voyages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voyage_no VARCHAR(64) NOT NULL,
  ship_id BIGINT UNSIGNED NOT NULL,
  procurement_id BIGINT UNSIGNED NOT NULL,
  status ENUM('IN_PROGRESS','LOCKED','COMPLETED','VOID') NOT NULL DEFAULT 'IN_PROGRESS',
  started_at DATETIME NULL,
  locked_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_voyages_no (voyage_no),
  UNIQUE KEY uk_voyages_procurement (procurement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_no VARCHAR(64) NOT NULL,
  voyage_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING_STOCK_IN','AVAILABLE','PARTIALLY_ALLOCATED','SOLD_OUT','VOID')
    NOT NULL DEFAULT 'PENDING_STOCK_IN',
  available_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  locked_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  shipped_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  remaining_qty DECIMAL(14,3) GENERATED ALWAYS AS (available_qty - locked_qty - shipped_qty) STORED,
  stock_in_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  mining_ticket_url VARCHAR(512) NULL,
  quality_photo_urls JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_inventory_batches_no (batch_no),
  CONSTRAINT chk_inventory_batches_qty_non_negative CHECK (available_qty >= 0 AND locked_qty >= 0 AND shipped_qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sales_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_order_no VARCHAR(64) NOT NULL,
  customer_name VARCHAR(128) NOT NULL,
  sales_user_id BIGINT UNSIGNED NULL,
  status ENUM('DRAFT','LOCKED_STOCK','PENDING_FINAL_QTY_CONFIRM','READY_FOR_PAYMENT_CONFIRM','COMPLETED','VOID')
    NOT NULL DEFAULT 'DRAFT',
  ar_status ENUM('ESTIMATED_AR','FINAL_AR') NOT NULL DEFAULT 'ESTIMATED_AR',
  planned_total_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  final_total_qty DECIMAL(14,3) NULL,
  unit_price DECIMAL(14,2) NULL,
  total_amount DECIMAL(14,2) NULL,
  final_qty_confirmed_by BIGINT UNSIGNED NULL,
  final_qty_confirmed_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_orders_no (sales_order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS allocation_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  allocation_payload JSON NOT NULL,
  status ENUM('PENDING_APPROVAL','EFFECTIVE','SUPERSEDED','REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  requested_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_allocation_versions_order_version (sales_order_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sales_line_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  voyage_id BIGINT UNSIGNED NOT NULL,
  planned_qty DECIMAL(14,3) NOT NULL,
  final_qty DECIMAL(14,3) NULL,
  allocation_version_id BIGINT UNSIGNED NULL,
  status ENUM('LOCKED','FINALIZED','VOID') NOT NULL DEFAULT 'LOCKED',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_line_items_order_line (sales_order_id, line_no),
  CONSTRAINT chk_sales_line_items_qty CHECK (planned_qty > 0 AND (final_qty IS NULL OR final_qty >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS weighing_slips (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slip_no VARCHAR(64) NOT NULL,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  planned_qty DECIMAL(14,3) NOT NULL,
  final_total_qty DECIMAL(14,3) NOT NULL,
  delta_qty DECIMAL(14,3) GENERATED ALWAYS AS (final_total_qty - planned_qty) STORED,
  status ENUM('UPLOADED','PENDING_CONFIRM','CONFIRMED','VOID') NOT NULL DEFAULT 'UPLOADED',
  is_final TINYINT(1) NOT NULL DEFAULT 0,
  final_key BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN is_final = 1 THEN sales_order_id ELSE NULL END) STORED,
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NULL,
  voucher_url VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_weighing_slips_no (slip_no),
  UNIQUE KEY uk_weighing_slips_one_final (final_key),
  CONSTRAINT chk_weighing_slips_final_qty CHECK (final_total_qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS approvals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_no VARCHAR(64) NOT NULL,
  approval_type ENUM('LOCKED_CHANGE','TONNAGE_FIX','ALLOCATION_ADJUST','STOCK_IN_ADJUST','EXPENSE_ADJUST','SETTLEMENT_REVISE') NOT NULL,
  target_entity_type ENUM('VOYAGE','SETTLEMENT_VERSION','ALLOCATION_VERSION','SALES_ORDER','STOCK_IN','EXPENSE') NOT NULL,
  target_entity_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELED') NOT NULL DEFAULT 'PENDING',
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  reason VARCHAR(255) NOT NULL,
  before_snapshot JSON NULL,
  after_snapshot JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_approvals_no (approval_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stock_ins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stock_in_no VARCHAR(64) NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  confirmed_qty DECIMAL(14,3) NOT NULL,
  stock_in_time DATETIME NOT NULL,
  status ENUM('PENDING','CONFIRMED','SUPERSEDED','VOID') NOT NULL DEFAULT 'PENDING',
  evidence_urls JSON NULL,
  confirmed_by BIGINT UNSIGNED NULL,
  approval_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stock_ins_no (stock_in_no),
  UNIQUE KEY uk_stock_ins_batch_version (batch_id, version_no),
  CONSTRAINT chk_stock_ins_confirmed_qty_non_negative CHECK (confirmed_qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lighterings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lightering_no VARCHAR(64) NOT NULL,
  voyage_id BIGINT UNSIGNED NOT NULL,
  transfer_type ENUM('SHIP_TO_SHIP','SHIP_TO_SHORE') NOT NULL,
  receiver_type ENUM('OWNED','LEASED','OTHER') NOT NULL,
  receiver_ship_name VARCHAR(128) NULL,
  lightering_qty DECIMAL(14,3) NOT NULL,
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  is_main_ship_empty TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('DRAFT','IN_PROGRESS','MAIN_EMPTY_CONFIRMED','VOID') NOT NULL DEFAULT 'DRAFT',
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lighterings_no (lightering_no),
  CONSTRAINT chk_lighterings_qty_positive CHECK (lightering_qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_no VARCHAR(64) NOT NULL,
  voyage_id BIGINT UNSIGNED NOT NULL,
  expense_type ENUM('FREIGHT','LIGHTERING','CRANE','PORT_MISC','OTHER') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  occurred_at DATETIME NOT NULL,
  voucher_urls JSON NULL,
  status ENUM('DRAFT','CONFIRMED','VOID') NOT NULL DEFAULT 'DRAFT',
  entered_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_expenses_no (expense_no),
  CONSTRAINT chk_expenses_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_no VARCHAR(64) NOT NULL,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  payment_amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('BANK_TRANSFER','CASH','OTHER') NOT NULL,
  status ENUM('PENDING','CONFIRMED','VOID') NOT NULL DEFAULT 'PENDING',
  is_irreversible TINYINT(1) NOT NULL DEFAULT 0,
  paid_at DATETIME NOT NULL,
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NULL,
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_no (payment_no),
  CONSTRAINT chk_payments_amount_positive CHECK (payment_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settlement_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voyage_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  based_on_version_id BIGINT UNSIGNED NULL,
  snapshot_type ENUM('COST_SNAPSHOT','REVISED') NOT NULL DEFAULT 'COST_SNAPSHOT',
  procurement_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  expense_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  revenue_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  profit_amount DECIMAL(14,2) GENERATED ALWAYS AS (revenue_amount - procurement_cost - expense_total) STORED,
  status ENUM('PENDING_APPROVAL','EFFECTIVE','SUPERSEDED','REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  readonly_at DATETIME NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_settlement_versions_voyage_version (voyage_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_no VARCHAR(64) NOT NULL,
  alert_type ENUM('SANDING_TIMEOUT','ABNORMAL_STAY','OTHER') NOT NULL,
  related_entity_type ENUM('SHIP','PROCUREMENT','VOYAGE','SALES_ORDER') NOT NULL,
  related_entity_id BIGINT UNSIGNED NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','ACKED','CLOSED') NOT NULL DEFAULT 'OPEN',
  triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_by BIGINT UNSIGNED NULL,
  handled_at DATETIME NULL,
  handle_note VARCHAR(500) NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alerts_no (alert_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trace_id VARCHAR(64) NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CALL sp_add_governance_columns('users');
CALL sp_add_governance_columns('roles');
CALL sp_add_governance_columns('permissions');
CALL sp_add_governance_columns('user_roles');
CALL sp_add_governance_columns('role_permissions');
CALL sp_add_governance_columns('ships');
CALL sp_add_governance_columns('procurements');
CALL sp_add_governance_columns('voyages');
CALL sp_add_governance_columns('inventory_batches');
CALL sp_add_governance_columns('stock_ins');
CALL sp_add_governance_columns('lighterings');
CALL sp_add_governance_columns('expenses');
CALL sp_add_governance_columns('sales_orders');
CALL sp_add_governance_columns('sales_line_items');
CALL sp_add_governance_columns('weighing_slips');
CALL sp_add_governance_columns('payments');
CALL sp_add_governance_columns('alerts');
CALL sp_add_governance_columns('approvals');
CALL sp_add_governance_columns('settlement_versions');
CALL sp_add_governance_columns('allocation_versions');
CALL sp_add_governance_columns('audit_logs');

CALL sp_add_fk_if_missing('user_roles', 'fk_user_roles_user', 'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('user_roles', 'fk_user_roles_role', 'FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)');
CALL sp_add_fk_if_missing('role_permissions', 'fk_role_permissions_role', 'FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)');
CALL sp_add_fk_if_missing('role_permissions', 'fk_role_permissions_permission', 'FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`)');
CALL sp_add_fk_if_missing('voyages', 'fk_voyages_ship', 'FOREIGN KEY (`ship_id`) REFERENCES `ships`(`id`)');
CALL sp_add_fk_if_missing('voyages', 'fk_voyages_procurement', 'FOREIGN KEY (`procurement_id`) REFERENCES `procurements`(`id`)');
CALL sp_add_fk_if_missing('inventory_batches', 'fk_inventory_batches_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`)');
CALL sp_add_fk_if_missing('stock_ins', 'fk_stock_ins_batch', 'FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`)');
CALL sp_add_fk_if_missing('stock_ins', 'fk_stock_ins_approval', 'FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`)');
CALL sp_add_fk_if_missing('sales_orders', 'fk_sales_orders_sales_user', 'FOREIGN KEY (`sales_user_id`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('sales_line_items', 'fk_sales_line_items_order', 'FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)');
CALL sp_add_fk_if_missing('sales_line_items', 'fk_sales_line_items_batch', 'FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`)');
CALL sp_add_fk_if_missing('sales_line_items', 'fk_sales_line_items_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`)');
CALL sp_add_fk_if_missing('sales_line_items', 'fk_sales_line_items_allocation_version', 'FOREIGN KEY (`allocation_version_id`) REFERENCES `allocation_versions`(`id`)');
CALL sp_add_fk_if_missing('weighing_slips', 'fk_weighing_slips_order', 'FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)');
CALL sp_add_fk_if_missing('payments', 'fk_payments_order', 'FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)');
CALL sp_add_fk_if_missing('lighterings', 'fk_lighterings_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`)');
CALL sp_add_fk_if_missing('expenses', 'fk_expenses_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`)');
CALL sp_add_fk_if_missing('settlement_versions', 'fk_settlement_versions_voyage', 'FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`)');
CALL sp_add_fk_if_missing('settlement_versions', 'fk_settlement_versions_based_on', 'FOREIGN KEY (`based_on_version_id`) REFERENCES `settlement_versions`(`id`)');
CALL sp_add_fk_if_missing('allocation_versions', 'fk_allocation_versions_order', 'FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)');
CALL sp_add_fk_if_missing('approvals', 'fk_approvals_requested_by', 'FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('approvals', 'fk_approvals_reviewed_by', 'FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('alerts', 'fk_alerts_handled_by', 'FOREIGN KEY (`handled_by`) REFERENCES `users`(`id`)');
CALL sp_add_fk_if_missing('audit_logs', 'fk_audit_logs_actor', 'FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)');

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

DELIMITER $$

CREATE TRIGGER trg_inventory_batches_guard_available_qty
BEFORE UPDATE ON inventory_batches
FOR EACH ROW
BEGIN
  IF NEW.available_qty <> OLD.available_qty
    AND COALESCE(@allow_available_qty_update, 0) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'available_qty can only be updated by stock_in confirmation.';
  END IF;
END$$

CREATE TRIGGER trg_stock_ins_apply_on_insert
AFTER INSERT ON stock_ins
FOR EACH ROW
BEGIN
  IF NEW.status = 'CONFIRMED' THEN
    SET @allow_available_qty_update := 1;
    UPDATE inventory_batches
      SET available_qty = NEW.confirmed_qty,
          stock_in_confirmed = 1,
          status = CASE WHEN status = 'PENDING_STOCK_IN' THEN 'AVAILABLE' ELSE status END
    WHERE id = NEW.batch_id;
    SET @allow_available_qty_update := 0;
  END IF;
END$$

CREATE TRIGGER trg_stock_ins_apply_on_update
AFTER UPDATE ON stock_ins
FOR EACH ROW
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND (OLD.status <> 'CONFIRMED' OR NEW.confirmed_qty <> OLD.confirmed_qty) THEN
    SET @allow_available_qty_update := 1;
    UPDATE inventory_batches
      SET available_qty = NEW.confirmed_qty,
          stock_in_confirmed = 1,
          status = CASE WHEN status = 'PENDING_STOCK_IN' THEN 'AVAILABLE' ELSE status END
    WHERE id = NEW.batch_id;
    SET @allow_available_qty_update := 0;
  END IF;
END$$

CREATE TRIGGER trg_payments_no_revert_confirmed
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  IF OLD.status = 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed payment is immutable and cannot be reverted.';
  END IF;
END$$

CREATE TRIGGER trg_payments_no_delete_confirmed
BEFORE DELETE ON payments
FOR EACH ROW
BEGIN
  IF OLD.status = 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed payment cannot be deleted.';
  END IF;
END$$

CREATE TRIGGER trg_settlement_versions_readonly_update
BEFORE UPDATE ON settlement_versions
FOR EACH ROW
BEGIN
  IF OLD.status IN ('EFFECTIVE','SUPERSEDED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Historical settlement version is read-only.';
  END IF;
END$$

CREATE TRIGGER trg_settlement_versions_readonly_delete
BEFORE DELETE ON settlement_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Settlement versions cannot be deleted.';
END$$

CREATE TRIGGER trg_allocation_versions_readonly_update
BEFORE UPDATE ON allocation_versions
FOR EACH ROW
BEGIN
  IF OLD.status IN ('EFFECTIVE','SUPERSEDED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Historical allocation version is read-only.';
  END IF;
END$$

CREATE TRIGGER trg_allocation_versions_readonly_delete
BEFORE DELETE ON allocation_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Allocation versions cannot be deleted.';
END$$

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs cannot be deleted.';
END$$

DELIMITER ;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_001_phase2_foundation', 'Phase 2 safe foundation migration', NOW())
ON DUPLICATE KEY UPDATE description = VALUES(description), rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_governance_columns;
DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
