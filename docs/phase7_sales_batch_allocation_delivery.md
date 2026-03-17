# 阶段 7 交付：销售模块（批次选货 + 归属明细）

## 1. 数据表与字段改动

迁移文件：
- [20260316_006_phase7_sales_batch_allocation_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_006_phase7_sales_batch_allocation_up.sql)
- [20260316_006_phase7_sales_batch_allocation_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_006_phase7_sales_batch_allocation_rollback.sql)

关键改动：
- `sales_orders`：
  - `pricing_mode`（按订单单价 / 按行单价）
  - `locked_stock_at`
- `sales_line_items`：
  - `source_procurement_unit_cost`
  - `source_expense_unit_cost`
  - `line_unit_price`
  - `line_revenue_amount`
  - `line_cost_amount`
  - `line_profit_amount`（生成列）
  - `line_source_note`
- `inventory_batches`：
  - 新增锁库存保护触发器 `trg_inventory_batches_guard_locked_qty`（禁止超卖锁定）

约束与规则落地：
- 销售选货对象固定为 `inventory_batches`
- 未入库或资料不完整批次，开单锁库存前会被拒绝
- 销售可来自多个批次，系统按来源逐行落 `sales_line_items`
- 成本/收入/利润按行按来源计算，不做订单级平均成本

## 2. SalesLineItem 字段说明

`sales_line_items` 核心业务字段：
- `sales_order_id`：所属销售单
- `line_no`：行号（每个来源一行）
- `batch_id`：来源批次
- `voyage_id`：来源航次
- `planned_qty`：锁定吨数
- `final_qty`：最终确认吨数（后续磅单结算）
- `source_procurement_unit_cost`：来源采购单价（对应来源航次）
- `source_expense_unit_cost`：来源费用分摊单价（按来源航次归集）
- `line_unit_price`：销售行单价
- `line_revenue_amount`：收入 = `planned_qty * line_unit_price`
- `line_cost_amount`：成本 = `planned_qty * (source_procurement_unit_cost + source_expense_unit_cost)`
- `line_profit_amount`：利润 = `line_revenue_amount - line_cost_amount`
- `line_source_note`：来源说明（批次/航次）

## 3. 页面与组件拆分

页面：
- 可售批次页：
  - [index](/D:/项目汇总/projects/apps/mobile/pages/sales/batches/index.wxml)
  - 路径：`/pages/sales/batches/index`
- 销售开单页：
  - [index](/D:/项目汇总/projects/apps/mobile/pages/sales/create/index.wxml)
  - 路径：`/pages/sales/create/index`
- 订单详情页：
  - [index](/D:/项目汇总/projects/apps/mobile/pages/sales/detail/index.wxml)
  - 路径：`/pages/sales/detail/index?id={id}`

组件：
- 批次选择器（底部弹层）：
  - [index](/D:/项目汇总/projects/apps/mobile/components/sales/batch-selector/index.wxml)
  - 路径：`/components/sales/batch-selector/index`

服务层：
- [sales.js](/D:/项目汇总/projects/apps/mobile/services/sales.js)

后端路由：
- [sales.js](/D:/项目汇总/projects/apps/backend/src/routes/sales.js)

## 4. 锁库存事务边界

接口：`POST /api/sales/orders`

同一事务内完成：
1. 锁定待选批次行（`FOR UPDATE`）
2. 逐批次校验：
   - 已入库
   - 资料完整（`mining_ticket + quality_photos`）
   - 批次状态可售
   - 可售吨数充足
3. 计算每行来源成本与收入利润（按批次/航次）
4. 创建 `sales_orders`
5. 创建 `allocation_versions`（v1）
6. 创建多条 `sales_line_items`（每来源一条）
7. 更新 `inventory_batches.locked_qty` 与批次状态
8. 写入审计日志

任一步失败 -> 整体回滚，保证锁库存一致性。

## 5. 验收步骤

1. 执行迁移：
   - `.\scripts\db-migrate-phase7.ps1 -Password "123456"`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm start`
3. 小程序验收页面：
   - `/pages/sales/batches/index`
   - `/pages/sales/create/index`
4. 规则验收：
   - 未入库批次不可锁库存
   - 资料不完整批次不可锁库存且显示原因
   - 多批次开单后生成多条 `sales_line_items`
   - `sales_line_items` 成本/收入/利润可回溯到来源批次/航次
   - 批次 `locked_qty` 正确增加且不超卖
5. 详情验收：
   - 订单信息
   - 归属明细
   - 磅单信息
   - 应收状态
   - 收款状态
   - 审计记录
