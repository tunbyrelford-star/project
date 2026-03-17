const { getExpenseDetail } = require("../../../services/onsite");

function auditNote(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function toFiles(urls) {
  return (urls || []).map((path, idx) => ({
    name: `voucher_${idx + 1}`,
    path,
    size: 0
  }));
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    detail: null,
    audits: [],
    files: []
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
    wx.navigateTo({ url: "/pages/onsite/expense-list/index" });
  },

  onCreateWithVoyage() {
    const voyageId = Number((this.data.detail && this.data.detail.voyageId) || 0);
    if (!voyageId) {
      wx.navigateTo({ url: "/pages/onsite/expense-create/index" });
      return;
    }
    wx.navigateTo({ url: `/pages/onsite/expense-create/index?voyageId=${voyageId}` });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getExpenseDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || null;
        this.setData({
          loading: false,
          detail,
          files: toFiles((detail && detail.voucherUrls) || []),
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

