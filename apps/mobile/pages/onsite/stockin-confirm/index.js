const { getStockinBatchDetail, confirmStockin } = require("../../../services/onsite");

function nowDateTime() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function statusTagType(status) {
  if (status === "AVAILABLE") return "success";
  if (status === "PENDING_STOCK_IN") return "warning";
  if (status === "VOID") return "danger";
  return "default";
}

Page({
  data: {
    batchId: null,
    loading: true,
    showError: false,
    submitting: false,
    detail: null,
    evidenceFiles: [],
    form: {
      confirmedQty: "",
      stockInTime: nowDateTime(),
      remark: ""
    }
  },

  onLoad(options) {
    const batchId = Number(options.batchId || 0);
    if (!batchId) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ batchId });
    this.loadDetail();
  },

  onRetry() {
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onEvidenceChange(event) {
    const files = event.detail.files || [];
    this.setData({
      evidenceFiles: files
    });
  },

  onSubmit() {
    const detail = this.data.detail;
    if (!detail) return;

    const qty = Number(this.data.form.confirmedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      wx.showToast({ title: "请输入有效入库吨数", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    confirmStockin({
      batchId: this.data.batchId,
      confirmedQty: qty,
      stockInTime: this.data.form.stockInTime,
      evidenceUrls: (this.data.evidenceFiles || []).map((f) => f.path),
      remark: this.data.form.remark || ""
    })
      .then((res) => {
        wx.showToast({ title: res.message || "处理成功", icon: "none" });
        if (res.requiresApproval) {
          setTimeout(() => wx.navigateBack(), 600);
          return;
        }
        this.setData({
          form: {
            ...this.data.form,
            confirmedQty: ""
          },
          evidenceFiles: []
        });
        this.loadDetail();
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getStockinBatchDetail(this.data.batchId)
      .then((res) => {
        const detail = res.detail || null;
        if (!detail) {
          throw new Error("批次不存在");
        }
        this.setData({
          detail: {
            ...detail,
            statusType: statusTagType(detail.status),
            sellableType: detail.sellable ? "success" : "warning"
          },
          form: {
            ...this.data.form,
            confirmedQty:
              detail.latestConfirmedQty != null
                ? String(detail.latestConfirmedQty)
                : this.data.form.confirmedQty
          },
          loading: false
        });
      })
      .catch(() => {
        this.setData({
          showError: true,
          loading: false
        });
      });
  }
});
