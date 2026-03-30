const { ROLE_CODES, SENSITIVE_FIELD_KEYS } = require("../constants/rbac");
const {
  displayFieldValue,
  canConfirmPayment,
  canSubmitLockedChangeApproval
} = require("../utils/rbac");

const roleDataFactory = {
  [ROLE_CODES.SUPER_ADMIN]: () => ({
    title: "超级管理员工作台",
    todo: [
      { title: "待审批事项", value: 7, type: "warning" },
      { title: "待处理异常", value: 4, type: "danger" },
      { title: "待确认收款", value: 1, type: "info" }
    ],
    alerts: [
      { title: "打砂超时预警", description: "VY-202603-012 已超时 38 分钟", level: "danger" },
      { title: "锁定态变更待审", description: "2 条关键变更需要审批", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "预警中心", path: "/pages/alerts/index" },
      { title: "审批中心", path: "/pages/governance/approval-list/index" },
      { title: "采购单列表", path: "/pages/procurement/list/index" }
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
      { title: "打砂超时预警", value: 2, type: "danger" }
    ],
    alerts: [
      { title: "采购超时", description: "PR-20260316-009 已超时 22 分钟", level: "danger" },
      { title: "定位异常", description: "船舶在线状态异常 > 24h", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "采购单列表", path: "/pages/procurement/list/index" },
      { title: "船舶管理", path: "/pages/ship/list/index" },
      { title: "预警中心", path: "/pages/alerts/index" }
    ],
    stats: [
      { label: "采购单价(均值)", value: 125.8, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_UNIT_PRICE },
      { label: "采购总额(当日)", value: 258000, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_TOTAL_AMOUNT },
      { label: "作业中航次", value: 9 }
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
      { title: "入库待确认", description: "批次 BT-20260316-02 待入库", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "现场待办", path: "/pages/onsite/tasks/index" },
      { title: "费用录入", path: "/pages/onsite/expense-create/index" },
      { title: "预警中心", path: "/pages/alerts/index" }
    ],
    stats: [
      { label: "现场成本(当日)", value: 52000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_COST_AMOUNT },
      { label: "异常待处理", value: 7 },
      { label: "待审批", value: 3 }
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
      { title: "订单差异待确认", description: "2 个订单存在吨数差异", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "销售订单", path: "/pages/sales/orders/index" },
      { title: "新建销售单", path: "/pages/sales/create/index" },
      { title: "可售批次", path: "/pages/sales/batches/index" }
    ],
    stats: [
      { label: "销售单价(均值)", value: 119.6, fieldKey: SENSITIVE_FIELD_KEYS.PROCUREMENT_UNIT_PRICE },
      { label: "利润(当日)", value: 24000, fieldKey: SENSITIVE_FIELD_KEYS.VOYAGE_PROFIT_AMOUNT },
      { label: "待回款订单", value: 8 }
    ]
  }),
  [ROLE_CODES.FINANCE_MGMT]: () => ({
    title: "财务/管理层工作台",
    todo: [
      { title: "待差异确认", value: 3, type: "warning" },
      { title: "待确认收款", value: 6, type: "danger" },
      { title: "待审批事项", value: 5, type: "info" }
    ],
    alerts: [
      { title: "收款风险", description: "2 条 FINAL_AR 仍未回款", level: "danger" },
      { title: "利润异常波动", description: "航次 VY-202603-008 利润异常", level: "warning" }
    ],
    quickEntries: [
      { title: "订单中心", path: "/pages/orders/center/index" },
      { title: "财务确认", path: "/pages/finance/pending/index" },
      { title: "收款确认", path: "/pages/finance/payment-list/index" },
      { title: "报表分析", path: "/pages/governance/report/index" }
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
    if (!item.fieldKey) return item;
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
