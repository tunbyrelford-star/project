const { getAuditLogs } = require("../../../services/governance");

const ENTITY_OPTIONS = [
  { label: "全部", value: "" },
  { label: "APPROVAL", value: "APPROVAL" },
  { label: "SALES_ORDER", value: "SALES_ORDER" },
  { label: "PAYMENT", value: "PAYMENT" },
  { label: "SETTLEMENT_VERSION", value: "SETTLEMENT_VERSION" },
  { label: "ALLOCATION_VERSION", value: "ALLOCATION_VERSION" }
];

Page({
  data: {
    loading: true,
    showError: false,
    entityOptions: ENTITY_OPTIONS,
    entityIndex: 0,
    entityId: "",
    keyword: "",
    timelineItems: [],
    rawItems: []
  },

  onLoad() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadData();
  },

  onEntityChange(event) {
    this.setData({ entityIndex: Number(event.detail.value || 0) });
  },

  onEntityIdInput(event) {
    this.setData({ entityId: event.detail.value || "" });
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || "" });
  },

  onSearch() {
    this.loadData();
  },

  loadData() {
    this.setData({ loading: true, showError: false });
    const entityType = this.data.entityOptions[this.data.entityIndex].value;
    const entityId = Number(this.data.entityId || 0);
    return getAuditLogs({
      entityType,
      entityId: entityId || "",
      keyword: this.data.keyword
    })
      .then((res) => {
        const rawItems = res.items || [];
        const timelineItems = rawItems.map((item) => ({
          action: item.action,
          actor: item.actorName || (item.actorUserId ? `用户#${item.actorUserId}` : "系统"),
          time: item.eventTime,
          note: item.afterData || item.beforeData || ""
        }));
        this.setData({
          loading: false,
          rawItems,
          timelineItems
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
