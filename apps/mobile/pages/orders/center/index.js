const { fetchOrderCenterSummary } = require("../../../services/order-center");
const { PERMISSION_CODES } = require("../../../constants/rbac");
const { hasPermission, getCurrentRoleCode } = require("../../../utils/rbac");
const { navigateByUrl } = require("../../../utils/navigation");

const ENTRY_DEFINITIONS = [
  {
    key: "procurement",
    name: "采购单",
    description: "创建并管理采购单据。",
    path: "/pages/procurement/list/index",
    counterKey: "procurement",
    sourceKey: "procurement",
    permissionAny: [PERMISSION_CODES.MENU_PROCUREMENT]
  },
  {
    key: "voyage",
    name: "航次单",
    description: "跟踪航次单据进度。",
    path: "/pages/voyage/voyage",
    counterKey: "voyage",
    sourceKey: "procurement",
    permissionAny: [PERMISSION_CODES.MENU_PROCUREMENT]
  },
  {
    key: "lightering",
    name: "过驳单",
    description: "处理过驳任务及后续跟进。",
    path: "/pages/onsite/lightering-list/index",
    counterKey: "lightering",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_LIGHTERING]
  },
  {
    key: "stockIn",
    name: "入库单",
    description: "确认现场流程产生的入库单。",
    path: "/pages/onsite/stockin-list/index",
    counterKey: "stockIn",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_STOCK_IN]
  },
  {
    key: "salesOrder",
    name: "销售订单",
    description: "管理销售订单及明细项。",
    path: "/pages/sales/orders/index",
    counterKey: "salesOrder",
    sourceKey: "sales",
    permissionAny: [PERMISSION_CODES.MENU_SALES]
  },
  {
    key: "weighingSlip",
    name: "磅单",
    description: "录入并确认磅单数据。",
    path: "/pages/finance/weighing-list/index",
    counterKey: "weighingSlip",
    sourceKey: "finance",
    permissionAny: [PERMISSION_CODES.API_WEIGHING_UPLOAD, PERMISSION_CODES.MENU_FINANCE]
  },
  {
    key: "paymentOrder",
    name: "收款单",
    description: "确认应收回款并完成收款闭环。",
    path: "/pages/finance/payment-list/index",
    counterKey: "paymentOrder",
    sourceKey: "finance",
    permissionAny: [PERMISSION_CODES.ACTION_PAYMENT_CONFIRM, PERMISSION_CODES.MENU_FINANCE]
  },
  {
    key: "expense",
    name: "费用单",
    description: "录入并处理费用单据。",
    path: "/pages/onsite/expense-list/index",
    counterKey: "expense",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_EXPENSE]
  }
];

function formatTimeText(isoString) {
  if (!isoString) return "更新时间：-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "更新时间：-";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `更新时间：${y}-${m}-${d} ${hh}:${mm}`;
}

function toCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

Page({
  data: {
    loading: true,
    showError: false,
    roleCode: "",
    entries: [],
    summary: {
      moduleCount: 0,
      totalTodo: 0,
      updatedAtText: "更新时间：-"
    }
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadData();
  },

  onTapEntry(event) {
    const path = String(event.currentTarget.dataset.path || "");
    const enabled = Number(event.currentTarget.dataset.enabled || 0) === 1;
    if (!enabled) {
      wx.showToast({ title: "当前入口无权限", icon: "none" });
      return;
    }
    if (!path) return;
    navigateByUrl(path);
  },

  buildPermissionMap() {
    const permissionMap = {};
    ENTRY_DEFINITIONS.forEach((entry) => {
      const list = entry.permissionAny || [];
      permissionMap[entry.key] = list.some((code) => hasPermission(code));
    });
    return permissionMap;
  },

  loadData() {
    const permissionMap = this.buildPermissionMap();
    const fetchFlags = {
      procurementEnabled: Boolean(permissionMap.procurement || permissionMap.voyage),
      onsiteEnabled: Boolean(permissionMap.lightering || permissionMap.stockIn || permissionMap.expense),
      salesEnabled: Boolean(permissionMap.salesOrder),
      financeEnabled: Boolean(permissionMap.weighingSlip || permissionMap.paymentOrder)
    };

    this.setData({
      loading: true,
      showError: false,
      roleCode: getCurrentRoleCode()
    });

    return fetchOrderCenterSummary(fetchFlags)
      .then((res) => {
        const counters = (res && res.counters) || {};
        const sources = (res && res.source) || {};

        const entries = ENTRY_DEFINITIONS.map((entry) => {
          const enabled = Boolean(permissionMap[entry.key]);
          const fetchOk = sources[entry.sourceKey] !== "failed";
          const count = enabled && fetchOk ? toCount(counters[entry.counterKey]) : 0;
          return {
            ...entry,
            enabled,
            fetchOk,
            todoCount: count,
            todoText: enabled ? (fetchOk ? String(count) : "-") : "--",
            todoTone: !enabled || !fetchOk ? "default" : count > 0 ? "warning" : "success",
            actionText: enabled ? "进入" : "无权限"
          };
        });

        const visibleEntries = entries.filter((item) => item.enabled);
        const totalTodo = visibleEntries.reduce(
          (sum, item) => (item.fetchOk ? sum + toCount(item.todoCount) : sum),
          0
        );

        this.setData({
          loading: false,
          showError: false,
          entries,
          summary: {
            moduleCount: visibleEntries.length,
            totalTodo,
            updatedAtText: formatTimeText(res && res.updatedAt)
          }
        });
      })
      .catch(() => {
        const entries = ENTRY_DEFINITIONS.map((entry) => ({
          ...entry,
          enabled: Boolean(permissionMap[entry.key]),
          todoCount: 0,
          todoText: permissionMap[entry.key] ? "-" : "--",
          todoTone: "default",
          actionText: permissionMap[entry.key] ? "进入" : "无权限"
        }));

        const visibleEntries = entries.filter((item) => item.enabled);
        this.setData({
          loading: false,
          showError: true,
          entries,
          summary: {
            moduleCount: visibleEntries.length,
            totalTodo: 0,
            updatedAtText: "更新时间：-"
          }
        });
      });
  }
});
