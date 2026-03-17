# 阶段 5 交付：船舶定位模块

## 1. 数据表/字段改动

迁移文件：
- [20260316_004_phase5_ship_position_up.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_004_phase5_ship_position_up.sql)
- [20260316_004_phase5_ship_position_rollback.sql](/D:/项目汇总/projects/infra/mysql/migrations/20260316_004_phase5_ship_position_rollback.sql)

改动摘要：
- 保障 `ships.mmsi` 全局唯一（唯一索引 `uk_ships_mmsi`）
- `ships.last_position_time` 作为列表展示字段
- 新增 `ship_position_latest`：保存每船最新定位快照（在线状态、坐标、港口、停港时长、定位时间）
- 新增 `ship_frequent_ports`：统计常去港口（访问次数、最近访问时间）
- 新增 `ship_position_provider_logs`：记录第三方调用日志（成功/失败、耗时、状态码、错误摘要）

## 2. 接口设计

后端路由：
- [ships.js](/D:/项目汇总/projects/apps/backend/src/routes/ships.js)

接口清单：
- `GET /api/ships`
  - 列表查询，支持 `keyword`、`status`、`onlineStatus` 筛选
  - 返回：船名、MMSI、状态、最后定位时间、停港时长、常去港口
- `GET /api/ships/:id`
  - 详情基础信息（含最近一次定位摘要与常去港口 Top5）
- `GET /api/ships/mmsi/:mmsi/realtime-position?forceRefresh=0|1`
  - 通过 `mmsi` 获取实时定位（前端只调后端）
  - 支持手动强制刷新
  - 返回缓存命中/回退信息

## 3. 页面结构

页面路径：
- 船舶列表：`/pages/ship/list/index`
- 船舶详情：`/pages/ship/detail/index?mmsi={mmsi}&id={id}`

实现文件：
- 列表页：
  - [index.js](/D:/项目汇总/projects/apps/mobile/pages/ship/list/index.js)
  - [index.wxml](/D:/项目汇总/projects/apps/mobile/pages/ship/list/index.wxml)
- 详情页：
  - [index.js](/D:/项目汇总/projects/apps/mobile/pages/ship/detail/index.js)
  - [index.wxml](/D:/项目汇总/projects/apps/mobile/pages/ship/detail/index.wxml)
- 服务层：
  - [ship.js](/D:/项目汇总/projects/apps/mobile/services/ship.js)

页面结构说明：
- 列表页：
  - 顶部搜索 + 筛选
  - 中部卡片：船名、MMSI、状态、在线状态、最后定位时间、停港时长、常去港口
  - 行为按钮：查看定位
- 详情页：
  - 顶部状态卡片
  - 地图区（`map`）
  - 更新时间与坐标信息块
  - 刷新按钮（底部固定）
  - 定位失败重试态

## 4. 缓存逻辑

缓存实现：
- 代码位置：[ships.js](/D:/项目汇总/projects/apps/backend/src/routes/ships.js)
- 缓存键：`mmsi`
- Fresh TTL：`SHIP_POSITION_TTL_MS`（默认 60s）
- Fallback TTL：`SHIP_POSITION_FALLBACK_TTL_MS`（默认 30min）

读取流程：
1. 若命中 Fresh TTL，直接返回 `HIT_TTL`
2. 未命中则调用第三方（或模拟提供方）
3. 第三方成功：
   - 更新 `ship_position_latest`
   - 更新 `ships.last_position_time`
   - 更新 `ship_frequent_ports`
   - 写 `ship_position_provider_logs`
   - 刷新内存 Fresh + Fallback 缓存
4. 第三方失败：
   - 先读内存 Fallback（`FALLBACK_MEMORY`）
   - 再读数据库最新快照（`FALLBACK_DB`）
   - 都没有则返回 502

## 5. 验收步骤

1. 执行数据库迁移：
   - `.\scripts\db-migrate-phase2.ps1 -Password '你的密码'`
   - `.\scripts\db-migrate-phase3.ps1 -Password '你的密码'`
   - `.\scripts\db-migrate-phase4.ps1 -Password '你的密码'`
   - `.\scripts\db-migrate-phase5.ps1 -Password '你的密码'`
2. 启动后端：
   - `cd D:\项目汇总\projects\apps\backend`
   - `npm install`
   - `npm start`
3. 启动小程序：
   - `cd D:\项目汇总\projects\apps\mobile`
   - `npm run check`
   - 微信开发者工具打开项目
4. 功能验收：
   - 船舶列表可按关键字和筛选条件查询
   - 列表展示 `last_position_time`、停港时长、常去港口
   - 详情页可按 `mmsi` 拉取定位，刷新按钮可用
   - 第三方异常时可回退缓存（接口返回 `cache.fromFallback=true`）
   - `ship_position_provider_logs` 可看到调用日志
