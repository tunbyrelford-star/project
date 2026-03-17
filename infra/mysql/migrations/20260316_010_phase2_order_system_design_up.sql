-- Phase 2 migration: order system design foundation
-- Date: 2026-03-16
-- Strategy: additive, no destructive drop.

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

-- Customer master data
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_no VARCHAR(64) NOT NULL,
  customer_name VARCHAR(128) NOT NULL,
  contact_person VARCHAR(64) NULL,
  contact_phone VARCHAR(32) NULL,
  address VARCHAR(255) NULL,
  credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_customers_no (customer_no),
  KEY idx_customers_name (customer_name),
  KEY idx_customers_status (status),
  KEY idx_customers_is_void (is_void)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sales order links to customer master, while keeping customer_name snapshot.
CALL sp_add_column_if_missing('sales_orders', 'customer_id', 'BIGINT UNSIGNED NULL AFTER customer_name');
CALL sp_add_index_if_missing('sales_orders', 'idx_sales_orders_customer', 'KEY `idx_sales_orders_customer` (`customer_id`)');
CALL sp_add_fk_if_missing('sales_orders', 'fk_sales_orders_customer', 'FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)');

-- Procurement detail lines
CREATE TABLE IF NOT EXISTS procurement_line_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  procurement_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  material_name VARCHAR(128) NOT NULL,
  quality_spec VARCHAR(128) NULL,
  planned_qty DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(14,2) NULL,
  line_amount DECIMAL(14,2) GENERATED ALWAYS AS (planned_qty * COALESCE(unit_price, 0)) STORED,
  status ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_procurement_line_items_no (procurement_id, line_no),
  KEY idx_procurement_line_items_status (status),
  KEY idx_procurement_line_items_is_void (is_void),
  CONSTRAINT fk_procurement_line_items_procurement FOREIGN KEY (procurement_id) REFERENCES procurements(id),
  CONSTRAINT chk_procurement_line_items_qty CHECK (planned_qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Lightering detail lines
CREATE TABLE IF NOT EXISTS lightering_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lightering_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  cargo_name VARCHAR(128) NOT NULL,
  transfer_qty DECIMAL(14,3) NOT NULL,
  receiver_name VARCHAR(128) NULL,
  receiver_ship_name VARCHAR(128) NULL,
  status ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lightering_items_no (lightering_id, line_no),
  KEY idx_lightering_items_status (status),
  KEY idx_lightering_items_is_void (is_void),
  CONSTRAINT fk_lightering_items_lightering FOREIGN KEY (lightering_id) REFERENCES lighterings(id),
  CONSTRAINT chk_lightering_items_qty CHECK (transfer_qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Weighing slip detail lines
CREATE TABLE IF NOT EXISTS weighing_slip_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  weighing_slip_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  truck_no VARCHAR(64) NULL,
  gross_qty DECIMAL(14,3) NOT NULL,
  tare_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  net_qty DECIMAL(14,3) GENERATED ALWAYS AS (gross_qty - tare_qty) STORED,
  status ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_weighing_slip_items_no (weighing_slip_id, line_no),
  KEY idx_weighing_slip_items_status (status),
  KEY idx_weighing_slip_items_is_void (is_void),
  CONSTRAINT fk_weighing_slip_items_slip FOREIGN KEY (weighing_slip_id) REFERENCES weighing_slips(id),
  CONSTRAINT chk_weighing_slip_items_qty CHECK (gross_qty >= tare_qty AND tare_qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Payment allocation detail
CREATE TABLE IF NOT EXISTS payment_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id BIGINT UNSIGNED NOT NULL,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  allocated_amount DECIMAL(14,2) NOT NULL,
  status ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
  remark VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_allocations_payment_order (payment_id, sales_order_id),
  KEY idx_payment_allocations_status (status),
  KEY idx_payment_allocations_is_void (is_void),
  CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_payment_allocations_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
  CONSTRAINT chk_payment_allocations_amount CHECK (allocated_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Generic order status transition log
CREATE TABLE IF NOT EXISTS order_status_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_type ENUM(
    'PROCUREMENT',
    'VOYAGE',
    'LIGHTERING',
    'STOCK_IN',
    'SALES_ORDER',
    'WEIGHING_SLIP',
    'PAYMENT',
    'EXPENSE',
    'APPROVAL'
  ) NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_reason VARCHAR(255) NULL,
  extra_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  is_void TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  void_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_order_status_transitions_query (order_type, order_id, changed_at),
  KEY idx_order_status_transitions_void (is_void),
  CONSTRAINT fk_order_status_transitions_changed_by FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed customer options for early sales flow
INSERT INTO customers
  (customer_no, customer_name, contact_person, contact_phone, address, credit_limit, status, remark, created_at, updated_at, is_void)
VALUES
  ('CUS-DEFAULT-001', '天津联运建材有限公司', '王经理', '13800010001', '天津市滨海新区', 500000, 'ACTIVE', '默认客户样例', NOW(), NOW(), 0),
  ('CUS-DEFAULT-002', '河北港航物流有限公司', '刘经理', '13800010002', '河北省沧州市', 350000, 'ACTIVE', '默认客户样例', NOW(), NOW(), 0),
  ('CUS-DEFAULT-003', '山东海运贸易有限公司', '赵经理', '13800010003', '山东省日照市', 420000, 'ACTIVE', '默认客户样例', NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  customer_name = VALUES(customer_name),
  contact_person = VALUES(contact_person),
  contact_phone = VALUES(contact_phone),
  address = VALUES(address),
  credit_limit = VALUES(credit_limit),
  status = VALUES(status),
  remark = VALUES(remark),
  updated_at = NOW(),
  is_void = 0,
  void_reason = NULL,
  void_at = NULL;

INSERT INTO schema_migrations (migration_key, description, applied_at)
VALUES ('20260316_010_phase2_order_system_design', 'Phase 2 order system design schema foundation', NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  rolled_back_at = NULL;

DROP PROCEDURE IF EXISTS sp_add_fk_if_missing;
DROP PROCEDURE IF EXISTS sp_add_index_if_missing;
DROP PROCEDURE IF EXISTS sp_add_column_if_missing;
