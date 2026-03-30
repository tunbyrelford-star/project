const { request } = require("../../utils/request");

function levelMeta(level) {
  const code = String(level || "").toUpperCase();
  if (code === "HIGH") {
    return { levelLabel: "高", levelType: "danger", levelTone: "danger" };
  }
  if (code === "MEDIUM") {
    return { levelLabel: "中", levelType: "warning", levelTone: "warning" };
  }
  return { levelLabel: "低", levelType: "info", levelTone: "info" };
}

function statusMeta(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CLOSED") {
    return { statusLabel: "已闭环", statusType: "success" };
  }
  return { statusLabel: "待处理", statusType: "warning" };
}

function toAlertMessage(item) {
  const type = String(item.alertType || "").toUpperCase();
  if (type === "SANDING_TIMEOUT") {
    return `${item.procurementNo || "采购单"} 打砂超时`;
  }
  return type || "业务预警";
}

Page({
  data: {
    loading: true,
    showError: false,
    alerts: []
  },

  onLoad() {
    this.loadAlerts();
  },

  onShow() {
    this.loadAlerts();
  },

  onPullDownRefresh() {
    this.loadAlerts().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadAlerts();
  },

  onTapHandle(event) {
    const item = (event.currentTarget.dataset || {}).item || {};
    const relatedEntityType = String(item.relatedEntityType || "").toUpperCase();
    const relatedEntityId = Number(item.relatedEntityId || 0);

    if (relatedEntityType === "PROCUREMENT" && relatedEntityId) {
      wx.navigateTo({
        url: `/pages/procurement/detail/index?id=${relatedEntityId}&openTimeout=1`
      });
      return;
    }

    wx.showToast({ title: "该预警暂不支持直达处理", icon: "none" });
  },

  loadAlerts() {
    this.setData({ loading: true, showError: false });
    return request({
      url: "/alerts",
      method: "GET",
      data: {
        status: "OPEN",
        alertType: "SANDING_TIMEOUT"
      }
    })
      .then((res) => {
        const alerts = (res.items || []).map((item) => ({
          ...item,
          id: item.alertNo || item.id,
          message: toAlertMessage(item),
          entityRef: `${item.voyageNo || "-"} / ${item.shipName || "-"}`,
          triggeredAt: item.triggeredAt || "-",
          ...levelMeta(item.severity),
          ...statusMeta(item.status)
        }));

        this.setData({
          alerts,
          loading: false
        });
      })
      .catch(() => {
        this.setData({ showError: true, loading: false });
      });
  }
});
