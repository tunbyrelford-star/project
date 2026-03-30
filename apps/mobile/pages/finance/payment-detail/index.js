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

function methodLabel(code) {
  if (code === "BANK_TRANSFER") return "银行转账";
  if (code === "CASH") return "现金";
  if (code === "OTHER") return "其他";
  return code || "-";
}

function statusText(code) {
  const value = String(code || "").toUpperCase();
  if (value === "CONFIRMED") return "已确认";
  if (value === "PENDING") return "待确认";
  if (value === "VOID") return "已作废";
  return value || "-";
}

function arStatusText(code) {
  const value = String(code || "").toUpperCase();
  if (value === "FINAL_AR") return "最终应收";
  if (value === "ESTIMATED_AR") return "预估应收";
  return value || "-";
}

function typeText(detail) {
  return detail && detail.isReversal ? "冲正" : "正常";
}

function receiptStatusText(code) {
  const value = String(code || "").toUpperCase();
  if (value === "CONFIRMED") return "已确认";
  if (value === "PENDING") return "待处理";
  return value || "-";
}

function auditActionText(action) {
  const code = String(action || "").toUpperCase();
  if (code === "PAYMENT_CONFIRMED") return "收款已确认";
  if (code === "PAYMENT_REVERSED") return "收款已冲正";
  if (code === "PAYMENT_CREATED") return "收款单已创建";
  return action || "-";
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
      wx.showToast({ title: "收款单参数错误", icon: "none" });
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
      wx.showToast({ title: "缺少订单标识", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/finance/payment/index?orderId=${orderId}` });
  },

  onReverse() {
    const detail = this.data.detail || {};
    if (!detail.canReverse) {
      wx.showToast({ title: "当前收款不可冲正", icon: "none" });
      return;
    }
    const reason = String(this.data.reversalReason || "").trim();
    if (!reason) {
      wx.showToast({ title: "请填写冲正原因", icon: "none" });
      return;
    }
    if (this.data.reversing) return;

    wx.showModal({
      title: "确认冲正",
      content: "将新增冲正记录，原收款记录保持不变。是否继续？",
      confirmText: "确认冲正",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ reversing: true });
        reversePayment(this.data.id, { reason })
          .then(() => {
            wx.showToast({ title: "冲正完成", icon: "success" });
            this.setData({ reversalReason: "" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "冲正失败", icon: "none" });
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
        const detail = res.detail || null;
        const receipt = res.receipt || null;
        this.setData({
          loading: false,
          detail: detail
            ? {
                ...detail,
                statusText: statusText(detail.status),
                arStatusText: arStatusText(detail.arStatus),
                paymentMethodText: methodLabel(detail.paymentMethod),
                typeText: typeText(detail)
              }
            : null,
          receipt: receipt
            ? {
                ...receipt,
                receiptStatusText: receiptStatusText(receipt.receiptStatus)
              }
            : null,
          audits: (res.audits || []).map((item) => ({
            action: auditActionText(item.action),
            actor: item.actorUserId ? `用户#${item.actorUserId}` : "系统",
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
