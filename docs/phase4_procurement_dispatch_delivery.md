# 阶段 4 交付：采购与调度主链

## 1. 数据表与字段改动

迁移文件：
- [20260316_003_phase4_procurement_dispatch_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_up.sql)
- [20260316_003_phase4_procurement_dispatch_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_rollback.sql)

新增表：
- `buyer_accounts`：采购账户余额（`available_balance`、`frozen_balance`）
- `voyage_no_sequences`：航次号日序列

关键字段新增：
- `procurements`：
  - `buyer_account_id`
  - `dispatcher_user_id`
  - `submitted_at`
  - `sand_started_by`
  - `alert_sanding_timeout_at`
- `alerts`：
  - `stage_code`
  - `closure_required`
  - `closed_by`

关键约束：
- `voyages.procurement_id` 唯一（保障 `1 Voyage = 1 Procurement`）
- `alerts` 新增唯一约束：
  - `(related_entity_type, related_entity_id, stage_code, alert_type, is_void)`
  - 用于“同一采购单同一阶段只触发一次预警”

## 2. 接口设计

后端入口：
- [server.js](/D:/项目汇总/projects/apps/backend/src/server.js)

采购调度接口：
- [procurements.js](/D:/项目汇总/projects/apps/backend/src/routes/procurements.js)
  - `GET /api/procurements/ships/options`
  - `GET /api/procurements/buyer-accounts/options`
  - `POST /api/procurements`
    - 提交采购单 + 派船成功后自动创建 `Voyage`
    - 余额不足直接拒绝
    - 自动生成唯一 `voyage_no`
  - `GET /api/procurements`
    - 支持关键字搜索 + 状态筛选
    - 拉取列表时自动检测 `SANDING` 且超时的采购单并触发预警（幂等去重）
  - `GET /api/procurements/:id`
    - 返回基础信息、航次信息、作业信息、附件、预警、审计
    - 打开详情时自动补偿检测超时预警（幂等）
    - 非 `SUPER_ADMIN / FINANCE_MGMT` 自动掩码 `unit_price / total_amount`
  - `POST /api/procurements/:id/start-sanding`
    - 强制 `mining_ticket` + `quality_photos`
    - 记录 `sand_start_time`
  - `POST /api/procurements/:id/check-timeout`
    - 超过 `planned_duration_min` 触发预警
    - 同阶段预警去重

预警闭环接口：
- [alerts.js](/D:/项目汇总/projects/apps/backend/src/routes/alerts.js)
  - `POST /api/alerts/:id/close`
    - 强制处理说明
    - 写审计日志

## 3. 页面路径

新增页面：
- [列表页](/D:/项目汇总/projects/apps/mobile/pages/procurement/list/index.json)
  - `/pages/procurement/list/index`
- [创建页](/D:/项目汇总/projects/apps/mobile/pages/procurement/create/index.json)
  - `/pages/procurement/create/index`
- [详情页](/D:/项目汇总/projects/apps/mobile/pages/procurement/detail/index.json)
  - `/pages/procurement/detail/index?id={id}`

对应服务：
- [procurement service](/D:/项目汇总/projects/apps/mobile/services/procurement.js)

## 4. 事务边界

事务 1：`POST /api/procurements`
- 边界：采购创建、余额扣减、自动建航次、审计写入同一事务
- 回滚条件：任一步失败（余额不足、唯一冲突、写库失败）全部回滚

事务 2：`POST /api/procurements/:id/start-sanding`
- 边界：附件校验、状态流转、`sand_start_time` 写入、审计写入同一事务
- 回滚条件：附件不满足或写库失败

事务 3：`POST /api/procurements/:id/check-timeout`
- 边界：超时判断、预警插入（含去重）、审计写入同一事务
- 回滚条件：预警写入失败或审计失败

事务 3.1：`GET /api/procurements` 与 `GET /api/procurements/:id` 的自动超时检测
- 边界：超时判断 + 预警去重插入 + 审计写入同一事务
- 说明：用于保障“超过 `planned_duration_min` 自动触发预警”

事务 4：`POST /api/alerts/:id/close`
- 边界：闭环状态更新 + 审计写入同一事务
- 回滚条件：处理说明缺失或更新失败

## 5. 验收步骤

1. 执行数据库迁移：
   - `.\scripts\db-migrate-phase2.ps1 -Password '你的密码'`
   - `.\scripts\db-migrate-phase3.ps1 -Password '你的密码'`
   - `mysql -h 127.0.0.1 -P 3306 -u root -p sand_logistics < infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_up.sql`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm install`
   - `npm start`
3. 小程序启动并进入采购列表：
   - `cd D:\项目汇总\projects\apps\mobile`
   - `npm run check`
   - 在微信开发者工具打开项目
4. 按规则验收：
   - 提交采购单 + 派船后，自动生成 `voyage_no`
   - 采购详情可见 `voyage_no`
   - 余额不足时禁止提交
   - 未上传 `mining_ticket`/`quality_photos` 不能开始打沙
   - 开始打沙后记录 `sand_start_time`
   - 超时触发预警且同阶段只触发一次
   - 预警可闭环并写审计记录
