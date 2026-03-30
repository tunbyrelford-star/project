const { getWeighingSlipDetail } = require("../../../services/finance");

function auditNote(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "PENDING_CONFIRM") return "待确认";
  if (code === "CONFIRMED") return "已确认";
  if (code === "VOID") return "已作废";
  if (code === "UPLOADED") return "已上传";
  return code || "-";
}

function differenceText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "NO_DIFF") return "无差异";
  if (code === "PENDING_CONFIRM") return "待差异确认";
  if (code === "CONFIRMED") return "差异已确认";
  return code || "-";
}

function auditActionText(action) {
  const code = String(action || "").toUpperCase();
  if (code === "WEIGHING_SLIP_UPLOADED") return "磅单已上传";
  if (code === "WEIGHING_DIFF_CONFIRMED") return "磅单差异已确认";
  if (code === "WEIGHING_UPDATED") return "磅单已更新";
  return action || "-";
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
      wx.showToast({ title: "磅单参数错误", icon: "none" });
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
      wx.showToast({ title: "缺少订单标识", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/finance/weighing/index?orderId=${orderId}` });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getWeighingSlipDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || null;
        const attachments = (detail && detail.attachments ? detail.attachments : [])
          .map((item, index) => {
            if (!item) return null;
            if (typeof item === "string") {
              return {
                name: `附件${index + 1}`,
                path: item
              };
            }
            return item;
          })
          .filter(Boolean);
        this.setData({
          loading: false,
          detail: detail
            ? {
                ...detail,
                statusText: statusText(detail.status),
                differenceText: differenceText(detail.differenceStatus),
                attachments
              }
            : null,
          items: res.items || [],
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
