const { ROLE_CODES, SENSITIVE_FIELD_KEYS } = require("../constants/rbac");
const { displayFieldValue, canConfirmPayment, canSubmitLockedChangeApproval } = require("../utils/rbac");

const roleDataFactory = {
  [ROLE_CODES.SUPER_ADMIN]: () => ({
    title: "全局运营看板",
    todo: [
      { title: "待审核审批事项", value: 7, type: "warning" },
      { title: "待处理异常预警", value: 4, type: "danger" },
      { title: "系统审计告警", value: 1, type: "info" }
    ],
    alerts: [
      { title: "打沙超时预警", description: "VY-202603-012 已超时 38 分钟", level: "danger" },
      { title: "锁定态变更待审", description: "2 条关键变更待审批", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "审批中心", path: "/pages/alerts/alerts" },
      { title: "审计中心", path: "/pages/ui-kit/index" },
      { title: "采购调度列表", path: "/pages/procurement/list/index" }
    ],
    stats: [
      { label: "采购总额(当日)", value: 380000, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_TOTAL_AMOUNT },
      { label: "成本(当日)", value: 312000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_COST_AMOUNT },
      { label: "利润(当日)", value: 68000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_PROFIT_AMOUNT }
    ]
  }),
  [ROLE_CODES.DISPATCHER]: () => ({
    title: "采购/调度工作台",
    todo: [
      { title: "待派船采购单", value: 6, type: "warning" },
      { title: "作业中采购单", value: 5, type: "info" },
      { title: "打沙超时预警", value: 2, type: "danger" }
    ],
    alerts: [
      { title: "超时预警", description: "PR-20260316-009 超时 22 分钟", level: "danger" },
      { title: "定位异常", description: "海兴 12 号定位延迟 > 24h", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "待派船采购单", path: "/pages/procurement/list/index" },
      { title: "作业中采购单", path: "/pages/procurement/list/index" },
      { title: "船舶定位入口", path: "/pages/ship/list/index" }
    ],
    stats: [
      { label: "采购单价(示例)", value: 125.8, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_UNIT_PRICE },
      { label: "采购总额(示例)", value: 258000, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_TOTAL_AMOUNT },
      { label: "待处理航次", value: 9 }
    ]
  }),
  [ROLE_CODES.ONSITE_SPECIALIST]: () => ({
    title: "现场/过驳工作台",
    todo: [
      { title: "待过驳", value: 4, type: "warning" },
      { title: "待卸空确认", value: 3, type: "danger" },
      { title: "待入库确认", value: 5, type: "info" },
      { title: "待录费用", value: 6, type: "warning" }
    ],
    alerts: [
      { title: "入库超时", description: "批次 BT-20260316-02 待确认", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "现场待办", path: "/pages/onsite/tasks/index" },
      { title: "入库确认", path: "/pages/onsite/tasks/index" },
      { title: "费用录入", path: "/pages/onsite/expense-create/index" }
    ],
    stats: [
      { label: "成本(示例)", value: 52000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_COST_AMOUNT },
      { label: "今日已确认入库", value: 7 },
      { label: "未补凭证", value: 3 }
    ]
  }),
  [ROLE_CODES.SALES]: () => ({
    title: "销售工作台",
    todo: [
      { title: "可售批次", value: 18, type: "info" },
      { title: "待补价订单", value: 4, type: "warning" },
      { title: "待上传磅单", value: 5, type: "danger" }
    ],
    alerts: [
      { title: "库存紧张", description: "2 个热门批次余量低于阈值", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "销售订单列表", path: "/pages/sales/orders/index" },
      { title: "新建销售单", path: "/pages/sales/create/index" },
      { title: "可售批次", path: "/pages/sales/batches/index" }
    ],
    stats: [
      { label: "采购单价(示例)", value: 119.6, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_UNIT_PRICE },
      { label: "利润(示例)", value: 24000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_PROFIT_AMOUNT },
      { label: "今日成交单", value: 8 }
    ]
  }),
  [ROLE_CODES.FINANCE_MGMT]: () => ({
    title: "财务/管理工作台",
    todo: [
      { title: "待差异确认", value: 3, type: "warning" },
      { title: "待确认收款", value: 6, type: "danger" },
      { title: "待审批事项", value: 5, type: "info" }
    ],
    alerts: [
      { title: "应收逾期", description: "2 笔 Final AR 未回款", level: "danger" },
      { title: "版本修订待审", description: "航次 VY-202603-008 待审批", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "差异确认", path: "/pages/finance/pending/index" },
      { title: "确认收款", path: "/pages/finance/pending/index" },
      { title: "利润分析入口", path: "/pages/ui-kit/index" }
    ],
    stats: [
      { label: "采购总额(当日)", value: 316000, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_TOTAL_AMOUNT },
      { label: "成本(当日)", value: 281000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_COST_AMOUNT },
      { label: "利润(当日)", value: 35000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_PROFIT_AMOUNT }
    ]
  })
};

function formatDisplayStats(stats, roleCode) {
  return stats.map((item) => {
    if (!item.fieldKey) {
      return item;
    }
    return {
      ...item,
      value: displayFieldValue(item.fieldKey, item.value, roleCode)
    };
  });
}

function getWorkbenchAggregateByRole(roleCode) {
  const builder = roleDataFactory[roleCode] || roleDataFactory[ROLE_CODES.DISPATCHER];
  const payload = builder();
  return {
    roleCode,
    title: payload.title,
    todo: payload.todo,
    alerts: payload.alerts,
    quickEntries: payload.quickEntries,
    stats: formatDisplayStats(payload.stats, roleCode),
    permissions: {
      canConfirmPayment: canConfirmPayment(roleCode),
      lockedChangeRequiresApproval: canSubmitLockedChangeApproval(roleCode),
      auditLogDeletable: false
    },
    serverTime: new Date().toISOString()
  };
}

module.exports = {
  getWorkbenchAggregateByRole
};
