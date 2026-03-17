const { fetchOrderCenterSummary } = require("../../../services/order-center");
const { PERMISSION_CODES } = require("../../../constants/rbac");
const { hasPermission, getCurrentRoleCode } = require("../../../utils/rbac");
const { navigateByUrl } = require("../../../utils/navigation");

const ENTRY_DEFINITIONS = [
  {
    key: "procurement",
    name: "Procurement",
    description: "Create and manage procurement orders.",
    path: "/pages/procurement/list/index",
    counterKey: "procurement",
    sourceKey: "procurement",
    permissionAny: [PERMISSION_CODES.MENU_PROCUREMENT]
  },
  {
    key: "voyage",
    name: "Voyage",
    description: "Track voyage-level order progress.",
    path: "/pages/voyage/voyage",
    counterKey: "voyage",
    sourceKey: "procurement",
    permissionAny: [PERMISSION_CODES.MENU_PROCUREMENT]
  },
  {
    key: "lightering",
    name: "Lightering",
    description: "Handle lightering tasks and follow-ups.",
    path: "/pages/onsite/lightering-list/index",
    counterKey: "lightering",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_LIGHTERING]
  },
  {
    key: "stockIn",
    name: "Stock-In",
    description: "Confirm stock-in orders from onsite flow.",
    path: "/pages/onsite/stockin-list/index",
    counterKey: "stockIn",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_STOCK_IN]
  },
  {
    key: "salesOrder",
    name: "Sales Order",
    description: "Manage sales orders and line items.",
    path: "/pages/sales/orders/index",
    counterKey: "salesOrder",
    sourceKey: "sales",
    permissionAny: [PERMISSION_CODES.MENU_SALES]
  },
  {
    key: "weighingSlip",
    name: "Weighing Slip",
    description: "Enter and confirm weighing documents.",
    path: "/pages/finance/weighing-list/index",
    counterKey: "weighingSlip",
    sourceKey: "finance",
    permissionAny: [PERMISSION_CODES.API_WEIGHING_UPLOAD, PERMISSION_CODES.MENU_FINANCE]
  },
  {
    key: "paymentOrder",
    name: "Payment",
    description: "Confirm receivables and payment closure.",
    path: "/pages/finance/payment-list/index",
    counterKey: "paymentOrder",
    sourceKey: "finance",
    permissionAny: [PERMISSION_CODES.ACTION_PAYMENT_CONFIRM, PERMISSION_CODES.MENU_FINANCE]
  },
  {
    key: "expense",
    name: "Expense",
    description: "Create and process expense documents.",
    path: "/pages/onsite/expense-list/index",
    counterKey: "expense",
    sourceKey: "onsite",
    permissionAny: [PERMISSION_CODES.MENU_EXPENSE]
  }
];

function formatTimeText(isoString) {
  if (!isoString) return "Updated: -";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Updated: -";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `Updated: ${y}-${m}-${d} ${hh}:${mm}`;
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
      updatedAtText: "Updated: -"
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
      wx.showToast({ title: "No permission for this entry", icon: "none" });
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
            actionText: enabled ? "Open" : "No Access"
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
          actionText: permissionMap[entry.key] ? "Open" : "No Access"
        }));

        const visibleEntries = entries.filter((item) => item.enabled);
        this.setData({
          loading: false,
          showError: true,
          entries,
          summary: {
            moduleCount: visibleEntries.length,
            totalTodo: 0,
            updatedAtText: "Updated: -"
          }
        });
      });
  }
});
