const { getPaymentDetail, reversePayment } = require("../../../services/finance");

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
    reversing: false,
    reversalReason: "",
    detail: null,
    receipt: null,
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

  onReasonInput(event) {
    this.setData({ reversalReason: event.detail.value || "" });
  },

  onToList() {
    wx.navigateTo({ url: "/pages/finance/payment-list/index" });
  },

  onGoConfirmPage() {
    const orderId = Number((this.data.detail && this.data.detail.salesOrderId) || 0);
    if (!orderId) {
      wx.showToast({ title: "No sales order id", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/finance/payment/index?orderId=${orderId}` });
  },

  onReverse() {
    const detail = this.data.detail || {};
    if (!detail.canReverse) {
      wx.showToast({ title: "Current payment cannot reverse", icon: "none" });
      return;
    }
    const reason = String(this.data.reversalReason || "").trim();
    if (!reason) {
      wx.showToast({ title: "Please input reversal reason", icon: "none" });
      return;
    }
    if (this.data.reversing) return;

    wx.showModal({
      title: "Confirm reversal",
      content: "A reversal record will be created. Continue?",
      confirmText: "Confirm",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ reversing: true });
        reversePayment(this.data.id, { reason })
          .then(() => {
            wx.showToast({ title: "Reversal completed", icon: "success" });
            this.setData({ reversalReason: "" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "Reversal failed", icon: "none" });
          })
          .finally(() => {
            this.setData({ reversing: false });
          });
      }
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getPaymentDetail(this.data.id)
      .then((res) => {
        this.setData({
          loading: false,
          detail: res.detail || null,
          receipt: res.receipt || null,
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

