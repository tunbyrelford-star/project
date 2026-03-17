# Phase 2 - Order System Design (Baseline)

## 1. Order Types

### Main Orders
- Procurement Order (`procurements`)
- Voyage/Dispatch Order (`voyages`)
- Sales Order (`sales_orders`)

### Supporting Documents
- Lightering Order (`lighterings`)
- Stock-In Order (`stock_ins`)
- Weighing Slip (`weighing_slips`)
- Payment Receipt (`payments`)
- Expense Order (`expenses`)
- Approval Form (`approvals`)

## 2. Core Relationships

- `1 Procurement = 1 Voyage` (enforced by `uk_voyages_procurement`)
- Voyage is the main line for cost/profit attribution
- Inventory batch (`inventory_batches`) is the source object for sales selection
- Sales order belongs to source `Batch + Voyage` through `sales_line_items`
- `final_total_qty` is the single source of truth for final settlement quantity
- Payment is tied to sales order; reversal is modeled as a dedicated reversal payment
- Approval targets locked-state changes on key entities

## 3. Master + Detail Strategy

Existing detail tables retained and extended:
- `sales_orders` + `sales_line_items`
- `weighing_slips` (+ newly added `weighing_slip_items`)
- `payments` (+ newly added `payment_allocations`)
- `procurements` (+ newly added `procurement_line_items`)
- `lighterings` (+ newly added `lightering_items`)

Master data enhancement:
- Newly added `customers` master table
- `sales_orders.customer_id` added to link customer master while keeping `customer_name` snapshot

Status trace:
- Newly added `order_status_transitions` as generic status transition log

## 4. State Machines (Unified)

- Procurement: `PENDING_DISPATCH -> DISPATCHED -> SANDING -> IN_TRANSIT -> WAIT_LIGHTERING -> COMPLETED -> VOID`
- Voyage: `IN_PROGRESS -> LOCKED -> COMPLETED -> VOID`
- Lightering: `DRAFT -> IN_PROGRESS -> MAIN_EMPTY_CONFIRMED -> VOID`
- Stock-In: `PENDING -> CONFIRMED -> SUPERSEDED -> VOID`
- Sales Order: `DRAFT -> LOCKED_STOCK -> PENDING_FINAL_QTY_CONFIRM -> READY_FOR_PAYMENT_CONFIRM -> COMPLETED -> VOID`
- Weighing Slip: `UPLOADED/PENDING_CONFIRM -> CONFIRMED -> VOID`
- Payment: `PENDING -> CONFIRMED` (irreversible), correction by reversal record
- Expense: `DRAFT -> CONFIRMED -> VOID`
- Approval: `PENDING -> APPROVED/REJECTED/CANCELED`

## 5. API Entry Baseline

Existing:
- Procurement: `/api/procurements/*`
- Sales: `/api/sales/*`
- Finance: `/api/finance/*`
- Onsite: `/api/onsite/*`
- Governance: `/api/governance/*`

Added in this phase:
- `GET /api/sales/customers/options`
- Sales order create/list/detail now support `customer_id` model alignment

## 6. Mini Program Entry Baseline

Current pages already connected:
- Procurement list/create/detail
- Sales batch/create/detail
- Finance pending/weighing/confirm/payment
- Governance approval/version/audit/report

This phase only adds model alignment in sales create flow:
- optional customer master selection while preserving manual customer name input

## 7. Known Conflicts / Gaps

- Several supporting documents still have no dedicated list/detail pages (lightering, stock-in, expense, weighing/payment list pages).
- Status transition logging table is introduced, but not yet fully wired into every status update path.
- Customer master linkage is now ready, but legacy orders may still only have `customer_name` without `customer_id`.
