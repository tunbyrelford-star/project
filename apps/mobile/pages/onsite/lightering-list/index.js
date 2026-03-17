const { listLighterings, confirmLighteringEmpty } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "MAIN_EMPTY_CONFIRMED", label: "Empty Confirmed" }
];

function statusTone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "MAIN_EMPTY_CONFIRMED") return "success";
  if (code === "IN_PROGRESS") return "warning";
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
    list: [],
    actionId: 0
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
    wx.navigateTo({ url: `/pages/onsite/lightering-detail/index?id=${id}` });
  },

  onTapConfirm(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id || this.data.actionId) return;
    this.setData({ actionId: id });
    confirmLighteringEmpty(id, { note: "Confirm from lightering order list." })
      .then((res) => {
        wx.showToast({ title: (res && res.message) || "Confirmed", icon: "none" });
        this.loadList();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || "Operation failed", icon: "none" });
      })
      .finally(() => {
        this.setData({ actionId: 0 });
      });
  },

  onTapTaskBoard() {
    wx.navigateTo({ url: "/pages/onsite/tasks/index?type=WAIT_LIGHTERING" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    return listLighterings({
      keyword: this.data.keyword,
      status
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusTone: statusTone(item.status)
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

