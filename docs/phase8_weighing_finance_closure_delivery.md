# 阶段 8 交付：磅单与财务闭环

## 1. 数据表与字段改动

迁移文件：
- [20260316_007_phase8_weighing_finance_closure_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_007_phase8_weighing_finance_closure_up.sql)
- [20260316_007_phase8_weighing_finance_closure_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_007_phase8_weighing_finance_closure_rollback.sql)

关键字段新增：
- `sales_orders`
  - `final_weighing_slip_id`
  - `qty_diff_confirmed / qty_diff_confirmed_by / qty_diff_confirmed_at / qty_diff_confirm_note`
  - `ar_confirmed_by / ar_confirmed_at`
- `weighing_slips`
  - `uploaded_by`
  - `remark`
- `payments`
  - `is_reversal`
  - `reversal_of_payment_id`（唯一索引）
  - `reversal_reason`

关键索引/约束：
- `idx_sales_orders_finance_pending`
- `idx_weighing_slips_order_status`
- `idx_payments_order_status`
- `uk_payments_reversal_of`
- `fk_payments_reversal_of`
- `fk_sales_orders_final_slip`

关键触发器：
- `trg_sales_orders_no_ar_revert`（`FINAL_AR` 不可回退、`final_total_qty` 确认后不可改）
- `trg_payments_reversal_guard_insert`（冲正记录结构约束）
- 继承前序触发器：`trg_payments_no_revert_confirmed`、`trg_payments_no_delete_confirmed`

## 2. 状态机说明

订单主状态：
1. `LOCKED_STOCK`
2. `PENDING_FINAL_QTY_CONFIRM`（磅单录入后）
3. `READY_FOR_PAYMENT_CONFIRM`（财务确认后，`ar_status = FINAL_AR`）
4. `COMPLETED`（净确认收款 >= 最终应收）

应收状态：
1. `ESTIMATED_AR`（不可确认收款）
2. `FINAL_AR`（允许确认收款）

磅单状态：
1. `PENDING_CONFIRM`（录入后待财务确认）
2. `CONFIRMED`（被选为最终结算磅单）
3. `VOID`（被后续最终磅单取代）

收款状态（由已确认收款净额推导）：
1. `UNPAID`
2. `PARTIAL`
3. `CONFIRMED`

核心规则映射：
- `final_total_qty` 以最终确认磅单为唯一来源。
- 若 `final_total_qty != planned_total_qty`，必须人工确认（`diffConfirm` + `diffConfirmNote`）。
- 财务确认时按 `planned_qty` 比例分摊到每条 `SalesLineItem.final_qty`。
- `ESTIMATED_AR` 禁止收款确认，只有 `FINAL_AR` 允许。

## 3. 页面路径与组件

页面路径：
- `/pages/finance/pending/index`（待确认订单）
- `/pages/finance/weighing/index`（磅单录入）
- `/pages/finance/confirm/index`（财务确认）
- `/pages/finance/payment/index`（收款确认与冲正）

服务层：
- [finance.js](/D:/项目汇总/projects/apps/mobile/services/finance.js)

复用公共组件：
- `sl-page-shell`
- `sl-business-card`
- `sl-status-tag`
- `sl-top-filter-bar`
- `sl-bottom-action-bar`
- `sl-attachment-uploader`

页面风格：
- 卡片化信息结构 + 重点状态标签 + 风险提示条
- 强调“差异状态、最终吨数、待办动作、不可撤销确认”

## 4. 不可撤销实现方式

数据库层：
1. `payments` 确认后由触发器禁止回退状态、禁止删除。
2. 冲正必须新增 `is_reversal = 1` 记录，不允许改回原记录。
3. `sales_orders.ar_status` 到 `FINAL_AR` 后由触发器禁止回退。
4. `sales_orders.final_total_qty` 确认后不可直接修改。

接口层：
1. `POST /api/finance/orders/:id/payments/confirm`
   - 仅 `FINAL_AR` 可执行
   - 直接写入 `CONFIRMED + is_irreversible=1`
2. `POST /api/finance/payments/:id/reverse`
   - 只新增冲正记录，不修改原确认收款
   - 根据净收款实时回算订单状态

前端层：
1. 收款确认页强提示“确认后不可撤销”
2. 执行前二次确认弹窗
3. 禁用态显示明确原因（非 `FINAL_AR` / 非财务角色 / 无待收金额）

## 5. 验收步骤

1. 执行迁移：
   - `.\scripts\db-migrate-phase8.ps1 -Password "123456"`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm start`
3. 小程序页面验收：
   - `/pages/finance/pending/index`
   - `/pages/finance/weighing/index?orderId={id}`
   - `/pages/finance/confirm/index?orderId={id}`
   - `/pages/finance/payment/index?orderId={id}`
4. 业务规则验收：
   - `final_total_qty` 与计划不一致时，不填差异说明无法财务确认
   - 财务确认后 `ar_status` 变为 `FINAL_AR`
   - `ESTIMATED_AR` 阶段调用收款确认接口被拒绝
   - `FINAL_AR` 阶段收款确认成功，且不可撤销
   - 错误收款只能冲正，不能直接改回原确认记录
