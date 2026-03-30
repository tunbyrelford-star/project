const { getStockInDetail } = require("../../../services/onsite");

function auditNote(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch (_error) {
      return value;
    }
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function toFiles(urls) {
  return (urls || []).map((path, idx) => ({
    name: `凭证${idx + 1}`,
    path,
    size: 0
  }));
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "已确认";
  if (code === "PENDING") return "待处理";
  if (code === "SUPERSEDED") return "已替代";
  if (code === "VOID") return "作废";
  return code || "-";
}

function auditActionText(action) {
  const code = String(action || "").toUpperCase();
  if (code === "STOCK_IN_CONFIRM") return "入库确认";
  if (code === "STOCK_IN_UPDATED") return "入库单已更新";
  if (code === "STOCK_IN_CREATED") return "入库单已创建";
  return action || "-";
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    detail: null,
    files: [],
    audits: []
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
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
    wx.navigateTo({ url: "/pages/onsite/stockin-list/index" });
  },

  onGoConfirm() {
    const batchId = Number((this.data.detail && this.data.detail.batchId) || 0);
    if (!batchId) {
      wx.showToast({ title: "缺少批次信息", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/onsite/stockin-confirm/index?batchId=${batchId}` });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getStockInDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || null;
        this.setData({
          loading: false,
          detail: detail
            ? {
                ...detail,
                statusText: statusText(detail.status),
                sellableText: detail.stockInConfirmed ? "可售" : "不可售"
              }
            : null,
          files: toFiles((detail && detail.voucherAttachments) || (detail && detail.evidenceUrls) || []),
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
