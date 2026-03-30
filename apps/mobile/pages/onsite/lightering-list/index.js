const { listLighterings, confirmLighteringEmpty } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "DRAFT", label: "草稿" },
  { key: "IN_PROGRESS", label: "作业中" },
  { key: "MAIN_EMPTY_CONFIRMED", label: "已卸空" }
];

function statusTone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "MAIN_EMPTY_CONFIRMED") return "success";
  if (code === "IN_PROGRESS") return "warning";
  if (code === "VOID") return "danger";
  return "info";
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "DRAFT") return "草稿";
  if (code === "IN_PROGRESS") return "作业中";
  if (code === "MAIN_EMPTY_CONFIRMED") return "已卸空";
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
    list: [],
    actionId: 0
  },

  onLoad(options) {
    const status = String((options && options.status) || "").trim().toUpperCase();
    const supported = STATUS_FILTERS.some((item) => item.key === status);
    if (supported) {
      this.setData({ activeStatus: status });
    }
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

  onTapCreate() {
    wx.navigateTo({ url: "/pages/onsite/lightering-form/index" });
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/onsite/lightering-detail/index?id=${id}` });
  },

  onTapEdit(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/onsite/lightering-form/index?id=${id}` });
  },

  onTapConfirm(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id || this.data.actionId) return;

    wx.showModal({
      title: "确认卸空",
      content: "确认主船已卸空后，将立即锁定航次并生成结算版本 v1。该操作不可撤销。",
      confirmColor: "#0B3B66",
      success: (modalRes) => {
        if (!modalRes.confirm) return;

        this.setData({ actionId: id });
        confirmLighteringEmpty(id, { note: "由过驳单列表确认卸空。" })
          .then(() => {
            wx.showToast({ title: "已确认卸空并锁定航次", icon: "none" });
            this.loadList();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ actionId: 0 });
          });
      }
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
          statusTone: statusTone(item.status),
          statusText: statusText(item.status),
          unloadText: item.unloadEmptyConfirmed ? "已卸空" : "未卸空"
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
