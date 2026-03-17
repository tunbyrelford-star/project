const { getLighteringDetail, confirmLighteringEmpty } = require("../../../services/onsite");

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
    confirming: false,
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
    wx.navigateTo({ url: "/pages/onsite/lightering-list/index" });
  },

  onGoVoyage() {
    const voyageId = Number((this.data.detail && this.data.detail.voyageId) || 0);
    if (!voyageId) {
      wx.showToast({ title: "No voyage info", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/voyage/detail/index?id=${voyageId}` });
  },

  onConfirmEmpty() {
    if (this.data.confirming) return;
    const detail = this.data.detail || {};
    if (!detail.canConfirmEmpty) {
      wx.showToast({ title: "Current status cannot confirm", icon: "none" });
      return;
    }

    this.setData({ confirming: true });
    confirmLighteringEmpty(this.data.id, { note: "Confirm from lightering detail." })
      .then((res) => {
        wx.showToast({ title: (res && res.message) || "Confirmed", icon: "none" });
        this.loadDetail();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || "Operation failed", icon: "none" });
      })
      .finally(() => {
        this.setData({ confirming: false });
      });
  },

  onPrimaryAction() {
    const detail = this.data.detail || {};
    if (detail.canConfirmEmpty) {
      this.onConfirmEmpty();
      return;
    }
    this.onGoVoyage();
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getLighteringDetail(this.data.id)
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
