const { getProfitTraceReport } = require("../../../services/governance");

function toFixedNum(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    summary: null,
    paymentSummary: null,
    voyageSummary: [],
    items: []
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

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || "" });
  },

  onSearch() {
    this.loadData();
  },

  onTapVersion(event) {
    const targetType = event.currentTarget.dataset.targetType;
    const targetId = event.currentTarget.dataset.targetId;
    if (!targetType || !targetId) return;
    wx.navigateTo({
      url: `/pages/governance/version-history/index?targetType=${targetType}&targetId=${targetId}`
    });
  },

  loadData() {
    this.setData({ loading: true, showError: false });
    return getProfitTraceReport({
      keyword: this.data.keyword
    })
      .then((res) => {
        const items = (res.items || []).map((item) => ({
          ...item,
          lineProfitAmount: toFixedNum(item.lineProfitAmount, 2),
          outstandingAmount: toFixedNum(item.outstandingAmount, 2)
        }));
        this.setData({
          loading: false,
          summary: res.summary || null,
          paymentSummary: res.paymentSummary || null,
          voyageSummary: res.voyageSummary || [],
          items
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
