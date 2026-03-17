const { listExpenses } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "CONFIRMED", label: "Confirmed" }
];

const TYPE_OPTIONS = [
  { label: "All Types", value: "" },
  { label: "FREIGHT", value: "FREIGHT" },
  { label: "LIGHTERING", value: "LIGHTERING" },
  { label: "CRANE", value: "CRANE" },
  { label: "PORT_MISC", value: "PORT_MISC" },
  { label: "OTHER", value: "OTHER" }
];

function statusTone(status) {
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
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    list: [],
    canViewAmount: false
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

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
    this.loadList();
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/onsite/expense-detail/index?id=${id}` });
  },

  onTapCreate() {
    wx.navigateTo({ url: "/pages/onsite/expense-create/index" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    const expenseType = this.data.typeOptions[this.data.typeIndex].value;
    return listExpenses({
      keyword: this.data.keyword,
      status,
      expenseType
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusTone: statusTone(item.status)
        }));
        this.setData({
          loading: false,
          list,
          canViewAmount: Boolean(res.canViewAmount)
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

