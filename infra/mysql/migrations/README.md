# MySQL Migrations

This folder contains additive, non-destructive SQL migrations.

## Files

- `20260316_001_phase2_foundation_up.sql`
  - Safe baseline migration for Phase 2.
  - Creates missing tables.
  - Adds governance columns to key tables.
  - Adds key indexes/unique constraints/foreign keys.
  - Creates integrity triggers for stock-in, versions, payment immutability, and audit append-only.
- `20260316_001_phase2_foundation_rollback.sql`
  - Safe rollback script for application fallback.
  - Does not drop business tables by default.
  - Removes Phase 2 triggers and marks rollback in metadata.

- `20260316_002_phase3_rbac_workbench_up.sql`
  - Extends RBAC model to support role/menu/api/field scope permissions.
  - Seeds required roles and permission codes.
  - Seeds role-permission mappings and field-level visibility policy.
- `20260316_002_phase3_rbac_workbench_rollback.sql`
  - Soft rollback for phase 3 seeds (void mappings/policies).
- `20260316_003_phase4_procurement_dispatch_up.sql`
  - Adds procurement-dispatch chain schema supplements (buyer balance, voyage sequence, procurement/alert fields).
- `20260316_003_phase4_procurement_dispatch_rollback.sql`
  - Safe rollback marker for phase 4.
- `20260316_004_phase5_ship_position_up.sql`
  - Adds ship positioning schema (latest snapshot, frequent ports, provider call logs).
- `20260316_004_phase5_ship_position_rollback.sql`
  - Safe rollback marker for phase 5.
- `20260316_005_phase6_onsite_workflow_up.sql`
  - Adds onsite workflow schema fields, guard triggers, and locked-state protection.
- `20260316_005_phase6_onsite_workflow_rollback.sql`
  - Safe rollback marker for phase 6.
- `20260316_006_phase7_sales_batch_allocation_up.sql`
  - Adds sales line attribution fields, sellable constraints, and line-level cost/profit permission seeds.
- `20260316_006_phase7_sales_batch_allocation_rollback.sql`
  - Safe rollback marker for phase 7.
- `20260316_007_phase8_weighing_finance_closure_up.sql`
  - Adds weighing/AR closure fields, payment reversal fields, and finance closure constraints.
- `20260316_007_phase8_weighing_finance_closure_rollback.sql`
  - Safe rollback marker for phase 8.
- `20260316_008_phase9_governance_approval_version_report_up.sql`
  - Adds approval enhancement fields, governance indexes, no-physical-delete triggers, and governance/report permissions.
- `20260316_008_phase9_governance_approval_version_report_rollback.sql`
  - Safe rollback marker for phase 9.
- `20260316_009_phase1_ship_management_up.sql`
  - Adds ship master data fields for management (type/tonnage/owner/contact/common ports/remark) and search indexes.
- `20260316_009_phase1_ship_management_rollback.sql`
  - Safe rollback marker for ship management enhancement.
- `20260316_010_phase2_order_system_design_up.sql`
  - Adds order-system foundation entities and relations: customers, order detail extension tables, sales-order customer relation, status transition log.
- `20260316_010_phase2_order_system_design_rollback.sql`
  - Safe rollback marker for phase 2 order system design.
- `20260316_011_phase3_procurement_voyage_chain_up.sql`
  - Aligns procurement-dispatch-voyage core chain fields and relations (procurement ship/supplier/mining fields), keeps `1 Voyage = 1 Procurement`.
- `20260316_011_phase3_procurement_voyage_chain_rollback.sql`
  - Safe rollback marker for phase 3 chain alignment.
- `20260316_012_phase4_sales_order_lineitem_up.sql`
  - Aligns sales order and line-item field naming (`order_no`, `source_voyage_id`, `locked_qty`, `allocated_final_qty`, `cost_amount`, `revenue_amount`, `gross_profit`) with backward-compatible backfill.
- `20260316_012_phase4_sales_order_lineitem_rollback.sql`
  - Safe rollback marker for phase 4 sales-order alignment.
- `20260329_014_phase_encoding_cleanup_up.sql`
  - Cleans historical mojibake (`?`) text rows in `ships` / `procurements` with backup tables.
- `20260329_014_phase_encoding_cleanup_rollback.sql`
  - Restores cleaned rows from backup tables and marks migration rollback.
- `20260329_015_phase_lightering_enhancement_up.sql`
  - Adds lightering business fields (ship/location/time/operator/attachments/unload flag), indexes, FK and backfill.
- `20260329_015_phase_lightering_enhancement_rollback.sql`
  - Safe rollback marker for phase 015.
- `20260329_016_phase_stockin_enhancement_up.sql`
  - Adds stock-in governance fields (`voyage_id/procurement_id/before_qty/after_qty/operator/voucher`) and batch confirmation metadata.
- `20260329_016_phase_stockin_enhancement_rollback.sql`
  - Safe rollback marker for phase 016.
- `20260329_017_phase_weighing_enhancement_up.sql`
  - Adds weighing difference-tracking fields (`weighing_no`, `attachments`, `difference_*`) and order-level `difference_status`, with backfill.
- `20260329_017_phase_weighing_enhancement_rollback.sql`
  - Safe rollback marker for phase 017.
- `20260329_018_phase_payment_enhancement_up.sql`
  - Adds payment idempotency field (`payments.request_no`) and order-level payment summary (`sales_orders.payment_status`) with backfill.
- `20260329_018_phase_payment_enhancement_rollback.sql`
  - Safe rollback marker for phase 018.

## Execution

```powershell
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_001_phase2_foundation_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_002_phase3_rbac_workbench_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_004_phase5_ship_position_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_005_phase6_onsite_workflow_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_006_phase7_sales_batch_allocation_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_007_phase8_weighing_finance_closure_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_008_phase9_governance_approval_version_report_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_009_phase1_ship_management_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_010_phase2_order_system_design_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_011_phase3_procurement_voyage_chain_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_012_phase4_sales_order_lineitem_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_014_phase_encoding_cleanup_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_015_phase_lightering_enhancement_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_016_phase_stockin_enhancement_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_017_phase_weighing_enhancement_up.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_018_phase_payment_enhancement_up.sql
```

Rollback (safe mode):

```powershell
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_001_phase2_foundation_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_002_phase3_rbac_workbench_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_004_phase5_ship_position_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_005_phase6_onsite_workflow_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_006_phase7_sales_batch_allocation_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_007_phase8_weighing_finance_closure_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_008_phase9_governance_approval_version_report_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_009_phase1_ship_management_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_010_phase2_order_system_design_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_011_phase3_procurement_voyage_chain_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_012_phase4_sales_order_lineitem_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_014_phase_encoding_cleanup_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_015_phase_lightering_enhancement_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_016_phase_stockin_enhancement_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_017_phase_weighing_enhancement_rollback.sql
mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260329_018_phase_payment_enhancement_rollback.sql
```
