const { listSellableBatches } = require("../../../services/sales");

const SELECTABLE_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "SELECTABLE", label: "可选" },
  { key: "UNSELECTABLE", label: "不可选" }
];

const BATCH_STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "AVAILABLE", value: "AVAILABLE" },
  { label: "PARTIALLY_ALLOCATED", value: "PARTIALLY_ALLOCATED" },
  { label: "PENDING_STOCK_IN", value: "PENDING_STOCK_IN" },
  { label: "SOLD_OUT", value: "SOLD_OUT" }
];

const DOC_STATUS_OPTIONS = [
  { label: "全部资料状态", value: "" },
  { label: "资料完整", value: "COMPLETE" },
  { label: "资料不完整", value: "INCOMPLETE" }
];

function statusType(status) {
  if (status === "AVAILABLE") return "success";
  if (status === "PARTIALLY_ALLOCATED") return "info";
  if (status === "PENDING_STOCK_IN") return "warning";
  if (status === "SOLD_OUT") return "danger";
  return "default";
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    selectableFilter: "ALL",
    filters: SELECTABLE_FILTERS,
    batchStatusOptions: BATCH_STATUS_OPTIONS,
    batchStatusIndex: 0,
    docStatusOptions: DOC_STATUS_OPTIONS,
    docStatusIndex: 0,
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
    this.setData({ selectableFilter: event.detail.key || "ALL" });
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onBatchStatusChange(event) {
    this.setData({ batchStatusIndex: Number(event.detail.value || 0) });
    this.loadList();
  },

  onDocStatusChange(event) {
    this.setData({ docStatusIndex: Number(event.detail.value || 0) });
    this.loadList();
  },

  onTapCreate() {
    wx.navigateTo({ url: "/pages/sales/create/index" });
  },

  onTapUseBatch(event) {
    const id = Number(event.currentTarget.dataset.id);
    const item = this.data.list.find((x) => Number(x.id) === id);
    if (!item || !item.selectable) {
      wx.showToast({ title: item && item.disabledReason ? item.disabledReason : "该批次不可用", icon: "none" });
      return;
    }
    wx.setStorageSync("sales.prefill_batches", [
      {
        batchId: item.id,
        batchNo: item.batchNo,
        voyageId: item.voyageId,
        voyageNo: item.voyageNo,
        shipName: item.shipName,
        remainingQty: item.remainingQty,
        lockQty: Math.min(10, Number(item.remainingQty || 0)),
        sourceUnitCost: item.sourceUnitCost
      }
    ]);
    wx.navigateTo({ url: "/pages/sales/create/index" });
  },

  buildQuery() {
    const query = {
      keyword: this.data.keyword || "",
      batchStatus: this.data.batchStatusOptions[this.data.batchStatusIndex].value,
      docStatus: this.data.docStatusOptions[this.data.docStatusIndex].value
    };
    if (this.data.selectableFilter === "SELECTABLE") {
      query.selectable = 1;
    }
    return query;
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    return listSellableBatches(this.buildQuery())
      .then((res) => {
        let list = (res.items || []).map((item) => ({
          ...item,
          statusType: statusType(item.batchStatus),
          docsType: item.docsComplete ? "success" : "warning",
          cardDisabled: !item.selectable
        }));

        if (this.data.selectableFilter === "UNSELECTABLE") {
          list = list.filter((item) => !item.selectable);
        }

        this.setData({
          list,
          loading: false
        });
      })
      .catch(() => {
        this.setData({
          loading: false,
          showError: true
        });
      });
  }
});
