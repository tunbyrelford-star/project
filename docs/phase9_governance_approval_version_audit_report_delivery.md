# 阶段 9 交付：审批、版本、审计、报表

## 1. 相关表与字段

迁移文件：
- [20260316_008_phase9_governance_approval_version_report_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_008_phase9_governance_approval_version_report_up.sql)
- [20260316_008_phase9_governance_approval_version_report_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_008_phase9_governance_approval_version_report_rollback.sql)

新增字段（`approvals`）：
- `attachment_urls`
- `review_opinion` (`APPROVE` / `REJECT`)
- `review_comment`
- `review_attachment_urls`
- `linked_version_type` (`SETTLEMENT_VERSION` / `ALLOCATION_VERSION`)
- `linked_version_id`
- `resolved_at`

新增索引：
- `approvals.idx_approvals_status_type_time`
- `approvals.idx_approvals_target`
- `settlement_versions.idx_settlement_versions_voyage_status`
- `allocation_versions.idx_allocation_versions_order_status`
- `audit_logs.idx_audit_logs_entity_time`

新增触发器（禁止物理删除）：
- `trg_voyages_no_delete`
- `trg_inventory_batches_no_delete`
- `trg_sales_orders_no_delete`
- `trg_sales_line_items_no_delete`
- `trg_expenses_no_delete`
- `trg_stock_ins_no_delete`
- `trg_lighterings_no_delete`
- `trg_weighing_slips_no_delete`

既有规则继续生效：
- `audit_logs` 删除禁止（不可删除）
- `settlement_versions` / `allocation_versions` 历史版本只读触发器
- `payments` 确认后不可回退/不可删除

## 2. 审批流设计

接口主链：
1. `POST /api/governance/approvals` 发起审批
2. `GET /api/governance/approvals` 审批列表
3. `GET /api/governance/approvals/:id` 审批详情（含前后快照、附件、审计）
4. `POST /api/governance/approvals/:id/review` 审批处理（通过/驳回）

审批约束：
- 对金额/吨数/利润有影响的审批类型（`LOCKED_CHANGE`、`TONNAGE_FIX`、`ALLOCATION_ADJUST`、`STOCK_IN_ADJUST`、`EXPENSE_ADJUST`、`SETTLEMENT_REVISE`）在锁定态目标上才能提交。
- 审批通过后写入审计日志并绑定生成的版本 ID。
- 审批驳回不会覆盖历史版本，且对费用草稿执行作废处理（`status=VOID`）。

角色策略：
- 审批处理（review）仅 `SUPER_ADMIN` / `FINANCE_MGMT`。
- 其它业务角色可查询和提交审批。

## 3. 版本生成规则

审批通过时自动生成版本：
- `SETTLEMENT_REVISE` / `EXPENSE_ADJUST` / `STOCK_IN_ADJUST` -> 新 `SettlementVersion`
- `ALLOCATION_ADJUST` / 销售链路 `TONNAGE_FIX` -> 新 `AllocationVersion`

`SettlementVersion` 生成规则：
- 基于最新版本号 `+1` 插入新版本。
- `expense` 审批通过后费用转 `CONFIRMED`，并按确认费用重算 `expense_total`。
- `stock_in` 审批通过后生成新的 `stock_ins` 版本并触发库存更新，再生成对应结算版本。

`AllocationVersion` 生成规则：
- 基于最新版本号 `+1` 插入新版本。
- 可按审批快照更新 `sales_line_items`（planned qty / line price / batch/voyage 归属）并同步 `sales_orders` 汇总。
- 锁库批次 `locked_qty` 按行变更增减，受库存约束保护。

历史版本不可覆盖：
- 通过新增版本实现变更，不覆盖旧版本。
- 历史版本读取通过版本号时间序列查询。

## 4. 报表口径说明

报表接口：
- `GET /api/governance/reports/profit-trace`

追溯粒度：
- 行级：`SalesLineItem`
- 归属链：`SalesLineItem -> Batch -> Voyage -> SalesOrder`
- 版本链：最新 `SettlementVersion` / `AllocationVersion`

关键口径：
- 收入：`sales_line_items.line_revenue_amount`
- 成本：`sales_line_items.line_cost_amount`
- 利润：`sales_line_items.line_profit_amount`
- 收款净额：确认收款 - 冲正金额
- 待收金额：订单总额 - 收款净额

页面追溯能力：
- 报表页支持跳转对应航次/订单的版本历史页，形成 “报表 -> 对象 -> 版本” 闭环。

## 5. 验收步骤

1. 执行迁移：
   - `.\scripts\db-migrate-phase9.ps1 -Password "123456"`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm start`
3. 小程序页面验收：
   - `/pages/governance/approval-list/index`
   - `/pages/governance/approval-detail/index?id={id}`
   - `/pages/governance/version-history/index`
   - `/pages/governance/audit/index`
   - `/pages/governance/report/index`
4. 规则验收：
   - 锁定态金额/吨数/利润修改均通过审批链处理
   - 审批通过后生成新版本（`SettlementVersion` 或 `AllocationVersion`）
   - 历史版本只读且不被覆盖
   - 审计日志不可删除
   - 业务对象可作废，不可物理删除
