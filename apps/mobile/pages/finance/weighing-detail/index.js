const { getWeighingSlipDetail } = require("../../../services/finance");

function auditNote(value) {
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
    id: 0,
    loading: true,
    showError: false,
    detail: null,
    items: [],
    audits: []
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (!id) {
      wx.showToast({ title: "Invalid id", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onToList() {
    wx.navigateTo({ url: "/pages/finance/weighing-list/index" });
  },

  onGoEntry() {
    const orderId = Number((this.data.detail && this.data.detail.salesOrderId) || 0);
    if (!orderId) {
      wx.showToast({ title: "No sales order id", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/finance/weighing/index?orderId=${orderId}` });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getWeighingSlipDetail(this.data.id)
      .then((res) => {
        this.setData({
          loading: false,
          detail: res.detail || null,
          items: res.items || [],
          audits: (res.audits || []).map((item) => ({
            action: item.action,
            actor: item.actorUserId ? `User#${item.actorUserId}` : "System",
            time: item.eventTime,
            note: auditNote(item.afterData || item.beforeData || "")
          }))
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

