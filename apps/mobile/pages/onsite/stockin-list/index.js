const { listStockIns } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "CONFIRMED", label: "已确认" },
  { key: "PENDING", label: "待处理" },
  { key: "SUPERSEDED", label: "已替代" }
];

function tone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "success";
  if (code === "PENDING") return "warning";
  if (code === "SUPERSEDED") return "info";
  if (code === "VOID") return "danger";
  return "default";
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "已确认";
  if (code === "PENDING") return "待处理";
  if (code === "SUPERSEDED") return "已替代";
  if (code === "VOID") return "作废";
  return code || "-";
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    activeStatus: "ALL",
    filters: STATUS_FILTERS,
    list: []
  },

  onLoad() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onFilterChange(event) {
    this.setData({ activeStatus: event.detail.key || "ALL" });
    this.loadList();
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/onsite/stockin-detail/index?id=${id}` });
  },

  onTapConfirm(event) {
    const batchId = Number(event.currentTarget.dataset.batchId || 0);
    if (!batchId) {
      wx.showToast({ title: "缺少批次参数", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/onsite/stockin-confirm/index?batchId=${batchId}` });
  },

  onTapTodo() {
    wx.navigateTo({ url: "/pages/onsite/tasks/index?type=WAIT_STOCK_IN" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    return listStockIns({
      keyword: this.data.keyword,
      status
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusTone: tone(item.status),
          statusText: statusText(item.status),
          sellableText: item.stockInConfirmed ? "可售" : "不可售"
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
