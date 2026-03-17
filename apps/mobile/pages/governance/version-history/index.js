const { getVersionHistory } = require("../../../services/governance");

const TARGET_OPTIONS = [
  { label: "Voyage", value: "VOYAGE" },
  { label: "SalesOrder", value: "SALES_ORDER" }
];

Page({
  data: {
    loading: false,
    showError: false,
    targetOptions: TARGET_OPTIONS,
    targetIndex: 0,
    targetId: "",
    settlementVersions: [],
    allocationVersions: [],
    timelineItems: []
  },

  onLoad(options) {
    const targetType = String(options.targetType || "").toUpperCase();
    const targetId = options.targetId || "";
    let targetIndex = 0;
    if (targetType === "SALES_ORDER") {
      targetIndex = 1;
    }
    this.setData({
      targetIndex,
      targetId: targetId ? String(targetId) : ""
    });
    if (targetId) {
      this.loadData();
    }
  },

  onTargetTypeChange(event) {
    this.setData({ targetIndex: Number(event.detail.value || 0) });
  },

  onTargetIdInput(event) {
    this.setData({ targetId: event.detail.value || "" });
  },

  onRetry() {
    this.loadData();
  },

  onSearch() {
    this.loadData();
  },

  loadData() {
    const targetId = Number(this.data.targetId || 0);
    if (!targetId) {
      wx.showToast({ title: "请输入目标ID", icon: "none" });
      return Promise.resolve();
    }

    this.setData({ loading: true, showError: false });
    return getVersionHistory({
      targetType: this.data.targetOptions[this.data.targetIndex].value,
      targetId
    })
      .then((res) => {
        const timelineItems = (res.timeline || []).map((item) => ({
          action: `${item.type} v${item.versionNo}`,
          actor: item.targetNo || `#${item.targetId}`,
          time: item.createdAt,
          note: `状态: ${item.status}`
        }));
        this.setData({
          loading: false,
          settlementVersions: res.settlementVersions || [],
          allocationVersions: res.allocationVersions || [],
          timelineItems
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
