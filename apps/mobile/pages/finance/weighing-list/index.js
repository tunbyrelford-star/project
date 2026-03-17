const { listWeighingSlips } = require("../../../services/finance");

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PENDING_CONFIRM", label: "Pending Confirm" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "VOID", label: "Void" }
];

function tone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "success";
  if (code === "PENDING_CONFIRM") return "warning";
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
    wx.navigateTo({ url: `/pages/finance/weighing-detail/index?id=${id}` });
  },

  onTapPending() {
    wx.navigateTo({ url: "/pages/finance/pending/index?action=ENTER_WEIGHING" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    return listWeighingSlips({
      keyword: this.data.keyword,
      status
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusTone: tone(item.status),
          diffTone: Number(item.deltaQty || 0) === 0 ? "success" : "warning"
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

