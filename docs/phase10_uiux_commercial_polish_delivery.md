# 阶段 10 交付：整体商业化 UI/UX 收口

## 1. 优化前后对比

| 维度 | 优化前 | 优化后 |
| --- | --- | --- |
| 页面信息层级 | 标题、筛选、内容区的层级弱，列表与详情页的视觉节奏不统一 | `page-shell` 统一头部层级、筛选区节奏、骨架加载；卡片区间距和内容分段统一 |
| 卡片与状态标签 | 卡片样式偏“基础组件态”，状态标签语义和边框表现不一致 | `business-card` 统一顶部强调条、标题层级、自动状态色；`status-tag` 增加边框/点标语义 |
| 表单分组布局 | 多页面表单高度、标签字号、输入框边距不一致 | 统一 `form-row / form-label / form-input / picker` 尺寸与间距，提升录入效率 |
| 详情页分段 | 字段行分隔和按钮区样式差异较大 | 统一字段行高度、虚线分隔、重点值加权、操作按钮热区 |
| 异常与预警视觉 | 差异提示、禁用原因、预警提示样式分散 | 统一为 warning/danger banner 视觉语义，减少认知成本 |
| 审批/版本/审计展示 | 时间轴、对比区、查询区风格存在差异 | 统一审批对比卡、时间轴卡片化、版本列表与报表明细节奏 |
| 空态/错态/加载态 | 反馈样式基础，页面观感偏“开发态” | 空态与错误态统一图形语言；加载态改为骨架块，降低等待焦虑 |
| 底部固定操作与单手体验 | 底部栏占位不足，按钮热区偏小 | `bottom-action-bar` 增加安全区占位、提示文案、80rpx 级按钮热区 |
| 遗留页面一致性 | `alerts` / `voyage` 为旧式页面，风格割裂 | 两页升级为统一骨架（shell + card + status），与主链一致 |

## 2. 设计规范摘要

### 2.1 视觉基线
- 主色：`#0B3B66`（稳重商务蓝）
- 页面底色：`#F3F5F8`，卡片底色：`#FFFFFF`
- 语义色：
  - success：`#1F7A4F`
  - warning：`#B25A12`
  - danger：`#B42318`
  - info：`#1F5FCA`

### 2.2 字体与间距
- 字号：`22/24/26/30/36 rpx` 分层
- 行高：`tight/normal/relaxed`
- 统一间距梯度：`8/12/16/20/24/32/40/48 rpx`

### 2.3 交互尺寸
- 常规点击热区：`>=72rpx`
- 关键操作按钮：`>=80rpx`
- 底部栏自动安全区补偿，支持单手操作

### 2.4 结构规范
- 列表页：筛选栏 -> 统计/快捷区 -> 卡片列表 -> 固定底部主操作
- 详情页：基础信息 -> 业务核心 -> 异常/附件 -> 审计/版本
- 表单页：分组卡片 + 明确 label + 统一输入高度 + 固定底部提交

### 2.5 风险与异常规范
- warning/danger 统一 banner 样式
- 不可操作状态必须给出禁用原因
- 审批/审计/版本以“可追溯”为核心表达

## 3. 复用组件清单

已升级公共组件：
- `components/common/page-shell`
- `components/common/business-card`
- `components/common/status-tag`
- `components/common/top-filter-bar`
- `components/common/bottom-action-bar`
- `components/common/empty-state`
- `components/common/error-state`
- `components/common/attachment-uploader`
- `components/common/audit-timeline`
- `components/common/approval-diff`

已统一的全局样式基础：
- `styles/tokens.wxss`
- `styles/base.wxss`

已应用收口的页面范围：
- 首页：`pages/index/index`
- 采购：`pages/procurement/list|create|detail`
- 现场：`pages/onsite/tasks|stockin-confirm|expense-create`
- 销售：`pages/sales/batches|create|detail`
- 财务：`pages/finance/pending|weighing|confirm|payment`
- 船舶：`pages/ship/list|detail`
- 治理：`pages/governance/approval-list|approval-detail|version-history|audit|report`
- 遗留页：`pages/alerts/alerts`、`pages/voyage/voyage`

## 4. 验收步骤

1. 打开小程序开发者工具，编译项目并确认无 JSON/JS 报错。
2. 验收页面层级：检查各页面头部、筛选区、卡片区、底部操作区是否统一。
3. 验收交互热区：列表主操作、底部主按钮、筛选按钮可单手点击，不误触。
4. 验收异常视觉：差异提示、禁用原因、预警信息均为统一 warning/danger 语义。
5. 验收治理链路：审批详情、版本历史、审计记录、报表追溯风格统一且信息完整。
6. 验收遗留页：`alerts` 与 `voyage` 页面已切换到统一骨架，无旧式样式割裂。
7. 回归业务规则：确认本阶段仅 UI/UX 收口，未改数据库口径、未改业务规则。
