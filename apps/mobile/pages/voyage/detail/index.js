const { getVoyageDetail } = require("../../../services/voyage");

function formatText(value, fallback = "-") {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    detail: null
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onBackProcurement() {
    const procurementId = Number((this.data.detail && this.data.detail.procurementId) || 0);
    if (!procurementId) {
      wx.showToast({ title: "缺少采购单信息", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: `/pages/procurement/detail/index?id=${procurementId}`
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getVoyageDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || {};
        this.setData({
          detail: {
            ...detail,
            voyageNo: formatText(detail.voyageNo),
            procurementNo: formatText(detail.procurementNo),
            shipName: formatText(detail.shipName),
            mmsi: formatText(detail.mmsi),
            shipType: formatText(detail.shipType),
            supplierName: formatText(detail.supplierName),
            status: formatText(detail.status),
            startedAt: formatText(detail.startedAt),
            lockedAt: formatText(detail.lockedAt),
            completedAt: formatText(detail.completedAt)
          },
          loading: false
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
