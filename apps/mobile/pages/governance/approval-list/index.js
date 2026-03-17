const { listApprovals } = require("../../../services/governance");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "PENDING", label: "待审批" },
  { key: "APPROVED", label: "已通过" },
  { key: "REJECTED", label: "已驳回" }
];

function statusType(status) {
  if (status === "PENDING") return "warning";
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  return "default";
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

  onFilterChange(event) {
    this.setData({ activeStatus: event.detail.key || "ALL" });
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/governance/approval-detail/index?id=${id}` });
  },

  onTapVersions() {
    wx.navigateTo({ url: "/pages/governance/version-history/index" });
  },

  onTapAudits() {
    wx.navigateTo({ url: "/pages/governance/audit/index" });
  },

  onTapReports() {
    wx.navigateTo({ url: "/pages/governance/report/index" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    return listApprovals({
      status,
      keyword: this.data.keyword
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusType: statusType(item.status),
          reviewFlagText: item.canReview ? "可审批" : "查看"
        }));
        this.setData({
          loading: false,
          list
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
