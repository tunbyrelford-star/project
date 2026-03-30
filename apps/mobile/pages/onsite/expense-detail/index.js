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
    name: `凭证${idx + 1}`,
    path,
    size: 0
  }));
}

function expenseStatusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "DRAFT") return "草稿";
  if (code === "CONFIRMED") return "已确认";
  if (code === "VOID") return "已作废";
  return code || "-";
}

function expenseTypeText(type) {
  const code = String(type || "").toUpperCase();
  if (code === "FREIGHT") return "运费";
  if (code === "LIGHTERING") return "过驳费";
  if (code === "CRANE") return "吊装费";
  if (code === "PORT_MISC") return "港杂费";
  if (code === "SANDING_OVERTIME") return "打砂超时附加费";
  if (code === "OTHER") return "其他";
  return code || "-";
}

function sourceModuleText(source) {
  const code = String(source || "").toUpperCase();
  if (code === "ONSITE") return "现场";
  if (code === "PROCUREMENT") return "采购";
  if (code === "PROCUREMENT_TIMEOUT") return "采购超时处理";
  if (code === "SALES") return "销售";
  return code || "-";
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
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
        const raw = res.detail || null;
        const detail = raw
          ? {
              ...raw,
              statusText: expenseStatusText(raw.status),
              expenseTypeText: expenseTypeText(raw.expenseType),
              sourceModuleText: sourceModuleText(raw.sourceModule),
              occurredAtText: formatTime(raw.occurredAt)
            }
          : null;
        this.setData({
          loading: false,
          detail,
          files: toFiles((detail && detail.voucherUrls) || []),
          audits: (res.audits || []).map((item) => ({
            action: item.action,
            actor: item.actorUserId ? `用户#${item.actorUserId}` : "系统",
            time: formatTime(item.eventTime),
            note: auditNote(item.afterData || item.beforeData || "")
          }))
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
