const { getFinanceSummary, createWeighingSlip } = require("../../../services/finance");

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toFixedNum(value, digits = 2) {
  return Number(toNum(value, 0).toFixed(digits));
}

Page({
  data: {
    orderId: 0,
    loading: true,
    showError: false,
    submitting: false,
    order: null,
    form: {
      finalTotalQty: "",
      remark: ""
    },
    voucherFiles: [],
    deltaQty: null
  },

  onLoad(options) {
    const orderId = Number(options.orderId || 0);
    if (!orderId) {
      wx.showToast({ title: "订单参数错误", icon: "none" });
      return;
    }
    this.setData({ orderId });
    this.loadSummary();
  },

  onPullDownRefresh() {
    this.loadSummary().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadSummary();
  },

  onQtyInput(event) {
    const finalTotalQty = event.detail.value;
    this.setData({ "form.finalTotalQty": finalTotalQty });
    this.recalcDelta(finalTotalQty);
  },

  onRemarkInput(event) {
    this.setData({ "form.remark": event.detail.value || "" });
  },

  onVoucherChange(event) {
    const files = (event.detail || {}).files || [];
    this.setData({ voucherFiles: files });
  },

  onSubmit() {
    const order = this.data.order || {};
    const finalTotalQty = toFixedNum(this.data.form.finalTotalQty, 3);
    if (!finalTotalQty || finalTotalQty <= 0) {
      wx.showToast({ title: "请输入有效最终吨数", icon: "none" });
      return;
    }
    if (!order.id) {
      wx.showToast({ title: "订单信息缺失", icon: "none" });
      return;
    }

    const firstVoucher = (this.data.voucherFiles || [])[0];
    this.setData({ submitting: true });
    createWeighingSlip(order.id, {
      finalTotalQty,
      voucherUrl: firstVoucher ? firstVoucher.path : "",
      remark: this.data.form.remark
    })
      .then(() => {
        wx.showToast({ title: "磅单已提交", icon: "success" });
        wx.redirectTo({ url: `/pages/finance/confirm/index?orderId=${order.id}` });
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || "提交失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  loadSummary() {
    this.setData({ loading: true, showError: false });
    return getFinanceSummary(this.data.orderId)
      .then((res) => {
        const order = res.order || {};
        const presetQty = res.effectiveSlip && res.effectiveSlip.finalTotalQty != null
          ? String(res.effectiveSlip.finalTotalQty)
          : "";
        this.setData(
          {
            loading: false,
            order,
            "form.finalTotalQty": presetQty
          },
          () => this.recalcDelta(this.data.form.finalTotalQty)
        );
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  },

  recalcDelta(finalQtyInput) {
    const order = this.data.order || {};
    const planned = toFixedNum(order.plannedTotalQty, 3);
    const finalQty = toFixedNum(finalQtyInput, 3);
    if (!planned || !finalQtyInput) {
      this.setData({ deltaQty: null });
      return;
    }
    this.setData({ deltaQty: toFixedNum(finalQty - planned, 3) });
  }
});
