const { listStockIns } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "DRAFT", label: "Draft" }
];

function tone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "success";
  if (code === "DRAFT") return "warning";
  if (code === "VOID") return "danger";
  return "info";
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
      wx.showToast({ title: "Missing batch id", icon: "none" });
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
          statusTone: tone(item.status)
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

