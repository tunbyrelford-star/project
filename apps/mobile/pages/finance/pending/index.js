const { listPendingConfirmOrders } = require("../../../services/finance");

const ACTION_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "ENTER_WEIGHING", label: "待录磅单" },
  { key: "FINANCE_CONFIRM", label: "待财务确认" },
  { key: "CONFIRM_PAYMENT", label: "待确认收款" }
];

function toFixedNum(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

function tagTypeByAction(action) {
  if (action === "CONFIRM_PAYMENT") return "danger";
  if (action === "FINANCE_CONFIRM") return "warning";
  if (action === "ENTER_WEIGHING") return "info";
  return "success";
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    activeAction: "ALL",
    filters: ACTION_FILTERS,
    list: [],
    stats: {
      total: 0,
      waitWeighing: 0,
      waitFinanceConfirm: 0,
      waitPayment: 0
    }
  },

  onLoad(options) {
    const action = String((options && options.action) || "").trim().toUpperCase();
    const supported = ACTION_FILTERS.some((item) => item.key === action);
    if (supported) {
      this.setData({ activeAction: action });
    }
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadList();
  },

  onFilterChange(event) {
    this.setData({ activeAction: event.detail.key || "ALL" });
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onTapAction(event) {
    const orderId = Number(event.currentTarget.dataset.orderId || 0);
    const nextAction = String(event.currentTarget.dataset.nextAction || "");
    if (!orderId) return;

    if (nextAction === "ENTER_WEIGHING") {
      wx.navigateTo({ url: `/pages/finance/weighing/index?orderId=${orderId}` });
      return;
    }
    if (nextAction === "FINANCE_CONFIRM") {
      wx.navigateTo({ url: `/pages/finance/confirm/index?orderId=${orderId}` });
      return;
    }
    if (nextAction === "CONFIRM_PAYMENT") {
      wx.navigateTo({ url: `/pages/finance/payment/index?orderId=${orderId}` });
      return;
    }
    wx.navigateTo({ url: `/pages/sales/detail/index?id=${orderId}` });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    return listPendingConfirmOrders({
      keyword: this.data.keyword,
      action: this.data.activeAction
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          deltaQtyDisplay: item.deltaQty == null ? "-" : toFixedNum(item.deltaQty, 3),
          diffText: item.diffFlag ? "存在差异" : "无差异",
          diffType: item.diffFlag ? "warning" : "success",
          nextActionType: tagTypeByAction(item.nextAction)
        }));
        this.setData({
          loading: false,
          list,
          stats: res.stats || this.data.stats
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
