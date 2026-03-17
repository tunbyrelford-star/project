const { getSalesOrderDetail } = require("../../../services/sales");

function statusTagType(status) {
  const code = String(status || "").toUpperCase();
  if (code === "LOCKED_STOCK" || code === "COMPLETED") return "success";
  if (code === "PENDING_CONFIRM" || code === "PENDING_FINAL_QTY_CONFIRM" || code === "READY_FOR_PAYMENT_CONFIRM") {
    return "warning";
  }
  if (code === "UNPAID" || code === "VOID") return "danger";
  return "info";
}

function toAuditNote(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

Page({
  data: {
    id: null,
    loading: true,
    showError: false,
    order: null,
    lineItems: [],
    weighingSlips: [],
    payments: [],
    audits: [],
    costVisible: false
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onShow() {
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onEdit() {
    if (!this.data.order || !this.data.order.editable) {
      wx.showToast({ title: "当前状态不允许编辑", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/sales/create/index?id=${this.data.id}` });
  },

  onToList() {
    wx.navigateTo({ url: "/pages/sales/orders/index" });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getSalesOrderDetail(this.data.id)
      .then((res) => {
        const order = res.order || {};
        const audits = (res.audits || []).map((item) => ({
          action: item.action,
          actor: item.actorUserId ? `用户#${item.actorUserId}` : "系统",
          time: item.eventTime,
          note: toAuditNote(item.afterData || item.beforeData || "")
        }));

        this.setData({
          order: {
            ...order,
            statusType: statusTagType(order.statusTag || order.status),
            arType: statusTagType(order.arStatus),
            receiptType: statusTagType(order.receiptStatus)
          },
          lineItems: res.lineItems || [],
          weighingSlips: res.weighingSlips || [],
          payments: res.payments || [],
          audits,
          costVisible: Boolean(res.costVisible),
          loading: false
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
