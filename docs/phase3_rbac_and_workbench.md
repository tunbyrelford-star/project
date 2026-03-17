# 阶段 3 交付：RBAC 权限模型 + 角色工作台首页

## 1. 权限码清单

### 1.1 菜单级权限
- `MENU_WORKBENCH`
- `MENU_PROCUREMENT`
- `MENU_SHIP_POSITION`
- `MENU_LIGHTERING`
- `MENU_STOCK_IN`
- `MENU_EXPENSE`
- `MENU_SALES`
- `MENU_FINANCE`
- `MENU_APPROVAL`
- `MENU_AUDIT`

### 1.2 接口级权限
- `API_WORKBENCH_AGGREGATE`
- `API_PROCUREMENT_LIST`
- `API_PROCUREMENT_UPDATE`
- `API_SHIP_POSITION`
- `API_LIGHTERING_CONFIRM`
- `API_STOCKIN_CONFIRM`
- `API_EXPENSE_SAVE`
- `API_SALES_CREATE`
- `API_WEIGHING_UPLOAD`
- `API_PAYMENT_CONFIRM`
- `API_APPROVAL_REVIEW`
- `API_AUDIT_READ`

### 1.3 字段级权限
- `FIELD_PROCUREMENT_UNIT_PRICE_VIEW` 对应 `procurement.unit_price`
- `FIELD_PROCUREMENT_TOTAL_AMOUNT_VIEW` 对应 `procurement.total_amount`
- `FIELD_VOYAGE_COST_VIEW` 对应 `voyage.cost_amount`
- `FIELD_VOYAGE_PROFIT_VIEW` 对应 `voyage.profit_amount`

### 1.4 操作级权限
- `ACTION_PAYMENT_CONFIRM`
- `ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL`
- `ACTION_APPROVAL_REVIEW`

## 2. 角色权限矩阵

| 角色 | 菜单权限 | 接口权限 | 字段权限 | 关键操作 |
|---|---|---|---|---|
| 超级管理员 `SUPER_ADMIN` | 全部 | 全部（不含审计删除） | 敏感字段可见 | 可确认收款，可审批；锁定态关键变更仍走审批 |
| 采购/调度员 `DISPATCHER` | 工作台、采购调度、船舶定位 | 工作台聚合、采购列表/编辑、定位 | 采购单价/采购总额/成本/利润默认掩码 | 不可确认收款；可提交锁定态变更审批 |
| 现场/过驳专员 `ONSITE_SPECIALIST` | 工作台、过驳、入库、费用 | 工作台聚合、卸空确认、入库确认、费用录入 | 敏感字段默认掩码 | 不可确认收款；可提交锁定态变更审批 |
| 销售经理/销售员 `SALES` | 工作台、销售 | 工作台聚合、销售建单、磅单上传 | 敏感字段默认掩码 | 不可确认收款；锁定态关键变更需走审批链路 |
| 财务/管理层 `FINANCE_MGMT` | 工作台、财务、审批、审计 | 工作台聚合、确认收款、审批审核、审计查询 | 敏感字段可见 | 可确认收款；可审批；锁定态关键变更必须审批 |

约束落实：
- 采购单价/采购总额/成本/利润：默认仅 `SUPER_ADMIN`、`FINANCE_MGMT` 可见，其它角色掩码。
- 确认收款：仅 `ACTION_PAYMENT_CONFIRM` 角色可操作。
- 锁定态关键变更：通过 `ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL` 提交审批，不允许直接落地关键变更。
- 审计日志不可删除：数据库触发器强约束。

## 3. 首页聚合接口

接口定义：
- `GET /api/workbench/aggregate`

请求参数：
- `roleCode`：`SUPER_ADMIN | DISPATCHER | ONSITE_SPECIALIST | SALES | FINANCE_MGMT`

返回结构：
- `roleCode`：当前角色
- `title`：工作台标题
- `todo[]`：待办列表（标题、数量、优先级）
- `alerts[]`：异常列表（标题、描述、级别）
- `quickEntries[]`：快捷入口（标题、路径）
- `stats[]`：统计摘要（字段权限处理后）
- `permissions`：
  - `canConfirmPayment`
  - `lockedChangeRequiresApproval`
  - `auditLogDeletable`
- `serverTime`

实现位置：
- 前端聚合服务：[workbench.js](/D:/项目汇总/projects/apps/mobile/services/workbench.js)
- Mock 数据源：[workbench.js](/D:/项目汇总/projects/apps/mobile/mock/workbench.js)

## 4. 页面结构

页面入口：
- 角色工作台：[index](/D:/项目汇总/projects/apps/mobile/pages/index/index.json)

首页结构（统一骨架）：
1. 顶部角色切换栏（仅用于当前开发验收）
2. 待办卡片
3. 异常预警卡片
4. 统计摘要卡片（敏感字段自动脱敏）
5. 快捷入口卡片
6. 权限约束提示卡片

角色重点已落地：
- 采购/调度：待派船采购单、作业中采购单、打沙超时预警、船舶定位入口
- 现场/过驳：待过驳、待卸空确认、待入库确认、待录费用
- 销售：可售批次、待补价订单、待上传磅单
- 财务/管理：待差异确认、待确认收款、待审批事项、利润分析入口

## 5. 验收步骤
1. 执行数据库迁移：
   - `.\scripts\db-migrate-phase2.ps1 -Password '你的密码'`
   - `.\scripts\db-migrate-phase3.ps1 -Password '你的密码'`
2. 检查 RBAC 关键数据：
   - `roles` 存在 5 个目标角色
   - `permissions` 存在 menu/api/field/action 四类权限码
   - `field_permission_policies` 已落库
3. 检查约束：
   - 普通角色读取敏感字段时显示掩码
   - 仅财务/管理层与超管显示 `canConfirmPayment=true`
   - `audit_logs` 删除被数据库拒绝
4. 小程序侧校验：
   - `cd D:\项目汇总\projects\apps\mobile`
   - `npm run check`
5. 微信开发者工具打开小程序后进入工作台：
   - 切换不同角色，核对待办/异常/快捷入口是否按角色变化
   - 核对敏感字段展示与权限约束提示

## 6. 关键文件
- 迁移：
  - [20260316_002_phase3_rbac_workbench_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_002_phase3_rbac_workbench_up.sql)
  - [20260316_002_phase3_rbac_workbench_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_002_phase3_rbac_workbench_rollback.sql)
- RBAC 常量与工具：
  - [rbac.js](/D:/项目汇总/projects/apps/mobile/constants/rbac.js)
  - [rbac.js](/D:/项目汇总/projects/apps/mobile/utils/rbac.js)
- 首页与聚合：
  - [index.js](/D:/项目汇总/projects/apps/mobile/pages/index/index.js)
  - [index.wxml](/D:/项目汇总/projects/apps/mobile/pages/index/index.wxml)
  - [index.wxss](/D:/项目汇总/projects/apps/mobile/pages/index/index.wxss)
  - [workbench.js](/D:/项目汇总/projects/apps/mobile/services/workbench.js)
  - [workbench.js](/D:/项目汇总/projects/apps/mobile/mock/workbench.js)

