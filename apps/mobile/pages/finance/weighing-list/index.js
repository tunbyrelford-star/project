const { listWeighingSlips } = require("../../../services/finance");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "PENDING_CONFIRM", label: "待确认" },
  { key: "CONFIRMED", label: "已确认" },
  { key: "VOID", label: "作废" }
];

function tone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "success";
  if (code === "PENDING_CONFIRM") return "warning";
  if (code === "VOID") return "danger";
  return "info";
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "PENDING_CONFIRM") return "待确认";
  if (code === "CONFIRMED") return "已确认";
  if (code === "VOID") return "作废";
  return code || "-";
}

function mapOrderStatus(status) {
  const code = String(status || "").toUpperCase();
  if (code === "PENDING_FINAL_QTY_CONFIRM") return "待最终吨数确认";
  if (code === "LOCKED") return "已锁定";
  if (code === "COMPLETED") return "已完成";
  if (code === "VOID") return "已作废";
  return code || "-";
}

function mapArStatus(status) {
  const code = String(status || "").toUpperCase();
  if (code === "ESTIMATED_AR") return "预估应收";
  if (code === "FINAL_AR") return "最终应收";
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
          statusText: statusText(item.status),
          orderStatusText: mapOrderStatus(item.orderStatus),
          arStatusText: mapArStatus(item.arStatus),
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
