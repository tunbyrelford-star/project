# 阶段 2 交付：基础落库 + 小程序公共 UI 骨架

## 1. Migration 文件清单
- [20260316_001_phase2_foundation_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_001_phase2_foundation_up.sql)
- [20260316_001_phase2_foundation_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_001_phase2_foundation_rollback.sql)
- [README.md](/D:/项目汇总/projects/infra/mysql/migrations/README.md)

## 2. 表结构说明（摘要）
- 覆盖对象：
  - `Ship` -> `ships`
  - `Voyage` -> `voyages`
  - `Procurement` -> `procurements`
  - `InventoryBatch` -> `inventory_batches`
  - `StockIn` -> `stock_ins`
  - `Lightering` -> `lighterings`
  - `SalesOrder` -> `sales_orders`
  - `SalesLineItem` -> `sales_line_items`
  - `WeighingSlip` -> `weighing_slips`
  - `Payment` -> `payments`
  - `Expense` -> `expenses`
  - `Alert` -> `alerts`
  - `Approval` -> `approvals`
  - `SettlementVersion` -> `settlement_versions`
  - `AllocationVersion` -> `allocation_versions`
  - `AuditLog` -> `audit_logs`
  - `User/Role/Permission/UserRole/RolePermission` -> `users/roles/permissions/user_roles/role_permissions`
- 关键约束：
  - `voyages.procurement_id` 唯一，确保 `1 Voyage = 1 Procurement`
  - `sales_line_items` 关联 `sales_orders + inventory_batches + voyages`
  - `settlement_versions(voyage_id, version_no)` 唯一
  - `allocation_versions(sales_order_id, version_no)` 唯一
  - `weighing_slips` 通过 `final_key` 保证每单仅一条最终磅单
- 治理字段（关键表已补齐）：
  - `created_at`, `updated_at`, `created_by`, `updated_by`, `is_void`, `void_reason`, `void_at`
- 状态枚举：
  - 各核心表均采用 `ENUM` 状态（航次、采购、库存、销售、审批、版本、预警、收款等）

## 3. 旧数据兼容方案与回滚方案
- 旧数据兼容方案：
  - 迁移采用“增量新增”策略，不删表不删字段。
  - 治理字段默认可空或有默认值，历史数据可直接兼容。
  - 新增外键前保留空值策略，避免历史数据因治理字段导致落库失败。
  - 新触发器仅约束关键口径：
    - `available_qty` 只能由 `stock_ins` 驱动
    - `payment CONFIRMED` 不可撤销
    - 历史版本只读
    - `audit_logs` 不可删除
- 回滚方案：
  - 已提供安全回滚脚本（应用层回滚）：移除阶段 2 触发器并标记 migration 回滚时间，不删除业务数据。
  - 全量物理回滚：基于迁移前快照/`mysqldump` 恢复数据库，再按旧版本迁移集重建。

## 4. 公共组件清单
- 页面骨架：
  - [page-shell](/D:/项目汇总/projects/apps/mobile/components/common/page-shell/index.json)
- 公共组件（按要求全部覆盖）：
  - [business-card](/D:/项目汇总/projects/apps/mobile/components/common/business-card/index.json)
  - [status-tag](/D:/项目汇总/projects/apps/mobile/components/common/status-tag/index.json)
  - [top-filter-bar](/D:/项目汇总/projects/apps/mobile/components/common/top-filter-bar/index.json)
  - [bottom-action-bar](/D:/项目汇总/projects/apps/mobile/components/common/bottom-action-bar/index.json)
  - [empty-state](/D:/项目汇总/projects/apps/mobile/components/common/empty-state/index.json)
  - [error-state](/D:/项目汇总/projects/apps/mobile/components/common/error-state/index.json)
  - [attachment-uploader](/D:/项目汇总/projects/apps/mobile/components/common/attachment-uploader/index.json)
  - [audit-timeline](/D:/项目汇总/projects/apps/mobile/components/common/audit-timeline/index.json)
  - [approval-diff](/D:/项目汇总/projects/apps/mobile/components/common/approval-diff/index.json)

## 5. UI 规范摘要
- 设计目标：稳重、专业、商业化。
- 样式令牌：
  - [tokens.wxss](/D:/项目汇总/projects/apps/mobile/styles/tokens.wxss)
  - [base.wxss](/D:/项目汇总/projects/apps/mobile/styles/base.wxss)
- 统一变量：
  - 颜色：主色、文字层级、成功/警告/危险/信息色
  - 字号：`xs/sm/md/lg/xl`
  - 间距：`space-1` 到 `space-7`
  - 圆角：`sm/md/lg/pill`
  - 标签样式：`status-tag` 组件语义化封装
  - 按钮样式：主按钮/次按钮/禁用态
- 移动端形态：
  - 卡片化信息展示
  - 顶部筛选 + 底部固定操作
  - 不使用 PC 宽表格样式

## 6. 验收步骤
1. 执行数据库迁移：
   - `mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_001_phase2_foundation_up.sql`
2. 检查关键表存在：
   - `settlement_versions`, `allocation_versions`, `approvals`, `audit_logs`。
3. 检查治理字段：
   - 任一关键表应包含 `created_at/updated_at/created_by/updated_by/is_void/void_reason`。
4. 小程序侧执行：
   - `cd D:\项目汇总\projects\apps\mobile`
   - `npm run check`
5. 微信开发者工具打开 [apps/mobile](D:/项目汇总/projects/apps/mobile)。
6. 进入 `pages/ui-kit/index` 验收公共组件视觉与交互。

