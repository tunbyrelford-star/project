const { listPayments } = require("../../../services/finance");

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "CONFIRMED", label: "Confirmed" }
];

const TYPE_OPTIONS = [
  { label: "All Types", value: "ALL" },
  { label: "Normal", value: "NORMAL" },
  { label: "Reversal", value: "REVERSAL" }
];

function tone(isReversal) {
  return isReversal ? "warning" : "success";
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

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
    this.loadList();
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/finance/payment-detail/index?id=${id}` });
  },

  onTapPending() {
    wx.navigateTo({ url: "/pages/finance/pending/index?action=CONFIRM_PAYMENT" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    const paymentType = this.data.typeOptions[this.data.typeIndex].value;
    return listPayments({
      keyword: this.data.keyword,
      status,
      paymentType
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          typeTag: item.isReversal ? "REVERSAL" : "NORMAL",
          typeTone: tone(item.isReversal)
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});

