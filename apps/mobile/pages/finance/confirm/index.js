const { getFinanceSummary, financeConfirmOrder } = require("../../../services/finance");

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toFixedNum(value, digits = 2) {
  return Number(toNum(value, 0).toFixed(digits));
}

function differenceLabel(status) {
  const code = String(status || "").toUpperCase();
  if (code === "NO_DIFF") return "无差异";
  if (code === "PENDING_CONFIRM") return "待差异确认";
  if (code === "CONFIRMED") return "差异已确认";
  return code || "-";
}

Page({
  data: {
    orderId: 0,
    loading: true,
    showError: false,
    submitting: false,
    order: null,
    effectiveSlip: null,
    lineItems: [],
    actions: {},
    diffConfirmNote: ""
  },

  onLoad(options) {
    const orderId = Number(options.orderId || 0);
    if (!orderId) {
      wx.showToast({ title: "订单参数错误", icon: "none" });
      return;
    }
    this.setData({ orderId });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onNoteInput(event) {
    this.setData({ diffConfirmNote: event.detail.value || "" });
  },

  onSubmit() {
    const order = this.data.order || {};
    const actions = this.data.actions || {};
    const slip = this.data.effectiveSlip;
    if (!actions.canFinanceConfirm) {
      wx.showToast({ title: actions.financeConfirmDisabledReason || "当前不可确认", icon: "none" });
      return;
    }
    if (!slip || !slip.id) {
      wx.showToast({ title: "缺少待确认磅单", icon: "none" });
      return;
    }

    const planned = toFixedNum(order.plannedTotalQty, 3);
    const finalQty = toFixedNum(slip.finalTotalQty, 3);
    const delta = toFixedNum(finalQty - planned, 3);
    const hasDiff = Math.abs(delta) > 0.0005;

    if (hasDiff && !String(this.data.diffConfirmNote || "").trim()) {
      wx.showToast({ title: "差异确认必须填写说明", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认财务结算",
      content: hasDiff
        ? "存在吨数差异，确认后将按 planned_qty 比例分摊 final_total_qty。"
        : "确认后将生成 FINAL_AR，并进入收款确认阶段。",
      confirmText: "确认",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ submitting: true });
        financeConfirmOrder(order.id, {
          slipId: slip.id,
          diffConfirm: hasDiff,
          diffConfirmNote: this.data.diffConfirmNote
        })
          .then(() => {
            wx.showToast({ title: "财务确认完成", icon: "success" });
            wx.redirectTo({ url: `/pages/finance/payment/index?orderId=${order.id}` });
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "确认失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ submitting: false });
          });
      }
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getFinanceSummary(this.data.orderId)
      .then((res) => {
        const order = res.order || {};
        const effectiveSlip = res.effectiveSlip || null;
        const lineItems = res.lineItems || [];
        const actions = res.actions || {};
        this.setData({
          loading: false,
          order: {
            ...order,
            differenceStatusText: differenceLabel(order.differenceStatus)
          },
          effectiveSlip: effectiveSlip
            ? {
                ...effectiveSlip,
                differenceStatusText: differenceLabel(effectiveSlip.differenceStatus)
              }
            : null,
          lineItems,
          actions
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
