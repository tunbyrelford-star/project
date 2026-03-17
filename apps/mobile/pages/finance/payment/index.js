const { getFinanceSummary, confirmOrderPayment, reversePayment } = require("../../../services/finance");

const PAYMENT_METHOD_OPTIONS = [
  { label: "银行转账", value: "BANK_TRANSFER" },
  { label: "现金", value: "CASH" },
  { label: "其他", value: "OTHER" }
];

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
    reversingPaymentId: 0,
    order: null,
    receipt: null,
    actions: {},
    payments: [],
    form: {
      paymentAmount: "",
      methodIndex: 0,
      remark: "",
      reversalReason: ""
    },
    methodOptions: PAYMENT_METHOD_OPTIONS
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

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value || "" });
  },

  onMethodChange(event) {
    this.setData({ "form.methodIndex": Number(event.detail.value || 0) });
  },

  onSubmitPayment() {
    const actions = this.data.actions || {};
    const order = this.data.order || {};
    if (!actions.canConfirmPayment) {
      wx.showToast({ title: actions.paymentDisabledReason || "当前不可确认收款", icon: "none" });
      return;
    }

    const amount = toFixedNum(this.data.form.paymentAmount, 2);
    if (amount <= 0) {
      wx.showToast({ title: "请输入有效收款金额", icon: "none" });
      return;
    }

    wx.showModal({
      title: "不可撤销确认",
      content: "确认收款后不可撤销。如误操作只能通过冲正处理，是否继续？",
      confirmText: "继续确认",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ submitting: true });
        confirmOrderPayment(order.id, {
          paymentAmount: amount,
          paymentMethod: PAYMENT_METHOD_OPTIONS[this.data.form.methodIndex].value,
          remark: this.data.form.remark,
          paidAt: new Date().toISOString()
        })
          .then(() => {
            wx.showToast({ title: "收款已确认", icon: "success" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "收款确认失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ submitting: false });
          });
      }
    });
  },
  onReversePayment(event) {
    const paymentId = Number(event.currentTarget.dataset.id);
    const reason = String(this.data.form.reversalReason || "").trim();
    if (!paymentId) return;
    if (this.data.reversingPaymentId) return;
    if (!reason) {
      wx.showToast({ title: "Please input reversal reason", icon: "none" });
      return;
    }

    wx.showModal({
      title: "Confirm reverse",
      content: "A reversal record will be created and the original payment will remain immutable. Continue?",
      confirmText: "Confirm",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ reversingPaymentId: paymentId });
        reversePayment(paymentId, { reason })
          .then(() => {
            wx.showToast({ title: "Reversal completed", icon: "success" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "Reversal failed", icon: "none" });
          })
          .finally(() => {
            this.setData({ reversingPaymentId: 0 });
          });
      }
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getFinanceSummary(this.data.orderId)
      .then((res) => {
        const receipt = res.receipt || {};
        this.setData({
          loading: false,
          order: res.order || {},
          receipt,
          actions: res.actions || {},
          payments: res.payments || [],
          "form.paymentAmount": receipt.outstandingAmount != null ? String(receipt.outstandingAmount) : this.data.form.paymentAmount
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
