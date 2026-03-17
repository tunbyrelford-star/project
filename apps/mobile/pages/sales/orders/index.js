const { listSalesOrders } = require("../../../services/sales");

function statusMeta(status) {
  const code = String(status || "").toUpperCase();
  switch (code) {
    case "DRAFT":
      return { text: "草稿", type: "warning" };
    case "LOCKED_STOCK":
      return { text: "已锁库存", type: "info" };
    case "PENDING_FINAL_QTY_CONFIRM":
    case "READY_FOR_PAYMENT_CONFIRM":
      return { text: "待确认", type: "warning" };
    case "COMPLETED":
      return { text: "已完成", type: "success" };
    case "VOID":
      return { text: "作废", type: "danger" };
    default:
      return { text: code || "未知", type: "default" };
  }
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    activeStatus: "ALL",
    statusFilters: [
      { key: "ALL", label: "全部" },
      { key: "DRAFT", label: "草稿" },
      { key: "LOCKED_STOCK", label: "已锁库存" },
      { key: "PENDING_FINAL_QTY_CONFIRM", label: "待确认" },
      { key: "READY_FOR_PAYMENT_CONFIRM", label: "待确认" },
      { key: "COMPLETED", label: "已完成" },
      { key: "VOID", label: "作废" }
    ],
    list: []
  },

  onLoad() {
    this.loadList();
  },

  onShow() {
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
    wx.navigateTo({ url: "/pages/sales/create/index" });
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/sales/detail/index?id=${id}` });
  },

  onTapEdit(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    const editable = Number(event.currentTarget.dataset.editable || 0) === 1;
    if (!id) return;
    if (!editable) {
      wx.showToast({ title: "当前状态不允许编辑", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/sales/create/index?id=${id}` });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    return listSalesOrders({
      keyword: this.data.keyword,
      status
    })
      .then((res) => {
        const list = (res.items || []).map((item) => {
          const meta = statusMeta(item.status);
          return {
            ...item,
            orderNo: item.orderNo || item.salesOrderNo || "-",
            customerName: item.customerName || "-",
            plannedTotalQty: item.plannedTotalQty == null ? "-" : item.plannedTotalQty,
            totalAmount: item.totalAmount == null ? "-" : item.totalAmount,
            statusText: meta.text,
            statusType: meta.type,
            editable: Boolean(item.editable)
          };
        });
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
