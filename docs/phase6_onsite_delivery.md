# 阶段 6 交付：现场模块（过驳、卸空、入库确认、费用录入）

## 0. 前置执行结果

数据库已实际完成并验证：
- phase2、phase3、phase4、phase5 迁移已落库
- `schema_migrations` 中对应 migration 均为 active

## 1. 相关表与字段

迁移文件：
- [20260316_005_phase6_onsite_workflow_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_005_phase6_onsite_workflow_up.sql)
- [20260316_005_phase6_onsite_workflow_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_005_phase6_onsite_workflow_rollback.sql)

字段补充：
- `lighterings.empty_confirm_note`
- `stock_ins.remark`
- `expenses.source_module`

索引补充：
- `lighterings(status, voyage_id, is_void)`
- `inventory_batches(stock_in_confirmed, status, voyage_id, is_void)`
- `expenses(voyage_id, status, occurred_at, is_void)`

触发器与约束：
- `trg_settlement_v1_no_revenue`
  - 保证 `SettlementVersion v1` 为成本快照，`revenue_amount=0`
- `trg_sales_line_items_require_stock_in_insert/update`
  - 未入库批次不可销售
- `trg_expenses_locked_guard_update/delete`
  - 锁定航次费用不得直改（必须审批+版本修订）
- `trg_stock_ins_locked_guard_update`
  - 锁定航次吨数不得直改（必须审批+版本修订）
- `trg_sales_line_items_locked_guard_update`
  - 锁定航次归属/吨数不得直改（必须审批+版本修订）

## 2. 页面清单

现场待办列表：
- [index](/D:/项目汇总/projects/apps/mobile/pages/onsite/tasks/index.json)
  - 路径：`/pages/onsite/tasks/index`

入库确认页：
- [index](/D:/项目汇总/projects/apps/mobile/pages/onsite/stockin-confirm/index.json)
  - 路径：`/pages/onsite/stockin-confirm/index?batchId={id}`

费用录入页：
- [index](/D:/项目汇总/projects/apps/mobile/pages/onsite/expense-create/index.json)
  - 路径：`/pages/onsite/expense-create/index?voyageId={id}`

## 3. 按钮与操作设计

现场待办卡片（统一字段）：
- 航次号
- 船名
- 当前步骤
- 状态标签
- 紧急程度
- 主操作按钮

主操作行为：
- `确认卸空` -> `POST /api/onsite/lighterings/:id/confirm-empty`
- `确认入库` -> 跳转入库确认页 -> `POST /api/onsite/stockins/confirm`
- `录入费用` -> 跳转费用录入页 -> `POST /api/onsite/expenses`
- `处理异常` -> 跳转预警页

入库确认页重点：
- 批次状态（Batch 状态）
- `available_qty`
- 可售状态（可售/不可售）
- 确认吨数 + 凭证上传 + 提交按钮

费用录入页重点：
- 航次、费用类型、发生时间、金额、备注
- 凭证上传
- 金额字段按权限显示（受限角色掩码）

## 4. 审批/版本触发说明

规则落地：
1. 卸空确认后，`Voyage.status -> LOCKED`  
2. 锁定时自动生成 `SettlementVersion v1`（若不存在）  
3. `v1` 仅固化成本，不估收入（`revenue_amount=0`）  
4. `available_qty` 仅由入库确认触发更新（沿用 stock_in 触发器机制）  
5. 未入库批次禁止销售（sales_line_items 触发器）  
6. 费用归集到 `Voyage`（费用表按 voyage_id 归集，接口聚合）  
7. 锁定态修改费用/吨数/归属：
   - 不允许直接改
   - 接口会创建 `Approval`
   - 同时创建新的 `SettlementVersion`（`PENDING_APPROVAL`）

接口实现位置：
- [onsite.js](/D:/项目汇总/projects/apps/backend/src/routes/onsite.js)

## 5. 验收步骤

1. 执行迁移（含 phase6）：
   - `.\scripts\db-migrate-phase2.ps1 -Password "123456"`
   - `.\scripts\db-migrate-phase3.ps1 -Password "123456"`
   - `.\scripts\db-migrate-phase4.ps1 -Password "123456"`
   - `.\scripts\db-migrate-phase5.ps1 -Password "123456"`
   - `.\scripts\db-migrate-phase6.ps1 -Password "123456"`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm install`
   - `npm start`
3. 小程序验收：
   - 打开 `/pages/onsite/tasks/index`
   - 检查待过驳/待卸空/待入库确认/待录费用/待处理异常分组与卡片字段
4. 规则验收：
   - 执行卸空确认，验证 `voyages.status=LOCKED`
   - 验证生成 `settlement_versions` 的 `v1` 且 `revenue_amount=0`
   - 入库确认后验证 `inventory_batches.available_qty` 更新且状态可售
   - 对锁定航次做费用/吨数改动，验证返回审批链路与版本修订信息
